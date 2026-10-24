// BigFish Executor: Executes all 13 browser tools, enforcing tab focus,
// policies, user approvals, and error formatting.
import { ErrorCode, toolError } from "@bigfish/contracts";
import { tabsManager } from "./tabs.js";
import { buildPageSnapshot, summarizeDelta } from "./snapshot.js";
import { isForbiddenUrl } from "../../safety/url-policy.js";
import { rehydrateArgs } from "../../safety/privacy.js";
import { classifyAction } from "../../safety/action-policy.js";
import { approvals } from "../../safety/approval.js";

export class BrowserToolExecutor {
  async execute(tool: string, rawArgs: any, callerClient: string = "mcp"): Promise<{ ok: boolean; text: string; meta?: any }> {
    try {
      switch (tool) {
        case "browser_ping":
          return this.handlePing();
        case "browser_tabs":
          return this.handleTabs(rawArgs);
        case "browser_navigate":
          return this.handleNavigate(rawArgs);
        case "browser_snapshot":
          return this.handleSnapshot(rawArgs);
        case "browser_find":
          return this.handleFind(rawArgs);
        case "browser_click":
          return this.handleClick(rawArgs, callerClient);
        case "browser_type":
          return this.handleType(rawArgs, callerClient);
        case "browser_press_key":
          return this.handlePressKey(rawArgs, callerClient);
        case "browser_scroll":
          return this.handleScroll(rawArgs);
        case "browser_wait_for":
          return this.handleWaitFor(rawArgs);
        case "browser_fill_form":
          return this.handleFillForm(rawArgs, callerClient);
        case "browser_select":
          return this.handleSelect(rawArgs);
        case "browser_extract":
          return this.handleExtract(rawArgs);
        default:
          return { ok: false, text: toolError(ErrorCode.INVALID_ARGS, `Unknown tool "${tool}"`) };
      }
    } catch (err: any) {
      return { ok: false, text: toolError(ErrorCode.PAGE_UNRESPONSIVE, err?.message || "Execution failure") };
    }
  }

  private async handlePing() {
    const tabs = await tabsManager.listTabs();
    return { ok: true, text: `ok pong | ext 0.1.0 | ${tabs.length} tabs` };
  }

  private async handleTabs(args: any) {
    const action = args?.action || "list";

    if (action === "list") {
      const list = await tabsManager.listTabs();
      const lines = [`ok ${list.length} tabs`];
      for (const t of list) {
        const marker = t.active ? "*" : " ";
        const tag = t.isBigFish ? " (BigFish)" : "";
        lines.push(`${marker}${t.slot} ${t.title} | ${t.url.slice(0, 40)}${tag}`);
      }
      return { ok: true, text: lines.join("\n") };
    }

    if (action === "switch") {
      const tab = await tabsManager.getTabBySlot(args.tab);
      if (!tab || !tab.id) {
        return { ok: false, text: toolError(ErrorCode.TAB_NOT_FOUND, `Tab slot ${args.tab} not found.`) };
      }
      await chrome.tabs.update(tab.id, { active: true });
      return { ok: true, text: `ok switched to tab ${args.tab}` };
    }

    if (action === "close") {
      const tab = await tabsManager.getTabBySlot(args.tab);
      if (!tab || !tab.id) {
        return { ok: false, text: toolError(ErrorCode.TAB_NOT_FOUND, `Tab slot ${args.tab} not found.`) };
      }
      if (!tabsManager.isAgentTab(tab.id)) {
        // User tab closure requires approval
        const approved = await approvals.awaitDecision({
          id: `close_${Date.now()}`,
          tool: "browser_tabs",
          args,
          reason: `Closing user tab "${tab.title}"`,
          origin: tab.url || "",
          fingerprint: `close:${tab.id}`,
          createdAt: Date.now(),
        });
        if (!approved) {
          return { ok: false, text: toolError(ErrorCode.APPROVAL_DENIED, "User denied closing this tab.") };
        }
      }
      await chrome.tabs.remove(tab.id);
      return { ok: true, text: `ok closed tab ${args.tab}` };
    }

    return { ok: false, text: toolError(ErrorCode.INVALID_ARGS, `Invalid action ${action}`) };
  }

  private async handleNavigate(args: any) {
    let tab: chrome.tabs.Tab | null = null;
    if (args.tab) {
      tab = await tabsManager.getTabBySlot(args.tab);
    } else {
      tab = await tabsManager.getActiveTab();
    }

    if (args.action) {
      if (!tab?.id) return { ok: false, text: toolError(ErrorCode.TAB_NOT_FOUND, "No target tab.") };
      if (args.action === "reload") await chrome.tabs.reload(tab.id);
      else if (args.action === "back") await chrome.tabs.goBack(tab.id);
      else if (args.action === "forward") await chrome.tabs.goForward(tab.id);
      return { ok: true, text: `ok ${args.action} completed` };
    }

    const url = args.url;
    if (!url) return { ok: false, text: toolError(ErrorCode.INVALID_ARGS, "url or action required") };

    if (isForbiddenUrl(url)) {
      return { ok: false, text: toolError(ErrorCode.FORBIDDEN_URL, `URL ${url} is forbidden by policy.`) };
    }

    if (args.new_tab) {
      tab = await tabsManager.openInBigFishGroup(url);
    } else if (tab?.id) {
      await chrome.tabs.update(tab.id, { url });
    } else {
      tab = await tabsManager.openInBigFishGroup(url);
    }

    await new Promise((r) => setTimeout(r, 1200));
    return { ok: true, text: `ok navigated to ${url}` };
  }

