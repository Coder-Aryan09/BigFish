// BigFish Executor: runs the 13 browser tools. Before a mutating action it
// focuses the ref's tab, rehydrates vault tokens, asks for approval when the
// action is risky, and after it returns a delta. Every result passes the PII
// filter before it leaves the extension.
import { ErrorCode, toolError } from "@bigfish/contracts";
import { tabsManager } from "./tabs.js";
import { pageError, tabCall, waitForNavigation, waitForTabLoad } from "./page.js";
import { buildDelta, buildSnapshot, buildTextSnapshot, type ScanResult } from "./snapshot.js";
import { isForbiddenUrl } from "../../safety/url-policy.js";
import { rehydrateArgs, sanitizeObservationForModel } from "../../safety/privacy.js";
import { classifyAction, type ActionDescriptor } from "../../safety/action-policy.js";
import { approvals } from "../../safety/approval.js";
import { vault } from "../../safety/pii-vault.js";

export interface ExecuteOptions {
  // Aborted when the server cancels the MCP call.
  signal?: AbortSignal;
  runId?: string;
  // Sent back to the server as MCP progress (e.g. while waiting for approval).
  onProgress?: (message: string) => void;
}

interface ToolResult {
  ok: boolean;
  text: string;
  // Origin of the page the text came from, for the PII vault.
  origin?: string;
}

type Tab = Browser.tabs.Tab & { id: number };
type Descriptor = ActionDescriptor & { label?: string };

const SNAPSHOT_DEFAULT_CHARS = 3_000;
const SNAPSHOT_MAX_CHARS = 12_000;
const NAVIGATE_PREVIEW = 25;
const MAX_RESULT_CHARS = 12_000;
const WAIT_DEFAULT_MS = 5_000;
const WAIT_MAX_MS = 60_000;
const SETTLE_MS = 350;
// After an action, wait for the DOM to be quiet this long (but at most SETTLE_MAX_MS).
const SETTLE_QUIET_MS = 600;
const SETTLE_MAX_MS = 5_000;
// browser_wait_for idle=true: no DOM change for this long means the page is done.
const IDLE_QUIET_MS = 1_500;

class ToolFailure extends Error {
  constructor(readonly result: ToolResult) {
    super(result.text);
  }
}

function fail(code: ErrorCode, message: string, hint?: string): never {
  throw new ToolFailure({ ok: false, text: toolError(code, message, hint) });
}

export class BrowserToolExecutor {
  async execute(tool: string, rawArgs: any, _callerClient: string = "mcp", opts: ExecuteOptions = {}): Promise<{ ok: boolean; text: string }> {
    if (opts.signal?.aborted) {
      return { ok: false, text: toolError(ErrorCode.TIMEOUT, `${tool} was cancelled before it started.`) };
    }
    await vault.ready();
    let result: ToolResult;
    try {
      result = await this.run(tool, rawArgs ?? {}, opts);
    } catch (err) {
      result = err instanceof ToolFailure ? err.result : pageError(err, tool);
    }

    // Nothing leaves the browser without passing the PII filter.
    const origin = result.origin ?? (await activeOrigin());
    let text = sanitizeObservationForModel(result.text, origin);
    if (text.length > MAX_RESULT_CHARS) text = `${text.slice(0, MAX_RESULT_CHARS)}\n… cut at ${MAX_RESULT_CHARS} chars`;
    return { ok: result.ok, text };
  }

  private run(tool: string, args: any, opts: ExecuteOptions): Promise<ToolResult> {
    switch (tool) {
      case "browser_ping":
        return this.ping();
      case "browser_tabs":
        return this.tabs(args, opts);
      case "browser_navigate":
        return this.navigate(args, opts);
      case "browser_snapshot":
        return this.snapshot(args);
      case "browser_find":
        return this.find(args);
      case "browser_click":
        return this.click(args, opts);
      case "browser_type":
        return this.type(args, opts);
      case "browser_fill_form":
        return this.fillForm(args, opts);
      case "browser_select":
        return this.select(args);
      case "browser_press_key":
        return this.pressKey(args, opts);
      case "browser_scroll":
        return this.scroll(args);
      case "browser_wait_for":
        return this.waitFor(args, opts);
      case "browser_extract":
        return this.extract(args);
      default:
        return Promise.resolve({ ok: false, text: toolError(ErrorCode.INVALID_ARGS, `Unknown tool "${tool}"`) });
    }
  }

