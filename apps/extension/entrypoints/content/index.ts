// BigFish content script: DOM actions and page snapshots.
export default defineContentScript({
  matches: ["<all_urls>"],
  runAt: "document_idle",
  main() {
    (window as any).__BIGFISH_CONTENT__ = true;
  },
});
