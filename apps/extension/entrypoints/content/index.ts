// BigFish Content Script Main Handler: Dispatches operations from the background service worker.
import { bigFishDOM } from "./dom-actions";

export default defineContentScript({
  matches: ["<all_urls>"],
  runAt: "document_idle",
  main() {
    (window as any).__BIGFISH_CONTENT__ = true;

    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (!message || typeof message !== "object") return;

      const { type, payload } = message;

      if (type === "BIGFISH_PING") {
        sendResponse({ ok: true, url: window.location.href, title: document.title });
        return true;
      }

      if (type === "BIGFISH_SET_TAB_SLOT") {
        bigFishDOM.setTabSlot(payload.slot);
        sendResponse({ ok: true });
        return true;
      }

      if (type === "BIGFISH_SCAN_PAGE") {
        let withinEl: HTMLElement | undefined = undefined;
        if (payload?.within) {
          withinEl = bigFishDOM.resolveElement(payload.within) || undefined;
        }
        const elements = bigFishDOM.scanPage(withinEl);
        sendResponse({
          ok: true,
          elements,
          url: window.location.href,
          title: document.title,
          scrollHeight: document.documentElement.scrollHeight,
          scrollY: window.scrollY,
        });
        return true;
      }

      if (type === "BIGFISH_DESCRIBE") {
        const el = bigFishDOM.resolveElement(payload.ref, payload.fp);
        if (!el) {
          sendResponse({ ok: false, error: "STALE_REF" });
          return true;
        }
        const desc = bigFishDOM.describeElement(el);
        sendResponse({ ok: true, descriptor: desc });
        return true;
      }

      if (type === "BIGFISH_CLICK") {
        (async () => {
          const el = bigFishDOM.resolveElement(payload.ref, payload.fp);
          if (!el) {
            sendResponse({ ok: false, error: "STALE_REF" });
            return;
          }
          const actionable = await bigFishDOM.waitActionable(el, 3000);
          if (!actionable.ok) {
            sendResponse({ ok: false, error: "NOT_ACTIONABLE", reason: actionable.reason, coveringRef: actionable.coveringRef });
            return;
          }

          el.focus();
          el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
          el.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true }));
          el.click();

          sendResponse({ ok: true });
        })();
        return true;
      }

      if (type === "BIGFISH_TYPE") {
        (async () => {
          const el = bigFishDOM.resolveElement(payload.ref, payload.fp);
          if (!el) {
            sendResponse({ ok: false, error: "STALE_REF" });
            return;
          }
          const actionable = await bigFishDOM.waitActionable(el, 3000);
          if (!actionable.ok) {
            sendResponse({ ok: false, error: "NOT_ACTIONABLE", reason: actionable.reason });
            return;
          }

          if (
            !(el instanceof HTMLInputElement) &&
            !(el instanceof HTMLTextAreaElement) &&
            !el.isContentEditable
          ) {
            sendResponse({ ok: false, error: "NOT_EDITABLE" });
            return;
          }

          el.focus();
          if (payload.clear !== false) {
            if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
              el.value = "";
            } else if (el.isContentEditable) {
              el.textContent = "";
            }
          }

          if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
            el.value = payload.text;
            el.dispatchEvent(new Event("input", { bubbles: true }));
            el.dispatchEvent(new Event("change", { bubbles: true }));
          } else if (el.isContentEditable) {
            el.textContent = payload.text;
            el.dispatchEvent(new Event("input", { bubbles: true }));
          }

          if (payload.submit) {
            const form = el.closest("form");
            if (form) {
              form.requestSubmit ? form.requestSubmit() : form.submit();
            } else {
              el.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", bubbles: true }));
              el.dispatchEvent(new KeyboardEvent("keyup", { key: "Enter", code: "Enter", bubbles: true }));
            }
          }

          sendResponse({ ok: true });
        })();
        return true;
      }

      if (type === "BIGFISH_PRESS_KEY") {
        (async () => {
          let targetEl: HTMLElement | null = null;
          if (payload.ref) {
            targetEl = bigFishDOM.resolveElement(payload.ref, payload.fp);
          } else {
            targetEl = (document.activeElement as HTMLElement) || document.body;
          }

          if (!targetEl) {
            sendResponse({ ok: false, error: "STALE_REF" });
            return;
          }

          targetEl.focus();
          targetEl.dispatchEvent(new KeyboardEvent("keydown", { key: payload.key, bubbles: true }));
          targetEl.dispatchEvent(new KeyboardEvent("keyup", { key: payload.key, bubbles: true }));
          sendResponse({ ok: true });
        })();
        return true;
      }

      if (type === "BIGFISH_SCROLL") {
        const amountPx = payload.amount === "half" ? window.innerHeight / 2 : window.innerHeight * 0.85;
        const delta = payload.direction === "up" ? -amountPx : amountPx;
        window.scrollBy({ top: delta, behavior: "smooth" });
        sendResponse({ ok: true, scrollPx: delta });
        return true;
      }

      if (type === "BIGFISH_FIND") {
        const query = (payload.query || "").toLowerCase();
        const elements = bigFishDOM.scanPage();
        const matches = elements
          .filter((e) => e.name.toLowerCase().includes(query) || e.role.toLowerCase().includes(query))
          .slice(0, 5);
        sendResponse({ ok: true, matches });
        return true;
      }

      if (type === "BIGFISH_EXTRACT") {
        if (payload.what === "table") {
          const tsv = bigFishDOM.extractTables(undefined, payload.max || 25);
          sendResponse({ ok: true, text: tsv });
          return true;
        }
        sendResponse({ ok: true, text: "ok extracted" });
        return true;
      }

      return false;
    });
  },
});
