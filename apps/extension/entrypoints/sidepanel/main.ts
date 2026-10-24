// BigFish Simplified Entry Controller

document.addEventListener("DOMContentLoaded", () => {
  const inputEl = document.querySelector<HTMLTextAreaElement>("#cmd-input");
  const submitBtn = document.querySelector<HTMLButtonElement>("#btn-submit");
  const resetBtn = document.querySelector<HTMLButtonElement>("#btn-reset");
  const welcomeView = document.querySelector<HTMLElement>("#welcome-view");
  const feedView = document.querySelector<HTMLElement>("#feed-view");
  const slashBtn = document.querySelector<HTMLButtonElement>("#btn-quick-command");
  const slashMenu = document.querySelector<HTMLElement>("#slash-menu");
  const actionCards = document.querySelectorAll<HTMLButtonElement>(".action-card");
  const activeTabTitle = document.querySelector<HTMLElement>("#active-tab-title");

  // Detect active tab title if running inside Chrome extension
  if (typeof chrome !== "undefined" && chrome.tabs && chrome.tabs.query) {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs && tabs[0] && tabs[0].title && activeTabTitle) {
        activeTabTitle.textContent = tabs[0].title;
      }
    });
  }

  // Quick Action Cards trigger
  actionCards.forEach((card) => {
    card.addEventListener("click", () => {
      const cmd = card.getAttribute("data-cmd");
      if (cmd) {
        executeCommand(cmd);
      }
    });
  });

  // Slash commands toggle
  if (slashBtn && slashMenu) {
    slashBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      slashMenu.style.display = slashMenu.style.display === "none" ? "flex" : "none";
    });

    document.addEventListener("click", (e) => {
      if (!slashMenu.contains(e.target as Node) && e.target !== slashBtn) {
        slashMenu.style.display = "none";
      }
    });

    slashMenu.querySelectorAll(".menu-item").forEach((item) => {
      item.addEventListener("click", () => {
        const cmd = item.getAttribute("data-cmd");
        if (cmd && inputEl) {
          inputEl.value = `${cmd} `;
          inputEl.focus();
          slashMenu.style.display = "none";
        }
      });
    });
  }

  // Auto-resize input & handle Enter key
  if (inputEl) {
    inputEl.addEventListener("input", () => {
      inputEl.style.height = "auto";
      inputEl.style.height = `${Math.min(inputEl.scrollHeight, 100)}px`;
    });

    inputEl.addEventListener("keydown", (e: KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        const text = inputEl.value.trim();
        if (text) {
          executeCommand(text);
          inputEl.value = "";
          inputEl.style.height = "auto";
        }
      }
    });
  }

  if (submitBtn && inputEl) {
    submitBtn.addEventListener("click", () => {
      const text = inputEl.value.trim();
      if (text) {
        executeCommand(text);
        inputEl.value = "";
        inputEl.style.height = "auto";
      }
    });
  }

  // Reset to Home/Welcome View
  if (resetBtn && welcomeView && feedView) {
    resetBtn.addEventListener("click", () => {
      feedView.innerHTML = "";
      feedView.style.display = "none";
      welcomeView.style.display = "flex";
      if (inputEl) inputEl.focus();
    });
  }

  // Execute a prompt/command
  function executeCommand(prompt: string): void {
    if (!welcomeView || !feedView) return;

    // Switch view
    welcomeView.style.display = "none";
    feedView.style.display = "flex";

    // Append user card
    const taskContainer = document.createElement("div");
    taskContainer.className = "task-item";

    const userCard = document.createElement("div");
    userCard.className = "user-prompt-card";
    userCard.textContent = prompt;
    taskContainer.appendChild(userCard);

    // Agent response card (loading)
    const agentCard = document.createElement("div");
    agentCard.className = "agent-result-card";
    agentCard.innerHTML = `
      <div class="result-header">
        <span class="result-badge" style="color: #2563eb; background-color: #eff6ff;">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <circle cx="12" cy="12" r="10"></circle>
            <polyline points="12 6 12 12 16 14"></polyline>
          </svg>
          Inspecting page...
        </span>
        <span class="result-tool">browser_snapshot</span>
      </div>
      <div class="result-body">
        Scanning active DOM nodes and applying local PII safety vault...
      </div>
    `;
    taskContainer.appendChild(agentCard);
    feedView.appendChild(taskContainer);

    // Scroll to bottom
    const canvas = document.querySelector(".main-canvas");
    if (canvas) canvas.scrollTop = canvas.scrollHeight;

    // Simulate completion
    setTimeout(() => {
      const lower = prompt.toLowerCase();
      let responseHtml = "";
      let toolName = "browser_snapshot";

      if (lower.includes("summarize")) {
        toolName = "browser_snapshot";
        responseHtml = `
          <div class="result-body">
            <strong>Page Summary:</strong>
            <p style="margin-top: 4px;">Found main content with 1 billing form, 3 pricing tiers, and FAQ items. All credentials remain encrypted in local session memory.</p>
          </div>
        `;
      } else if (lower.includes("form") || lower.includes("fill")) {
        toolName = "browser_fill_form";
        responseHtml = `
          <div class="result-body">
            <strong>Form Identified:</strong>
            <p style="margin-top: 4px;">Detected 3 input fields (Company Name, Tax ID, Address). Values sanitized via PII vault without exposing sensitive details.</p>
            <div class="simple-approval-box">
              <div class="approval-title-text">Confirm autofill on current tab?</div>
              <div class="approval-btn-group">
                <button class="btn-confirm-sm" onclick="this.parentElement.innerHTML='<span style=\\'color:#059669;font-weight:600;font-size:11px;\\'>✓ Form populated successfully</span>'">Approve</button>
                <button class="btn-cancel-sm" onclick="this.parentElement.innerHTML='<span style=\\'color:#dc2626;font-size:11px;\\'>Cancelled</span>'">Cancel</button>
              </div>
            </div>
          </div>
        `;
      } else if (lower.includes("extract") || lower.includes("table")) {
        toolName = "browser_find";
        responseHtml = `
          <div class="result-body">
            <strong>Table Data Extracted:</strong>
            <p style="margin-top: 4px;">Extracted 3 columns and 4 rows. Cleaned of tracking tags and ready for agent reasoning.</p>
          </div>
        `;
      } else {
        toolName = "browser_find";
        responseHtml = `
          <div class="result-body">
            <strong>Action ready:</strong>
            <p style="margin-top: 4px;">Found relevant DOM elements for "<em>${escapeHtml(prompt.slice(0, 40))}</em>". Zero PII was exposed to external models.</p>
          </div>
        `;
      }

      agentCard.innerHTML = `
        <div class="result-header">
          <span class="result-badge">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
              <polyline points="20 6 9 17 4 12"></polyline>
            </svg>
            Complete (32ms)
          </span>
          <span class="result-tool">${toolName}</span>
        </div>
        ${responseHtml}
      `;

      if (canvas) canvas.scrollTop = canvas.scrollHeight;
    }, 700);
  }

  function escapeHtml(str: string): string {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }
});
