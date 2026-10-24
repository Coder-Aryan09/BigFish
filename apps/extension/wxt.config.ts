import { defineConfig } from "wxt";

export default defineConfig({
  manifest: {
    name: "BigFish: Private Browser for Any Agent",
    description: "Expose your real browser to AI agents over MCP, with PII kept local.",
    minimum_chrome_version: "116",
    permissions: ["tabs", "activeTab", "scripting", "storage", "sidePanel", "tabGroups", "alarms"],
    host_permissions: ["<all_urls>"],
    action: { default_title: "BigFish", default_icon: "icon/icon.svg" },
  },
});
