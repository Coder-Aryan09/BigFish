// BigFish Tab Manager: Slot to TabId mappings and "BigFish" tab group management.

export class TabManager {
  private slotToTabId: Map<number, number> = new Map();
  private tabIdToSlot: Map<number, number> = new Map();
  private bigFishTabIds: Set<number> = new Set();
  private nextSlot: number = 1;

  async getActiveTab(): Promise<chrome.tabs.Tab | null> {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    return tabs[0] || null;
  }

  async getTabBySlot(slot: number): Promise<chrome.tabs.Tab | null> {
    const tabId = this.slotToTabId.get(slot);
    if (!tabId) return null;
    try {
      return await chrome.tabs.get(tabId);
    } catch {
      this.slotToTabId.delete(slot);
      this.tabIdToSlot.delete(tabId);
      return null;
    }
  }

  registerTab(tabId: number, isAgentCreated: boolean = false): number {
    let slot = this.tabIdToSlot.get(tabId);
    if (!slot) {
      slot = this.nextSlot++;
      this.slotToTabId.set(slot, tabId);
      this.tabIdToSlot.set(tabId, slot);
    }
    if (isAgentCreated) {
      this.bigFishTabIds.add(tabId);
    }
    return slot;
  }

  isAgentTab(tabId: number): boolean {
    return this.bigFishTabIds.has(tabId);
  }

  async listTabs(): Promise<{ slot: number; title: string; url: string; active: boolean; isBigFish: boolean }[]> {
    const allTabs = await chrome.tabs.query({});
    const result: { slot: number; title: string; url: string; active: boolean; isBigFish: boolean }[] = [];

    for (const tab of allTabs) {
      if (!tab.id) continue;
      const slot = this.registerTab(tab.id);
      result.push({
        slot,
        title: tab.title || "Untitled",
        url: tab.url || "",
        active: !!tab.active,
        isBigFish: this.isAgentTab(tab.id),
      });
    }

    result.sort((a, b) => a.slot - b.slot);
    return result;
  }

  async openInBigFishGroup(url: string): Promise<chrome.tabs.Tab> {
    const newTab = await chrome.tabs.create({ url, active: true });
    if (!newTab.id) return newTab;

    this.registerTab(newTab.id, true);

    try {
      if (chrome.tabGroups) {
        const groups = await chrome.tabGroups.query({ title: "BigFish" });
        let groupId = groups[0]?.id;
        if (!groupId) {
          groupId = await chrome.tabs.group({ tabIds: newTab.id });
          await chrome.tabGroups.update(groupId, { title: "BigFish", color: "blue" });
        } else {
          await chrome.tabs.group({ tabIds: newTab.id, groupId });
        }
      }
    } catch (e) {
      console.warn("[BigFish Tabs] Could not add to tab group", e);
    }

    return newTab;
  }
}

export const tabsManager = new TabManager();
