// BigFish Simplified Entry Controller
import type { ConnState, ConnStatus } from "../background/conn/connection.js";

const CONN_LABELS: Record<ConnState, string> = {
  signed_out: "Signed out",
  idle: "Starting",
  ticket: "Connecting",
  connecting: "Connecting",
  mcp_init: "Connecting",
  ready: "Connected",
  backoff: "Retrying",
  stopped: "Stopped",
};

interface StatusReply {
  ok: boolean;
  error?: string;
  status?: ConnStatus;
  email?: string | null;
}

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

  const connIndicator = document.querySelector<HTMLElement>("#conn-indicator");
  const connLabel = document.querySelector<HTMLElement>("#conn-label");
  const connDetail = document.querySelector<HTMLElement>("#conn-detail");
  const accountEmail = document.querySelector<HTMLElement>("#account-email");
  const signInBtn = document.querySelector<HTMLButtonElement>("#btn-sign-in");
  const signOutBtn = document.querySelector<HTMLButtonElement>("#btn-sign-out");
  const connectBtn = document.querySelector<HTMLButtonElement>("#btn-connect");

  // Detect active tab title
  browser.tabs.query({ active: true, currentWindow: true }).then((tabs) => {
    if (tabs[0]?.title && activeTabTitle) {
      activeTabTitle.textContent = tabs[0].title;
    }
  });

  // Account and connection state, owned by the service worker
  let signedInEmail: string | null = null;

  function renderStatus(status: ConnStatus): void {
    if (connIndicator) connIndicator.dataset.state = status.state;
    if (connLabel) connLabel.textContent = CONN_LABELS[status.state];
    if (connDetail) connDetail.textContent = status.state === "ready" ? "" : (status.detail ?? "");
    if (connectBtn) connectBtn.hidden = !signedInEmail || !(status.state === "stopped" || status.state === "backoff");
  }

  function renderAccount(email: string | null): void {
    signedInEmail = email;
    if (accountEmail) accountEmail.textContent = email ?? "Not signed in";
    if (signInBtn) signInBtn.hidden = Boolean(email);
    if (signOutBtn) signOutBtn.hidden = !email;
  }

  async function ask(type: string, button?: HTMLButtonElement | null): Promise<void> {
    if (button) button.disabled = true;
    try {
      const reply = (await browser.runtime.sendMessage({ type })) as StatusReply;
      if (!reply?.ok) {
        if (connDetail) connDetail.textContent = reply?.error ?? "Request failed.";
        return;
      }
      renderAccount(reply.email ?? null);
      if (reply.status) renderStatus(reply.status);
    } finally {
      if (button) button.disabled = false;
    }
  }

  signInBtn?.addEventListener("click", () => void ask("BIGFISH_SIGN_IN", signInBtn));
  signOutBtn?.addEventListener("click", () => void ask("BIGFISH_SIGN_OUT", signOutBtn));
  connectBtn?.addEventListener("click", () => void ask("BIGFISH_CONNECT", connectBtn));
  void ask("BIGFISH_PANEL_OPENED");

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

  // Listen for connection updates and real approval requests from the background service worker
  browser.runtime.onMessage.addListener((msg: any) => {
    if (msg?.type === "BIGFISH_CONN_STATUS") {
      renderStatus(msg.status);
      // A status change can mean a sign-in finished elsewhere. Refresh the email.
      if (msg.status.state === "ready" && !signedInEmail) void ask("BIGFISH_GET_STATUS");
      return;
    }
    if (msg?.type === "BIGFISH_APPROVAL_REQUEST") {
      const req = msg.payload;
      if (!feedView) return;
      feedView.style.display = "flex";
      if (welcomeView) welcomeView.style.display = "none";

      const canvas = document.querySelector("#feed-canvas");
      const approvalEl = document.createElement("div");
      approvalEl.className = "agent-bubble";
      approvalEl.style.borderLeft = "3px solid #f59e0b";
      approvalEl.innerHTML = `
        <div class="result-header">
          <span class="result-badge" style="background:#fef3c7;color:#b45309;">⚠️ Approval Required</span>
          <span class="result-tool">${escapeHtml(req.tool)}</span>
        </div>
        <div class="result-body">
          <strong>${escapeHtml(req.reason)}</strong>
          <p style="font-size:11px;color:#6b7280;margin:4px 0;">Target: ${escapeHtml(req.origin || "Current tab")}</p>
          <div class="simple-approval-box" style="margin-top:8px;">
            <div class="approval-btn-group">
              <button class="btn-confirm-sm" id="btn-approve-${req.id}">Approve Action</button>
              <button class="btn-cancel-sm" id="btn-deny-${req.id}">Deny</button>
            </div>
          </div>
        </div>
      `;
      canvas?.appendChild(approvalEl);
      if (canvas) canvas.scrollTop = canvas.scrollHeight;

      document.getElementById(`btn-approve-${req.id}`)?.addEventListener("click", () => {
        browser.runtime.sendMessage({ type: "RESOLVE_APPROVAL", id: req.id, approved: true });
        approvalEl.innerHTML = `<span style="color:#059669;font-weight:600;font-size:12px;">✓ Approved by user</span>`;
      });

      document.getElementById(`btn-deny-${req.id}`)?.addEventListener("click", () => {
        browser.runtime.sendMessage({ type: "RESOLVE_APPROVAL", id: req.id, approved: false });
        approvalEl.innerHTML = `<span style="color:#dc2626;font-size:12px;">✗ Denied by user</span>`;
      });
    }
  });

  function escapeHtml(str: string): string {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }
});
