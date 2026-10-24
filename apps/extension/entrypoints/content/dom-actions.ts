// BigFish Content DOM Engine: Element ref stamping, fingerprints, actionability verification,
// and DOM manipulation (click, type, key, select, extract).

export interface ElementFingerprint {
  role: string;
  name: string;
  tag: string;
  css: string;
  href?: string;
}

export interface ScannedElement {
  ref: string;
  role: string;
  name: string;
  tag: string;
  value?: string;
  href?: string;
  fp: ElementFingerprint;
}

export class BigFishDOMEngine {
  private elementMap: Map<string, HTMLElement> = new Map();
  private fingerprintMap: Map<string, ElementFingerprint> = new Map();
  private tabSlot: number = 1;
  private idCounter: number = 1;

  setTabSlot(slot: number) {
    this.tabSlot = slot;
  }

  resetRefs() {
    this.elementMap.clear();
    this.fingerprintMap.clear();
    this.idCounter = 1;
  }

  private computeCssSelector(el: HTMLElement): string {
    if (el.id) return `#${CSS.escape(el.id)}`;
    let path = el.tagName.toLowerCase();
    if (el.className && typeof el.className === "string") {
      const classes = el.className.trim().split(/\s+/).slice(0, 2).map((c) => `.${CSS.escape(c)}`).join("");
      path += classes;
    }
    return path;
  }

  private getAccessibleName(el: HTMLElement): string {
    const ariaLabel = el.getAttribute("aria-label");
    if (ariaLabel) return ariaLabel.trim();
    const labelledby = el.getAttribute("aria-labelledby");
    if (labelledby) {
      const lbl = document.getElementById(labelledby);
      if (lbl && lbl.textContent) return lbl.textContent.trim();
    }
    const placeholder = el.getAttribute("placeholder");
    if (placeholder) return placeholder.trim();
    const title = el.getAttribute("title");
    if (title) return title.trim();
    if (el instanceof HTMLInputElement || el instanceof HTMLButtonElement) {
      if (el.value) return el.value.trim();
    }
    return (el.textContent || "").trim().slice(0, 60);
  }

  private getRole(el: HTMLElement): string {
    const roleAttr = el.getAttribute("role");
    if (roleAttr) return roleAttr.toLowerCase();
    const tag = el.tagName.toLowerCase();
    if (tag === "button") return "button";
    if (tag === "a") return "link";
    if (tag === "input") {
      const type = (el as HTMLInputElement).type || "text";
      if (type === "button" || type === "submit") return "button";
      if (type === "checkbox") return "checkbox";
      if (type === "radio") return "radio";
      return "textbox";
    }
    if (tag === "textarea") return "textbox";
    if (tag === "select") return "combobox";
    if (el.isContentEditable) return "textbox";
    return tag;
  }

  scanPage(withinEl?: HTMLElement): ScannedElement[] {
    const root = withinEl || document.body;
    if (!root) return [];

    const results: ScannedElement[] = [];
    const selector = "button, a[href], input, textarea, select, [role='button'], [role='link'], [role='tab'], [role='menuitem'], [contenteditable='true']";
    const candidates = Array.from(root.querySelectorAll<HTMLElement>(selector));

    for (const el of candidates) {
      const rect = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0" || rect.width <= 0 || rect.height <= 0) {
        continue;
      }

      let existingRef = el.getAttribute("data-bigfish-id");
      if (!existingRef || !this.elementMap.has(existingRef)) {
        const id = this.idCounter++;
        existingRef = `${this.tabSlot}:${id}`;
        el.setAttribute("data-bigfish-id", existingRef);
      }

      this.elementMap.set(existingRef, el);

      const role = this.getRole(el);
      const name = this.getAccessibleName(el);
      const tag = el.tagName.toLowerCase();
      const css = this.computeCssSelector(el);
      const href = (el as HTMLAnchorElement).href || el.getAttribute("href") || undefined;
      const val = (el as HTMLInputElement).value;

      const fp: ElementFingerprint = { role, name, tag, css, href };
      this.fingerprintMap.set(existingRef, fp);

      results.push({
        ref: existingRef,
        role,
        name,
        tag,
        value: val !== undefined ? val : undefined,
        href,
        fp,
      });
    }

