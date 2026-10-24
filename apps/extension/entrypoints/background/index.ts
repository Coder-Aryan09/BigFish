// BigFish service worker: bridge WS client, executor, vault, policy, approvals.
export default defineBackground(() => {
  browser.sidePanel?.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
  console.log("[BigFish] service worker started");
});