  // ---- tools ------------------------------------------------------------------------

  private async ping(): Promise<ToolResult> {
    const tabs = await tabsManager.listTabs();
    return { ok: true, text: `ok pong | ext ${browser.runtime.getManifest().version} | ${tabs.length} tabs` };
  }

  private async tabs(args: any, opts: ExecuteOptions): Promise<ToolResult> {
    const action = args.action || "list";
    if (action === "list") {
      const list = await tabsManager.listTabs();
      const lines = [`ok ${list.length} tabs`];
      for (const t of list) {
        lines.push(`${t.active ? "*" : " "}${t.slot} ${t.title.slice(0, 60)} | ${t.url.replace(/^https?:\/\//, "").slice(0, 60)}${t.isBigFish ? " (BigFish)" : ""}`);
      }
      return { ok: true, text: lines.join("\n") };
    }

    const tab = await tabsManager.getTabBySlot(args.tab);
    if (tab?.id === undefined) fail(ErrorCode.TAB_NOT_FOUND, `Tab ${args.tab} not found.`, "Call browser_tabs list.");

    if (action === "switch") {
      await focusTab(tab as Tab);
      return { ok: true, text: `ok switched to tab ${args.tab} | ${tab.title ?? ""}` };
    }
    if (action === "close") {
      if (!tabsManager.isAgentTab(tab.id!)) {
        await this.approve("browser_tabs", args, tab.url ?? "", `Close your tab "${tab.title ?? tab.url}"`, opts);
      }
      await browser.tabs.remove(tab.id!);
      return { ok: true, text: `ok closed tab ${args.tab}` };
    }
    return fail(ErrorCode.INVALID_ARGS, `Invalid action ${action}`);
  }

  private async navigate(args: any, opts: ExecuteOptions): Promise<ToolResult> {
    let tab = args.tab ? await tabsManager.getTabBySlot(args.tab) : await tabsManager.getActiveTab();
    if (args.tab && !tab) fail(ErrorCode.TAB_NOT_FOUND, `Tab ${args.tab} not found.`, "Call browser_tabs list.");

    if (args.action) {
      if (tab?.id === undefined) return fail(ErrorCode.TAB_NOT_FOUND, "No tab to act on.");
      if (args.action === "reload") await browser.tabs.reload(tab.id);
      else if (args.action === "back") await browser.tabs.goBack(tab.id);
      else await browser.tabs.goForward(tab.id);
      const loaded = await waitForNavigation(tab.id);
      return this.pagePreview(tab as Tab, `ok ${args.action} done${loaded ? "" : " (page still loading)"}`);
    }

    if (!args.url) fail(ErrorCode.INVALID_ARGS, "Give url, or action back/forward/reload.");
    let url = String(args.url).trim();
    if (!/^[a-z][a-z0-9+.-]*:/i.test(url)) url = `https://${url}`;
    if (isForbiddenUrl(url)) fail(ErrorCode.FORBIDDEN_URL, `${url} is blocked by policy.`, "Do not retry. Pick another page.");

    // A vault token inside a URL would send private data to that site: ask first.
    const target = safeOrigin(url);
    const { args: real, rehydrated } = rehydrateArgs("browser_navigate", { url }, target);
    if (rehydrated) {
      await this.approve("browser_navigate", { url }, target, `Open a URL that contains your private data (${target})`, opts);
      url = real.url;
    }

    if (args.new_tab || tab?.id === undefined) {
      tab = await tabsManager.openInBigFishGroup(url);
    } else {
      await browser.tabs.update(tab.id, { url });
    }
    const loaded = await waitForNavigation(tab.id!);
    return this.pagePreview(tab as Tab, `ok navigated${loaded ? "" : " (page still loading)"}`);
  }