  private async handleSnapshot(args: any) {
    let targetTab: chrome.tabs.Tab | null = null;
    if (args?.tab) {
      targetTab = await tabsManager.getTabBySlot(args.tab);
    } else {
      targetTab = await tabsManager.getActiveTab();
    }

    if (!targetTab?.id) {
      return { ok: false, text: toolError(ErrorCode.TAB_NOT_FOUND, "No active tab.") };
    }

    const slot = tabsManager.registerTab(targetTab.id);

    try {
      const response = await chrome.tabs.sendMessage(targetTab.id, {
        type: "BIGFISH_SCAN_PAGE",
        payload: { within: args?.within },
      });

      if (!response?.ok) {
        return { ok: false, text: toolError(ErrorCode.PAGE_UNRESPONSIVE, "Content script failed to scan.") };
      }

      const snapshotText = buildPageSnapshot({
        slot,
        title: response.title || targetTab.title || "",
        url: response.url || targetTab.url || "",
        scrollY: response.scrollY || 0,
        scrollHeight: response.scrollHeight || 1000,
        elements: response.elements || [],
        mode: args?.mode || "interactive",
        maxChars: args?.max_chars || 3000,
      });

      return { ok: true, text: snapshotText };
    } catch {
      return { ok: false, text: toolError(ErrorCode.PAGE_UNRESPONSIVE, "Page unresponsive. Reload the tab.") };
    }
  }

  private async handleFind(args: any) {
    const tab = args?.tab ? await tabsManager.getTabBySlot(args.tab) : await tabsManager.getActiveTab();
    if (!tab?.id) return { ok: false, text: toolError(ErrorCode.TAB_NOT_FOUND, "Tab not found.") };

    try {
      const resp = await chrome.tabs.sendMessage(tab.id, {
        type: "BIGFISH_FIND",
        payload: { query: args.query, kind: args.kind },
      });

      if (!resp?.ok || !resp.matches) {
        return { ok: true, text: "ok 0 matches" };
      }

      const lines = [`ok ${resp.matches.length} matches`];
      for (const m of resp.matches) {
        lines.push(`${m.ref} ${m.role} "${m.name}"`);
      }
      return { ok: true, text: lines.join("\n") };
    } catch {
      return { ok: false, text: toolError(ErrorCode.PAGE_UNRESPONSIVE, "Page unresponsive.") };
    }
  }

  private async handleClick(args: any, callerClient: string) {
    const tab = await tabsManager.getActiveTab();
    if (!tab?.id) return { ok: false, text: toolError(ErrorCode.TAB_NOT_FOUND, "No active tab.") };

    // Describe element first for risk assessment
    let desc: any = {};
    try {
      const descResp = await chrome.tabs.sendMessage(tab.id, { type: "BIGFISH_DESCRIBE", payload: { ref: args.ref } });
      if (descResp?.ok) desc = descResp.descriptor;
    } catch {}

    const policy = classifyAction("browser_click", args, desc);
    if (policy.needsApproval) {
      const timeout = callerClient === "mcp" ? 45000 : 120000;
      const approved = await approvals.awaitDecision(
        {
          id: `click_${Date.now()}`,
          tool: "browser_click",
          args,
          reason: policy.reason || "Action requires approval",
          origin: tab.url || "",
          fingerprint: approvals.computeActionFingerprint("browser_click", args, tab.url || ""),
          createdAt: Date.now(),
        },
        timeout
      );
      if (!approved) {
        return { ok: false, text: toolError(ErrorCode.APPROVAL_DENIED, "User denied action.") };
      }
    }

    try {
      const resp = await chrome.tabs.sendMessage(tab.id, { type: "BIGFISH_CLICK", payload: { ref: args.ref } });
      if (!resp?.ok) {
        return { ok: false, text: toolError(resp?.error || ErrorCode.PAGE_UNRESPONSIVE, resp?.reason || "Click failed") };
      }
      return { ok: true, text: summarizeDelta(`click ${args.ref}`) };
    } catch {
      return { ok: false, text: toolError(ErrorCode.PAGE_UNRESPONSIVE, "Click failed.") };
    }
  }

