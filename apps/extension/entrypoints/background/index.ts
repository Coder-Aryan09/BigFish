// BigFish Service Worker Entrypoint: Initializes bridge WS client,
// tab registry, side panel behavior, and approvals.
import { bridgeClient } from "./bridge.js";
import { tabsManager } from "./tabs.js";
import { approvals } from "../../safety/approval.js";

export default defineBackground(() => {
  console.log("[BigFish] service worker started");

  // Configure side panel behavior
  browser.sidePanel?.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});

  // Connect to the BigFish server over WebSocket
  bridgeClient.connect();

  // Tab tracking
  chrome.tabs.onCreated.addListener((tab) => {
    if (tab.id) tabsManager.registerTab(tab.id);
  });

  // Relay approval requests to side panel or popup window
  approvals.onApprovalRequested(async (req) => {
    try {
      chrome.runtime.sendMessage({ type: "BIGFISH_APPROVAL_REQUEST", payload: req }).catch(() => {
        // If side panel is not open, open popup approval window
        chrome.windows.create({
          url: chrome.runtime.getURL(`sidepanel.html?approvalId=${req.id}`),
          type: "popup",
          width: 420,
          height: 520,
        });
      });
    } catch (e) {
      console.warn("[BigFish] Failed to broadcast approval", e);
    }
  });

  // Handle messages from side panel
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type === "RESOLVE_APPROVAL") {
      const ok = approvals.resolveDecision(msg.id, msg.approved);
      sendResponse({ ok });
      return true;
    }
    if (msg?.type === "KILL_SWITCH") {
      bridgeClient.kill();
      sendResponse({ ok: true });
      return true;
    }
    return false;
  });
});