  // Header + the first elements in view, so the agent often needs no snapshot after navigating.
  private async pagePreview(tab: Tab, firstLine: string): Promise<ToolResult> {
    const slot = await tabsManager.slotOf(tab.id);
    try {
      const scan = await this.scan(tab.id, { viewportOnly: true });
      const preview = { ...scan, elements: scan.elements.slice(0, NAVIGATE_PREVIEW) };
      return {
        ok: true,
        text: `${firstLine}\n${buildSnapshot(slot, preview, { maxChars: 2_500, offset: 0, newRefs: new Set() })}`,
        origin: safeOrigin(scan.url),
      };
    } catch {
      const now = await browser.tabs.get(tab.id).catch(() => tab);
      return { ok: true, text: `${firstLine}\n[tab ${slot}] ${now.title ?? ""} | ${now.url ?? ""} (page cannot be read)`, origin: safeOrigin(now.url) };
    }
  }

  private async snapshot(args: any): Promise<ToolResult> {
    const tab = await this.tabFromArg(args.tab);
    const slot = await tabsManager.slotOf(tab.id);
    const maxChars = clamp(args.max_chars ?? SNAPSHOT_DEFAULT_CHARS, 200, SNAPSHOT_MAX_CHARS);
    const offset = Math.max(0, Number(args.offset ?? 0));

    if (args.mode === "text") {
      const page = await tabCall(tab.id, "BIGFISH_TEXT", { within: args.within });
      if (!page.ok) return contentError(page, args.within);
      return {
        ok: true,
        text: buildTextSnapshot(slot, page as any, { maxChars, offset, fromEnd: args.from_end === true }),
        origin: safeOrigin((page as any).url),
      };
    }

    const scan = await this.scan(tab.id, { within: args.within });
    // Only full-page snapshots set the baseline for "*" (new) marks.
    const newRefs = args.within || offset ? new Set<string>() : tabsManager.markSnapshot(tab.id, scan.elements.map((e) => e.ref));
    return { ok: true, text: buildSnapshot(slot, scan, { maxChars, offset, newRefs }), origin: safeOrigin(scan.url) };
  }

  private async find(args: any): Promise<ToolResult> {
    const tab = await this.tabFromArg(args.tab);
    const query = rehydrateArgs("browser_find", { q: args.query }, safeOrigin(tab.url)).args.q;
    const kind = args.kind === "text" ? "text" : "element";
    const resp = await tabCall<{ matches: string[] }>(tab.id, "BIGFISH_FIND", { query, kind });
    if (!resp.ok) return contentError(resp);
    const matches = resp.matches ?? [];
    const head = kind === "text" ? `ok ${matches.length} hits` : `ok ${matches.length} matches`;
    if (matches.length === 0) return { ok: true, text: `${head} | try other words, or browser_snapshot`, origin: safeOrigin(tab.url) };
    return { ok: true, text: [head, ...matches].join("\n"), origin: safeOrigin(tab.url) };
  }

  private async click(args: any, opts: ExecuteOptions): Promise<ToolResult> {
    const tab = await this.tabFromRef(args.ref);
    await focusTab(tab);
    const desc = await this.describe(tab, args.ref);
    await this.gate("browser_click", args, tab, desc, opts);

    const before = await this.scanQuiet(tab.id);
    const resp = await tabCall<{ role: string; name: string }>(tab.id, "BIGFISH_CLICK", { ref: args.ref });
    if (!resp.ok) return contentError(resp, args.ref);
    const after = await this.settle(tab.id);
    return { ok: true, text: buildDelta(`click ${resp.role} "${resp.name}"`, before, after), origin: safeOrigin(after?.url ?? tab.url) };
  }