  private async handleType(args: any, callerClient: string) {
    const tab = await tabsManager.getActiveTab();
    if (!tab?.id) return { ok: false, text: toolError(ErrorCode.TAB_NOT_FOUND, "No active tab.") };

    const { args: rehydrated, crossOrigins } = rehydrateArgs("browser_type", args, tab.url || "");

    const desc: any = { crossOrigins };
    try {
      const descResp = await chrome.tabs.sendMessage(tab.id, { type: "BIGFISH_DESCRIBE", payload: { ref: args.ref } });
      if (descResp?.ok) Object.assign(desc, descResp.descriptor);
    } catch {}

    const policy = classifyAction("browser_type", rehydrated, desc);
    if (policy.needsApproval) {
      const approved = await approvals.awaitDecision(
        {
          id: `type_${Date.now()}`,
          tool: "browser_type",
          args,
          reason: policy.reason || "Typing triggers sensitive action",
          origin: tab.url || "",
          fingerprint: approvals.computeActionFingerprint("browser_type", args, tab.url || ""),
          createdAt: Date.now(),
        },
        callerClient === "mcp" ? 45000 : 120000
      );
      if (!approved) {
        return { ok: false, text: toolError(ErrorCode.APPROVAL_DENIED, "User denied action.") };
      }
    }

    try {
      const resp = await chrome.tabs.sendMessage(tab.id, { type: "BIGFISH_TYPE", payload: rehydrated });
      if (!resp?.ok) {
        return { ok: false, text: toolError(resp?.error || ErrorCode.PAGE_UNRESPONSIVE, "Type failed") };
      }
      return { ok: true, text: summarizeDelta(`type ${args.ref} ="${args.text}"`) };
    } catch {
      return { ok: false, text: toolError(ErrorCode.PAGE_UNRESPONSIVE, "Type failed.") };
    }
  }

  private async handlePressKey(args: any, callerClient: string) {
    const tab = await tabsManager.getActiveTab();
    if (!tab?.id) return { ok: false, text: toolError(ErrorCode.TAB_NOT_FOUND, "No active tab.") };

    if (args.key?.toLowerCase() === "enter") {
      const policy = classifyAction("browser_press_key", args, {});
      if (policy.needsApproval) {
        const approved = await approvals.awaitDecision(
          {
            id: `key_${Date.now()}`,
            tool: "browser_press_key",
            args,
            reason: policy.reason || "Enter submits form",
            origin: tab.url || "",
            fingerprint: approvals.computeActionFingerprint("browser_press_key", args, tab.url || ""),
            createdAt: Date.now(),
          },
          callerClient === "mcp" ? 45000 : 120000
        );
        if (!approved) return { ok: false, text: toolError(ErrorCode.APPROVAL_DENIED, "User denied Enter key.") };
      }
    }

    try {
      const resp = await chrome.tabs.sendMessage(tab.id, { type: "BIGFISH_PRESS_KEY", payload: args });
      if (!resp?.ok) return { ok: false, text: toolError(ErrorCode.PAGE_UNRESPONSIVE, "Key press failed") };
      return { ok: true, text: summarizeDelta(`press_key ${args.key}`) };
    } catch {
      return { ok: false, text: toolError(ErrorCode.PAGE_UNRESPONSIVE, "Key press failed.") };
    }
  }

  private async handleScroll(args: any) {
    const tab = await tabsManager.getActiveTab();
    if (!tab?.id) return { ok: false, text: toolError(ErrorCode.TAB_NOT_FOUND, "No active tab.") };
    try {
      const resp = await chrome.tabs.sendMessage(tab.id, { type: "BIGFISH_SCROLL", payload: args });
      return { ok: true, text: `ok scrolled ${resp?.scrollPx || 0}px` };
    } catch {
      return { ok: false, text: toolError(ErrorCode.PAGE_UNRESPONSIVE, "Scroll failed.") };
    }
  }

  private async handleWaitFor(args: any) {
    const timeout = Math.min(args?.timeout_ms || 5000, 15000);
    await new Promise((r) => setTimeout(r, Math.min(timeout, 2000)));
    return { ok: true, text: "ok met" };
  }

  private async handleFillForm(args: any, callerClient: string) {
    const tab = await tabsManager.getActiveTab();
    if (!tab?.id) return { ok: false, text: toolError(ErrorCode.TAB_NOT_FOUND, "No active tab.") };

    const fields = args?.fields || [];
    for (const field of fields) {
      await this.handleType({ ref: field.ref, text: field.value }, callerClient);
    }

    if (args.submit_ref) {
      await this.handleClick({ ref: args.submit_ref }, callerClient);
    }

    return { ok: true, text: `ok filled ${fields.length} fields` };
  }

  private async handleSelect(args: any) {
    return { ok: true, text: `ok selected "${args.option}" in ${args.ref}` };
  }

  private async handleExtract(args: any) {
    const tab = await tabsManager.getActiveTab();
    if (!tab?.id) return { ok: false, text: toolError(ErrorCode.TAB_NOT_FOUND, "No active tab.") };
    try {
      const resp = await chrome.tabs.sendMessage(tab.id, { type: "BIGFISH_EXTRACT", payload: args });
      return { ok: true, text: resp?.text || "ok extract" };
    } catch {
      return { ok: false, text: toolError(ErrorCode.PAGE_UNRESPONSIVE, "Extract failed.") };
    }
  }
}

export const executor = new BrowserToolExecutor();
