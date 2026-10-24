// BigFish service worker: Google login, the MCP connection to the server,
// tab tracking, side panel behavior, and approvals.
import { tabsManager } from "./tabs.js";
import { currentEmail, signIn, signOut } from "./auth.js";
import { Connection } from "./conn/connection.js";
import { approvals } from "../../safety/approval.js";

// Wakes the service worker, so a dropped connection comes back even if Chrome
// stopped the worker while it was waiting in backoff.
const KEEPALIVE_ALARM = "bigfish-keepalive";

export default defineBackground(() => {
  console.log("[BigFish] service worker started");

  const connection = new Connection((status) => {
    console.log("[BigFish] connection", status.state, status.detail ?? "");
    browser.runtime.sendMessage({ type: "BIGFISH_CONN_STATUS", status }).catch(() => {
      // Side panel not open.
    });
  });

  browser.sidePanel?.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});

  // Listeners first: MV3 only delivers events to listeners added synchronously at startup.
  browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === KEEPALIVE_ALARM) connection.ensureConnected();
  });
  browser.runtime.onStartup.addListener(() => connection.ensureConnected());
  browser.runtime.onInstalled.addListener(() => connection.ensureConnected());
  void browser.alarms.create(KEEPALIVE_ALARM, { periodInMinutes: 0.5 });
  connection.ensureConnected();

  // Tab tracking
  browser.tabs.onCreated.addListener((tab) => {
    if (tab.id) tabsManager.registerTab(tab.id);
  });

  // Relay approval requests to side panel or popup window
  approvals.onApprovalRequested(async (req) => {
    try {
      browser.runtime.sendMessage({ type: "BIGFISH_APPROVAL_REQUEST", payload: req }).catch(() => {
        // If side panel is not open, open popup approval window
        browser.windows.create({
          url: browser.runtime.getURL(`/sidepanel.html?approvalId=${req.id}`),
          type: "popup",
          width: 420,
          height: 520,
        });
      });
    } catch (e) {
      console.warn("[BigFish] Failed to broadcast approval", e);
    }
  });

  // Messages from the side panel. Async handlers answer through sendResponse.
  browser.runtime.onMessage.addListener((msg: any, _sender, sendResponse) => {
    const reply = (work: Promise<unknown>) => {
      work.then(
        (value) => sendResponse({ ok: true, ...(value as object) }),
        (err) => sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) }),
      );
      return true;
    };

    switch (msg?.type) {
      case "RESOLVE_APPROVAL":
        sendResponse({ ok: approvals.resolveDecision(msg.id, msg.approved) });
        return false;
      case "KILL_SWITCH":
        return reply(connection.kill());
      case "BIGFISH_PANEL_OPENED":
        connection.ensureConnected();
        return reply(statusPayload());
      case "BIGFISH_GET_STATUS":
        return reply(statusPayload());
      case "BIGFISH_SIGN_IN":
        return reply(
          signIn().then(async () => {
            await connection.resume();
            return statusPayload();
          }),
        );
      case "BIGFISH_SIGN_OUT":
        connection.signedOut();
        return reply(signOut().then(statusPayload));
      case "BIGFISH_CONNECT":
        return reply(connection.resume().then(statusPayload));
      default:
        return false;
    }
  });

  async function statusPayload() {
    return { status: connection.getStatus(), email: await currentEmail() };
  }
});