  private async type(args: any, opts: ExecuteOptions): Promise<ToolResult> {
    const tab = await this.tabFromRef(args.ref);
    await focusTab(tab);
    const { args: real, crossOrigins } = rehydrateArgs("browser_type", args, safeOrigin(tab.url));
    const desc = await this.describe(tab, args.ref);
    await this.gate("browser_type", real, tab, { ...desc, crossOrigins }, opts);

    const before = await this.scanQuiet(tab.id);
    const resp = await tabCall<{ role: string; name: string; value: string }>(tab.id, "BIGFISH_TYPE", {
      ref: args.ref,
      text: real.text,
      clear: args.clear,
      submit: args.submit,
    });
    if (!resp.ok) return contentError(resp, args.ref);
    const after = await this.settle(tab.id);
    const value = String(resp.value ?? "").slice(0, 80).replace(/"/g, "'");
    return { ok: true, text: buildDelta(`type ${resp.role} "${resp.name}" ="${value}"`, before, after), origin: safeOrigin(tab.url) };
  }

  private async fillForm(args: any, opts: ExecuteOptions): Promise<ToolResult> {
    const fields: { ref: string; value: string }[] = args.fields ?? [];
    if (fields.length === 0 || fields.length > 15) fail(ErrorCode.INVALID_ARGS, "Give 1 to 15 fields.");
    const tab = await this.tabFromRef(fields[0]!.ref);
    await focusTab(tab);
    const origin = safeOrigin(tab.url);

    // One approval for the whole call: cross-origin data in any field, or a risky submit button.
    const crossOrigins = new Set<string>();
    const real = fields.map((f) => {
      const r = rehydrateArgs("browser_fill_form", f, origin);
      r.crossOrigins.forEach((o) => crossOrigins.add(o));
      return r.args as { ref: string; value: string };
    });
    const submitDesc: Descriptor = args.submit_ref ? await this.describe(tab, args.submit_ref) : {};
    await this.gate(
      "browser_fill_form",
      args,
      tab,
      { ...submitDesc, formSubmitLabel: submitDesc.label, crossOrigins: [...crossOrigins] },
      opts,
      args.submit_ref,
    );

    const before = await this.scanQuiet(tab.id);
    const lines: string[] = [];
    for (const field of real) {
      const resp = await tabCall<{ role: string; name: string; value: string }>(tab.id, "BIGFISH_FILL", { ref: field.ref, value: field.value });
      if (!resp.ok) {
        const err = contentError(resp, field.ref);
        return { ok: false, text: `${err.text}\nFilled before the failure:\n${lines.join("\n") || "(none)"}`, origin };
      }
      const value = String(resp.value ?? "");
      lines.push(`${field.ref} ${resp.role} "${resp.name}" ${/^\[[x ]\]$/.test(value) ? value : `="${value.slice(0, 60)}"`}`);
    }
    let action = `filled ${lines.length} fields`;
    if (args.submit_ref) {
      const resp = await tabCall<{ role: string; name: string }>(tab.id, "BIGFISH_CLICK", { ref: args.submit_ref });
      if (!resp.ok) return { ok: false, text: `${contentError(resp, args.submit_ref).text}\nAll fields were filled.`, origin };
      action += `, clicked ${resp.role} "${resp.name}"`;
    }
    const after = await this.settle(tab.id);
    return { ok: true, text: `${buildDelta(action, before, after)}\n${lines.join("\n")}`, origin };
  }

  private async select(args: any): Promise<ToolResult> {
    const tab = await this.tabFromRef(args.ref);
    await focusTab(tab);
    const option = rehydrateArgs("browser_select", { o: args.option }, safeOrigin(tab.url)).args.o;
    const before = await this.scanQuiet(tab.id);
    const resp = await tabCall<{ role: string; name: string; selected: string }>(tab.id, "BIGFISH_SELECT", { ref: args.ref, option });
    if (!resp.ok) return contentError(resp, args.ref);
    const after = await this.settle(tab.id);
    return { ok: true, text: buildDelta(`selected "${resp.selected}" in ${resp.role} "${resp.name}"`, before, after), origin: safeOrigin(tab.url) };
  }

  private async pressKey(args: any, opts: ExecuteOptions): Promise<ToolResult> {
    const tab = args.ref ? await this.tabFromRef(args.ref) : await this.tabFromArg(undefined);
    await focusTab(tab);
    if (/^enter$/i.test(String(args.key))) {
      const desc = await this.describe(tab, args.ref).catch(() => ({}) as Descriptor);
      await this.gate("browser_press_key", args, tab, desc, opts);
    }
    const before = await this.scanQuiet(tab.id);
    const resp = await tabCall<{ focused: string }>(tab.id, "BIGFISH_PRESS_KEY", { key: args.key, ref: args.ref });
    if (!resp.ok) return contentError(resp, args.ref);
    const after = await this.settle(tab.id);
    const focus = resp.focused ? ` | focus: ${resp.focused}` : "";
    return { ok: true, text: `${buildDelta(`press ${args.key}`, before, after)}${focus}`, origin: safeOrigin(tab.url) };
  }

  private async scroll(args: any): Promise<ToolResult> {
    const tab = args.ref ? await this.tabFromRef(args.ref) : await this.tabFromArg(undefined);
    const before = await this.scanQuiet(tab.id, { viewportOnly: true });
    const resp = await tabCall<{ moved: number; position: number; height: number }>(tab.id, "BIGFISH_SCROLL", {
      direction: args.direction,
      amount: args.amount ?? "page",
      ref: args.ref,
    });
    if (!resp.ok) return contentError(resp, args.ref);
    const after = await this.scanQuiet(tab.id, { viewportOnly: true });
    const seen = new Set(before?.elements.map((e) => e.ref));
    const fresh = (after?.elements ?? []).filter((e) => !seen.has(e.ref));
    const list = fresh.slice(0, 20).map((e) => `${e.ref} ${e.role} "${e.name}"`);
    const head =
      resp.moved === 0
        ? `ok scrolled 0px, already at the ${args.direction === "up" ? "top" : "bottom"}`
        : `ok scrolled ${Math.abs(resp.moved)}px (${resp.position}/${resp.height})`;
    return { ok: true, text: list.length ? `${head} | +${fresh.length} new: ${list.join(", ")}` : head, origin: safeOrigin(tab.url) };
  }

  private async waitFor(args: any, opts: ExecuteOptions): Promise<ToolResult> {
    const conds = { text: args.text, gone_text: args.gone_text, ref: args.ref };
    if (!conds.text && !conds.gone_text && !conds.ref && !args.url_contains && !args.idle) {
      fail(ErrorCode.INVALID_ARGS, "Give text, gone_text, url_contains, ref or idle=true.");
    }
    const tab = args.ref ? await this.tabFromRef(args.ref) : await this.tabFromArg(undefined);
    const real = rehydrateArgs("browser_wait_for", conds, safeOrigin(tab.url)).args;
    const deadline = Date.now() + clamp(args.timeout_ms ?? WAIT_DEFAULT_MS, 100, WAIT_MAX_MS);
    const needsPage = Boolean(real.text || real.gone_text || real.ref);

    if (args.idle) {
      // Wait in slices, sending progress so the server's call timeout keeps resetting.
      let quiet = false;
      while (!quiet && Date.now() < deadline) {
        if (opts.signal?.aborted) fail(ErrorCode.TIMEOUT, "Cancelled while waiting.");
        opts.onProgress?.("Waiting for the page to finish");
        const slice = Math.min(10_000, deadline - Date.now());
        const resp = await tabCall<{ quiet: boolean }>(tab.id, "BIGFISH_WAIT_QUIET", { quietMs: IDLE_QUIET_MS, timeoutMs: slice }).catch(() => null);
        quiet = Boolean(resp?.ok && resp.quiet);
      }
      // Some apps (Gmail, dashboards) never go fully quiet. Not an error: report it and go on.
      if (!quiet && !conds.text && !conds.gone_text && !conds.ref && !args.url_contains) {
        const now = await browser.tabs.get(tab.id).catch(() => null);
        return { ok: true, text: `ok waited, page still changing a little | ${now?.title ?? ""}`, origin: safeOrigin(now?.url) };
      }
    }

    for (;;) {
      if (opts.signal?.aborted) fail(ErrorCode.TIMEOUT, "Cancelled while waiting.");
      const now = await browser.tabs.get(tab.id).catch(() => null);
      if (!now) return fail(ErrorCode.TAB_NOT_FOUND, "The tab was closed while waiting.");
      let met = !args.url_contains || (now.url ?? "").includes(args.url_contains);
      if (met && needsPage) {
        const resp = await tabCall<{ met: boolean }>(tab.id, "BIGFISH_CHECK", real).catch(() => null);
        met = Boolean(resp?.ok && resp.met);
      }
      if (met) {
        return { ok: true, text: `ok met | ${now.title ?? ""} | ${(now.url ?? "").replace(/^https?:\/\//, "").slice(0, 60)}`, origin: safeOrigin(now.url) };
      }
      if (Date.now() >= deadline) {
        fail(ErrorCode.TIMEOUT, `Condition not met in time. Page now: ${now.title ?? ""} | ${now.url ?? ""}`, "Snapshot to see the page, then decide.");
      }
      await new Promise((r) => setTimeout(r, 250));
    }
  }

  private async extract(args: any): Promise<ToolResult> {
    const tab = await this.tabFromArg(undefined);
    const filter = rehydrateArgs("browser_extract", { f: args.filter ?? "" }, safeOrigin(tab.url)).args.f;
    const resp = await tabCall<{ text: string }>(tab.id, "BIGFISH_EXTRACT", {
      what: args.what,
      within: args.within,
      filter,
      max: clamp(args.max ?? 25, 1, 200),
    });
    if (!resp.ok) return contentError(resp, args.within);
    return { ok: true, text: resp.text, origin: safeOrigin(tab.url) };
  }

  // ---- helpers ----------------------------------------------------------------------

  private async tabFromArg(slot: number | undefined): Promise<Tab> {
    const tab = slot ? await tabsManager.getTabBySlot(slot) : await tabsManager.getActiveTab();
    if (tab?.id === undefined) fail(ErrorCode.TAB_NOT_FOUND, slot ? `Tab ${slot} not found.` : "No active tab.", "Call browser_tabs list.");
    return tab as Tab;
  }

  private async tabFromRef(ref: string): Promise<Tab> {
    const tab = await tabsManager.getTabForRef(String(ref ?? ""));
    if (tab?.id === undefined) fail(ErrorCode.STALE_REF, `Ref ${ref} belongs to a tab that is gone.`, "Call browser_tabs list, then snapshot.");
    return tab as Tab;
  }

  private async scan(tabId: number, payload: Record<string, unknown> = {}): Promise<ScanResult> {
    const resp = await tabCall<ScanResult>(tabId, "BIGFISH_SCAN", payload);
    if (!resp.ok) throw new ToolFailure(contentError(resp, payload.within as string | undefined));
    return resp;
  }

  // For deltas: a scan that never fails the tool.
  private async scanQuiet(tabId: number, payload: Record<string, unknown> = {}): Promise<ScanResult | null> {
    try {
      return await this.scan(tabId, payload);
    } catch {
      return null;
    }
  }

  // After an action: let the page react (or navigate), then look again.
  private async settle(tabId: number): Promise<ScanResult | null> {
    await new Promise((r) => setTimeout(r, SETTLE_MS));
    const tab = await browser.tabs.get(tabId).catch(() => null);
    if (tab?.status === "loading") await waitForTabLoad(tabId);
    await tabCall(tabId, "BIGFISH_WAIT_QUIET", { quietMs: SETTLE_QUIET_MS, timeoutMs: SETTLE_MAX_MS }).catch(() => null);
    const scan = await this.scanQuiet(tabId);
    if (scan) return scan;
    const now = await browser.tabs.get(tabId).catch(() => null);
    return now ? { elements: [], url: now.url ?? "", title: now.title ?? "", scrollY: 0, scrollHeight: 0 } : null;
  }

  private async describe(tab: Tab, ref: string | undefined): Promise<Descriptor> {
    const resp = await tabCall<{ descriptor: Descriptor }>(tab.id, "BIGFISH_DESCRIBE", { ref });
    if (!resp.ok) throw new ToolFailure(contentError(resp, ref));
    return resp.descriptor;
  }

  // Risky actions wait for the user. After approval the element must still be the same one.
  private async gate(tool: string, args: any, tab: Tab, desc: Descriptor, opts: ExecuteOptions, recheckRef: string | undefined = args.ref): Promise<void> {
    const policy = classifyAction(tool, args, desc);
    if (!policy.needsApproval) return;
    await this.approve(tool, args, tab.url ?? "", policy.reason ?? "This action needs your approval.", opts);
    if (recheckRef) {
      const again = await this.describe(tab, recheckRef).catch(() => null);
      if (!again || again.label !== desc.label || again.role !== desc.role) {
        fail(
          ErrorCode.STALE_APPROVAL,
          `The page changed while waiting for approval (${recheckRef} is not "${desc.label ?? ""}" any more).`,
          "Snapshot again and redo the action.",
        );
      }
    }
  }

  private async approve(tool: string, args: any, origin: string, reason: string, opts: ExecuteOptions): Promise<void> {
    const decision = await approvals.waitForDecision(
      {
        id: `${tool}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        tool,
        args,
        reason,
        origin,
        fingerprint: approvals.computeActionFingerprint(tool, args, origin),
        createdAt: Date.now(),
      },
      { signal: opts.signal, onProgress: opts.onProgress },
    );
    if (decision === "approved") return;
    if (decision === "timeout") fail(ErrorCode.APPROVAL_DENIED, "No answer from the user in time.", "Do not retry. Tell the user what you wanted to do.");
    fail(ErrorCode.APPROVAL_DENIED, "The user said no.", "Do not retry. Report back.");
  }
}

// ---- module helpers -------------------------------------------------------------------

function contentError(resp: any, ref?: string): ToolResult {
  const code = (resp?.error as ErrorCode) || ErrorCode.PAGE_UNRESPONSIVE;
  switch (code) {
    case ErrorCode.STALE_REF: {
      const candidates: string[] = resp.candidates ?? [];
      return {
        ok: false,
        text: toolError(
          code,
          `${ref ?? "That ref"} is gone (the page changed).${resp.reason ? ` ${resp.reason}` : ""}`,
          candidates.length ? `Maybe: ${candidates.join("; ")}` : "Snapshot again.",
        ),
      };
    }
    case ErrorCode.NOT_ACTIONABLE:
      return {
        ok: false,
        text: toolError(
          code,
          `${ref} cannot be used now: ${resp.reason ?? "unknown"}.`,
          resp.coveringRef ? `Close or move ${resp.coveringRef} first.` : "Wait, or scroll it into view.",
        ),
      };
    case ErrorCode.OPTION_NOT_FOUND:
      return { ok: false, text: toolError(code, "No such option.", `Options: ${(resp.options ?? []).join(" | ")}`) };
    case ErrorCode.NOT_EDITABLE:
      return { ok: false, text: toolError(code, `${ref} is not a text field (${resp.reason ?? ""}).`, "Find the real input with browser_find.") };
    default:
      return { ok: false, text: toolError(code, resp?.reason ?? "The page did not answer.", "Wait with browser_wait_for, then try once more.") };
  }
}

async function focusTab(tab: Tab): Promise<void> {
  if (!tab.active) await browser.tabs.update(tab.id, { active: true });
  if (tab.windowId !== undefined) await browser.windows.update(tab.windowId, { focused: true }).catch(() => {});
}

async function activeOrigin(): Promise<string> {
  return safeOrigin((await tabsManager.getActiveTab())?.url);
}

function safeOrigin(url: string | undefined): string {
  try {
    return new URL(url ?? "").origin;
  } catch {
    return "unknown";
  }
}

function clamp(value: unknown, min: number, max: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : min;
}

export const executor = new BrowserToolExecutor();