    return results;
  }

  resolveElement(ref: string, cachedFp?: ElementFingerprint): HTMLElement | null {
    const el = this.elementMap.get(ref);
    if (el && document.contains(el)) {
      return el;
    }

    const domEl = document.querySelector<HTMLElement>(`[data-bigfish-id="${ref}"]`);
    if (domEl && document.contains(domEl)) {
      this.elementMap.set(ref, domEl);
      return domEl;
    }

    const fp = cachedFp || this.fingerprintMap.get(ref);
    if (fp) {
      return this.resolveByFingerprint(fp, ref);
    }

    return null;
  }

  resolveByFingerprint(fp: ElementFingerprint, targetRef?: string): HTMLElement | null {
    if (typeof document === "undefined") return null;
    if (fp.css) {
      try {
        const el = document.querySelector<HTMLElement>(fp.css);
        if (el && document.contains(el)) {
          if (targetRef) {
            el.setAttribute("data-bigfish-id", targetRef);
            this.elementMap.set(targetRef, el);
          }
          return el;
        }
      } catch {}
    }

    const candidates = Array.from(document.querySelectorAll<HTMLElement>(fp.tag || "*"));
    for (const el of candidates) {
      const name = this.getAccessibleName(el);
      const role = this.getRole(el);
      if (role === fp.role && name === fp.name) {
        if (targetRef) {
          el.setAttribute("data-bigfish-id", targetRef);
          this.elementMap.set(targetRef, el);
        }
        return el;
      }
    }

    return null;
  }

  async waitActionable(el: HTMLElement, timeoutMs: number = 3000): Promise<{ ok: boolean; reason?: string; coveringRef?: string }> {
    const startTime = Date.now();

    while (Date.now() - startTime < timeoutMs) {
      el.scrollIntoView({ block: "nearest", inline: "nearest" });
      const rect1 = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);

      if (style.display === "none" || style.visibility === "hidden" || parseFloat(style.opacity) < 0.1) {
        await new Promise((r) => setTimeout(r, 60));
        continue;
      }

      if ((el as HTMLButtonElement).disabled) {
        return { ok: false, reason: "Element is disabled" };
      }

      await new Promise((r) => setTimeout(r, 50));
      const rect2 = el.getBoundingClientRect();

      const isStable = Math.abs(rect1.left - rect2.left) < 1 && Math.abs(rect1.top - rect2.top) < 1;
      if (!isStable) {
        continue;
      }

      const centerX = rect2.left + rect2.width / 2;
      const centerY = rect2.top + rect2.height / 2;
      const topEl = document.elementFromPoint(centerX, centerY);

      if (topEl && (topEl === el || el.contains(topEl) || topEl.contains(el))) {
        return { ok: true };
      }

      const coveringRef = topEl?.getAttribute("data-bigfish-id") || undefined;
      return { ok: false, reason: "Element is covered by another element", coveringRef };
    }

    return { ok: false, reason: "Timeout waiting for element actionability" };
  }

  describeElement(el: HTMLElement) {
    const role = this.getRole(el);
    const label = this.getAccessibleName(el);
    const form = el.closest("form");
    let formSubmitLabel: string | undefined = undefined;
    if (form) {
      const submitBtn = form.querySelector<HTMLElement>("button[type='submit'], input[type='submit'], button:not([type])");
      if (submitBtn) {
        formSubmitLabel = this.getAccessibleName(submitBtn);
      }
    }
    const isSearch = el.getAttribute("type") === "search" || role === "searchbox" || /\bsearch\b/i.test(label);
    return {
      role,
      label,
      formSubmitLabel,
      isSearch,
      origin: window.location.origin,
    };
  }

  extractTables(withinEl?: HTMLElement, maxRows: number = 25): string {
    if (typeof document === "undefined") return "No tables found on page.";
    const root = withinEl || document.body;
    if (!root) return "No tables found on page.";
    const tables = Array.from(root.querySelectorAll("table"));
    if (tables.length === 0) return "No tables found on page.";

    const targetTable = tables[0];
    const rows = Array.from(targetTable.querySelectorAll("tr")).slice(0, maxRows);
    const tsvRows = rows.map((row) => {
      const cells = Array.from(row.querySelectorAll("th, td"));
      return cells.map((cell) => (cell.textContent || "").replace(/\t|\n/g, " ").trim()).join("\t");
    });

    return `ok table ${tsvRows.length} rows\n` + tsvRows.join("\n");
  }
}

export const bigFishDOM = new BigFishDOMEngine();
if (typeof window !== "undefined") {
  (window as any).BigFishDOM = bigFishDOM;
}
