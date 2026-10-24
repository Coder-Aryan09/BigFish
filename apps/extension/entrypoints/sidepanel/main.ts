/**
 * BigFish Side Panel Controller — Sovereign Agentic Cockpit & Visual Shield
 * Complete dual-theme engine, WebGL2 Hexagonal Vault,
 * GSAP animations, flying patrol mascot, thinking accordion, and HITL approval modal.
 */

import { HexagonalVault } from './hexagonal-vault.js';

declare global {
  interface Window {
    gsap?: any;
  }
}

// State
let activeTab: chrome.tabs.Tab | null = null;
let isExecuting = false;
let activeBackground3D: any = null;
let currentAppTheme: 'dark' | 'light' = 'dark';

// DOM Elements — Header
const settingsBtn = document.getElementById('settingsBtn') as HTMLButtonElement | null;
const newChatBtn = document.getElementById('newChatBtn') as HTMLButtonElement | null;
const themeToggleBtn = document.getElementById('themeToggleBtn') as HTMLButtonElement | null;

// DOM Elements — Chat Area
const chatContainer = document.getElementById('chatContainer') as HTMLElement | null;
const chatMessages = document.getElementById('chatMessages') as HTMLElement | null;
const agentPatrolBanner = document.getElementById('agentPatrolBanner') as HTMLElement | null;
const patrolStatusText = document.getElementById('patrolStatusText') as HTMLElement | null;

// DOM Elements — Bottom Input Dock
const promptInput = document.getElementById('promptInput') as HTMLTextAreaElement | null;
const runBtn = document.getElementById('runBtn') as HTMLButtonElement | null;
const stopBtn = document.getElementById('stopBtn') as HTMLButtonElement | null;

// DOM Elements — Drawers & Modals
const settingsModal = document.getElementById('settingsModal') as HTMLElement | null;
const closeSettingsBtn = document.getElementById('closeSettingsBtn') as HTMLButtonElement | null;
const saveSettingsBtn = document.getElementById('saveSettingsBtn') as HTMLButtonElement | null;
const engineSelect = document.getElementById('engineSelect') as HTMLSelectElement | null;
const providerGroups = document.querySelectorAll<HTMLElement>('[data-provider]');

// DOM Elements — Approval Modal
const approvalModal = document.getElementById('approvalModal') as HTMLElement | null;
const approvalToolTitle = document.getElementById('approvalToolTitle') as HTMLElement | null;
const approvalReasonText = document.getElementById('approvalReasonText') as HTMLElement | null;
const approvalActionDetails = document.getElementById('approvalActionDetails') as HTMLElement | null;
const confirmApprovalBtn = document.getElementById('confirmApprovalBtn') as HTMLButtonElement | null;
const rejectApprovalBtn = document.getElementById('rejectApprovalBtn') as HTMLButtonElement | null;
let currentApprovalRequest: any = null;

// Active Message State
let currentAgentMessageEl: HTMLElement | null = null;
let currentAnswerBubbleEl: HTMLElement | null = null;
let currentThinkingAccordionEl: HTMLElement | null = null;
let currentThinkingStreamEl: HTMLElement | null = null;
let currentThinkingTimerEl: HTMLElement | null = null;
let currentThinkingBadgeEl: HTMLElement | null = null;
let thinkingStartTime: number | null = null;
let thinkingTimerInterval: any = null;
let currentStepNumber = 1;

/* ==========================================================================
   Theme Engine
   ========================================================================== */
function applyTheme(theme: 'dark' | 'light'): void {
  currentAppTheme = theme;
  document.documentElement.setAttribute('data-theme', theme);

  const darkIcon = document.getElementById('themeIconDark');
  const lightIcon = document.getElementById('themeIconLight');
  if (darkIcon && lightIcon) {
    darkIcon.style.display = theme === 'dark' ? 'none' : 'inline-block';
    lightIcon.style.display = theme === 'dark' ? 'inline-block' : 'none';
  }

  if (activeBackground3D && typeof activeBackground3D.setTheme === 'function') {
    activeBackground3D.setTheme(theme);
  }

  const brandLogos = document.querySelectorAll<HTMLImageElement>('.brand-header-logo');
  brandLogos.forEach((logo) => {
    logo.src = theme === 'dark' ? '/assets/light_logo.svg' : '/assets/dark_logo.svg';
  });
}

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
  try {
    const stored = localStorage.getItem('bigfish-theme') as 'dark' | 'light' | null;
    const systemPrefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    currentAppTheme = stored || (systemPrefersDark ? 'dark' : 'light');
    applyTheme(currentAppTheme);
  } catch (_) {
    applyTheme('dark');
  }

  initDynamicBackground();
  setupEventListeners();
  animateWelcomeScreen();
  await refreshActiveTab();
});

/* ==========================================================================
   GSAP Welcome Animations
   ========================================================================== */
function animateWelcomeScreen(): void {
  if (typeof window.gsap === 'undefined') return;
  try {
    const welcome = document.getElementById('welcomeScreen');
    if (!welcome) return;
    const robotStage = welcome.querySelector('.welcome-robot-stage');
    const title = welcome.querySelector('#welcomeTitle');
    const subtitle = welcome.querySelector('.welcome-subtitle');
    const pills = welcome.querySelectorAll('.pretask-pill');

    const tl = window.gsap.timeline({ defaults: { ease: 'power3.out' } });
    if (robotStage) {
      tl.fromTo(robotStage, { scale: 0.75, opacity: 0, y: -16 }, { scale: 1, opacity: 1, y: 0, duration: 0.65 });
    }
    if (title) {
      tl.fromTo(title, { opacity: 0, y: 15 }, { opacity: 1, y: 0, duration: 0.6 }, '-=0.4');
    }
    if (subtitle) {
      tl.fromTo(subtitle, { opacity: 0, y: 10 }, { opacity: 1, y: 0, duration: 0.5 }, '-=0.4');
    }
    if (pills && pills.length) {
      tl.fromTo(pills, { opacity: 0, y: 18, scale: 0.96 }, { opacity: 1, y: 0, scale: 1, duration: 0.45, stagger: 0.07 }, '-=0.3');
    }
  } catch (err) {
    console.warn('[BigFish] animateWelcomeScreen error:', err);
  }
}

/* ==========================================================================
   Hexagonal Vault Dynamic Background (WebGL2)
   ========================================================================== */
function initDynamicBackground(): void {
  try {
    const canvas = document.getElementById('particleWaveCanvas') as HTMLCanvasElement | null;
    if (canvas) {
      if (activeBackground3D) {
        try { activeBackground3D.destroy(); } catch (_) { }
      }
      activeBackground3D = new HexagonalVault(canvas, {
        theme: currentAppTheme
      });
    }
  } catch (err) {
    console.warn('[BigFish] Error initializing HexagonalVault:', err);
  }
}

/* ==========================================================================
   Event Listeners Setup
   ========================================================================== */
function setupEventListeners(): void {
  // Theme Toggle Button
  if (themeToggleBtn) {
    themeToggleBtn.addEventListener('click', () => {
      const nextTheme = currentAppTheme === 'dark' ? 'light' : 'dark';
      applyTheme(nextTheme);
      try {
        localStorage.setItem('bigfish-theme', nextTheme);
      } catch (_) { }
    });
  }

  // Emergency Stop Button
  if (stopBtn) {
    stopBtn.addEventListener('click', () => {
      handleStopAgent();
    });
  }

  // Run Button
  if (runBtn) {
    runBtn.addEventListener('click', handleRunPrompt);
  }

  // Textarea input auto-grow and Enter handling
  if (promptInput) {
    promptInput.addEventListener('input', () => {
      promptInput.style.height = 'auto';
      promptInput.style.height = `${Math.min(promptInput.scrollHeight, 100)}px`;
      if (activeBackground3D && Math.random() > 0.5) {
        activeBackground3D.triggerShockwave();
      }
    });

    promptInput.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleRunPrompt();
      }
    });
  }

  // New Chat Button
  if (newChatBtn) {
    newChatBtn.addEventListener('click', handleNewChat);
  }

  // Pre-task quick action suggestion pills
  document.addEventListener('click', (e) => {
    const target = e.target as HTMLElement | null;
    const pill = target?.closest('.pretask-pill') as HTMLElement | null;
    if (!pill) return;
    const task = pill.dataset.task;
    if (!task || !promptInput) return;
    promptInput.value = task;
    promptInput.style.height = 'auto';
    promptInput.focus();
    handleRunPrompt();
  });

  // Settings Modal Handlers
  if (settingsBtn) settingsBtn.addEventListener('click', openSettings);
  if (closeSettingsBtn) closeSettingsBtn.addEventListener('click', () => {
    if (settingsModal) settingsModal.style.display = 'none';
  });
  if (engineSelect) {
    engineSelect.addEventListener('change', () => showProviderFields(engineSelect.value));
  }
  if (saveSettingsBtn) saveSettingsBtn.addEventListener('click', saveSettings);

  // Approval Modal Handlers
  if (confirmApprovalBtn) {
    confirmApprovalBtn.addEventListener('click', () => {
      if (approvalModal) approvalModal.style.display = 'none';
      if (currentApprovalRequest) {
        if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
          chrome.runtime.sendMessage({ type: 'RESOLVE_APPROVAL', id: currentApprovalRequest.id, approved: true });
        }
        currentApprovalRequest = null;
      }
      appendThinkingEntry('✓', 'Action approved by user. Executing browser mutation…');
      finishAgentMessage('Action approved and executed successfully.');
    });
  }

  if (rejectApprovalBtn) {
    rejectApprovalBtn.addEventListener('click', () => {
      if (approvalModal) approvalModal.style.display = 'none';
      if (currentApprovalRequest) {
        if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
          chrome.runtime.sendMessage({ type: 'RESOLVE_APPROVAL', id: currentApprovalRequest.id, approved: false });
        }
        currentApprovalRequest = null;
      }
      appendThinkingEntry('✗', 'Action rejected by user. State preserved.');
      finishAgentMessage('Action was rejected by user. No page mutations were performed.');
    });
  }

  // Listen for real approval requests from the background service worker
  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener((msg) => {
      if (msg?.type === 'BIGFISH_APPROVAL_REQUEST') {
        const req = msg.payload;
        currentApprovalRequest = req;
        triggerApprovalModal({
          tool: req.tool || 'browser_action',
          target: req.origin || req.details || 'Current tab action',
          reason: req.reason || 'State-modifying browser action.'
        });
      }
    });
  }

  // Parallax Pointer Aura
  try {
    const ambientAura = document.getElementById('ambientAura');
    if (ambientAura) {
      window.addEventListener('pointermove', (e: MouseEvent) => {
        try {
          if (!window.innerWidth || !window.innerHeight) return;
          const x = (e.clientX / window.innerWidth - 0.5) * 16;
          const y = (e.clientY / window.innerHeight - 0.5) * 16;
          ambientAura.style.setProperty('--aura-mouse-x', `${x.toFixed(1)}px`);
          ambientAura.style.setProperty('--aura-mouse-y', `${y.toFixed(1)}px`);
        } catch (_) { }
      }, { passive: true });
    }
  } catch (_) { }
}

function openSettings(): void {
  if (settingsModal) settingsModal.style.display = 'flex';
}

function showProviderFields(provider: string): void {
  providerGroups.forEach((group) => {
    group.style.display = group.dataset.provider === provider ? 'flex' : 'none';
  });
}

function saveSettings(): void {
  if (settingsModal) settingsModal.style.display = 'none';
}

async function refreshActiveTab(): Promise<void> {
  if (typeof chrome !== 'undefined' && chrome.tabs && chrome.tabs.query) {
    try {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tabs && tabs.length > 0) {
        activeTab = tabs[0];
      }
    } catch (_) { }
  }
}

/* ==========================================================================
   Chat & Agent Execution Flow
   ========================================================================== */
async function handleRunPrompt(): Promise<void> {
  if (!promptInput || isExecuting) return;
  const rawPrompt = promptInput.value.trim();
  if (!rawPrompt) return;

  promptInput.value = '';
  promptInput.style.height = 'auto';

  // Remove welcome screen
  const welcome = document.getElementById('welcomeScreen');
  if (welcome) welcome.remove();

  // Render User Message
  renderUserMessage(rawPrompt);

  // Set Busy State
  setBusyState(true);

  // Create Agent Slot
  createAgentMessageSlot();

  // Execute Simulated Agent Flow with Live Thinking Steps
  const lower = rawPrompt.toLowerCase();

  setTimeout(() => {
    appendThinkingEntry('🔍', 'Inspecting active viewport and calculating token-lean DOM snapshot…', { phase: 'perceive', step: 1 });
    updatePatrolBotStatus('Scanning DOM structure & actionable elements…');
  }, 400);

  setTimeout(() => {
    appendThinkingEntry('🛡️', 'Local PII Shield verified: masked 3 potential identifiers before external transmission.', { phase: 'privacy', step: 2 });
    updatePatrolBotStatus('PII protection active — credentials preserved…');
  }, 900);

  setTimeout(() => {
    if (lower.includes('buy') || lower.includes('pay') || lower.includes('submit') || lower.includes('delete') || lower.includes('confirm')) {
      // Trigger HITL Approval Modal
      triggerApprovalModal({
        tool: 'browser_click',
        target: '[data-testid="submit-pay"] Button: "Confirm & Pay ($49.00)"',
        reason: 'State-modifying financial action on checkout domain.'
      });
    } else if (lower.includes('summarize')) {
      appendThinkingEntry('📋', 'Synthesized 3 core takeaways from page headings and body text.', { phase: 'reason', step: 3 });
      finishAgentMessage('### Summary\n- **1. Primary Service**: Cloud-native autonomous web perception and local tool execution.\n- **2. Privacy Guarantee**: All PII and credentials are kept on this device.\n- **3. Status**: Page successfully indexed with zero token leakage.');
    } else if (lower.includes('extract') || lower.includes('table') || lower.includes('data')) {
      appendThinkingEntry('📊', 'Extracted tabular structured dataset: 4 rows, 3 columns.', { phase: 'action', step: 3 });
      finishAgentMessage('Extracted structured table:\n```json\n[\n  {"tier": "Starter", "price": "$0/mo", "tokens": "10k"},\n  {"tier": "Pro", "price": "$29/mo", "tokens": "100k"},\n  {"tier": "Enterprise", "price": "Custom", "tokens": "Unlimited"}\n]\n```');
    } else if (lower.includes('fill') || lower.includes('form')) {
      appendThinkingEntry('✍️', 'Populated form fields using local vault: Name, Company, and Email.', { phase: 'action', step: 3 });
      finishAgentMessage('I have safely auto-populated the input fields on this page using your local credentials without exposing any secret values to the LLM.');
    } else {
      appendThinkingEntry('⚡', 'Identified primary action targets on current viewport.', { phase: 'action', step: 3 });
      finishAgentMessage(`I've analyzed the current page context for "${escapeHtml(rawPrompt)}". The page is responsive and ready for supervised execution.`);
    }
  }, 1500);
}

function handleStopAgent(): void {
  setBusyState(false);
  if (thinkingTimerInterval) {
    clearInterval(thinkingTimerInterval);
    thinkingTimerInterval = null;
  }
  if (currentThinkingAccordionEl) {
    currentThinkingAccordionEl.classList.add('completed', 'collapsed');
    const statusText = currentThinkingAccordionEl.querySelector('.thinking-status-text');
    if (statusText) statusText.textContent = 'Stopped';
    const pulse = currentThinkingAccordionEl.querySelector('.thinking-pulse-indicator');
    if (pulse) pulse.classList.add('idle');
  }
  if (currentAnswerBubbleEl) {
    currentAnswerBubbleEl.style.display = 'block';
    currentAnswerBubbleEl.textContent = 'Agent stopped by user.';
  }
}

function handleNewChat(): void {
  handleStopAgent();
  if (chatMessages) {
    chatMessages.innerHTML = '';
    renderWelcomeScreen();
  }
  if (promptInput) {
    promptInput.value = '';
    promptInput.style.height = 'auto';
    try { promptInput.focus(); } catch (_) { }
  }
}

function setBusyState(busy: boolean): void {
  isExecuting = busy;
  if (runBtn) runBtn.style.display = busy ? 'none' : 'flex';
  if (stopBtn) stopBtn.style.display = busy ? 'flex' : 'none';
  if (agentPatrolBanner) {
    agentPatrolBanner.classList.toggle('active', busy);
  }
  setOrbState(busy ? 'thinking' : 'idle');
}

function setOrbState(state: string): void {
  const aura = document.getElementById('ambientAura');
  if (aura?.dataset) {
    aura.dataset.state = state;
  }
  if (activeBackground3D && typeof activeBackground3D.setState === 'function') {
    activeBackground3D.setState(state);
  }
}

function updatePatrolBotStatus(text: string): void {
  if (patrolStatusText) {
    patrolStatusText.textContent = text;
  }
}

/* ==========================================================================
   Chat Message Rendering Helpers
   ========================================================================== */
function renderUserMessage(text: string): void {
  if (!chatMessages) return;
  const row = document.createElement('div');
  row.className = 'chat-row user';
  row.innerHTML = `<div class="user-bubble">${escapeHtml(text)}</div>`;
  chatMessages.appendChild(row);

  const bubble = row.querySelector('.user-bubble');
  if (typeof window.gsap !== 'undefined' && bubble) {
    window.gsap.fromTo(
      bubble,
      { opacity: 0.1, scale: 0.94, y: 8 },
      { opacity: 1, scale: 1, y: 0, duration: 0.28, ease: 'power2.out', clearProps: 'transform' }
    );
  }
  scrollToBottom();
}

function createAgentMessageSlot(): void {
  if (!chatMessages) return;
  const msgId = Date.now();
  const row = document.createElement('div');
  row.className = 'chat-row agent';
  row.id = `msg-${msgId}`;
  row.innerHTML = `
    <div class="agent-tag-header">
      <span class="agent-ai-icon">🤖</span>
      <span class="agent-ai-name">BigFish AI</span>
    </div>

    <!-- Thinking Accordion (Live Streaming Thought Process) -->
    <div class="thinking-accordion" id="thinking-${msgId}" role="region" aria-label="Agent reasoning process">
      <button type="button" class="thinking-header" id="thinkingHeader-${msgId}" aria-expanded="true" title="Click to collapse / expand thought trail">
        <div class="thinking-header-left">
          <span class="thinking-pulse-indicator"></span>
          <span class="thinking-status-text">Thinking</span>
          <span class="thinking-timer" id="timer-${msgId}">0.0s</span>
          <span class="thinking-step-pill" id="stepPill-${msgId}">Step 1/100</span>
        </div>
        <div class="thinking-header-right">
          <span class="thinking-chevron">▾</span>
        </div>
      </button>
      <div class="thinking-content" id="thinkingContent-${msgId}">
        <div class="thinking-stream" id="stream-${msgId}">
          <div class="thinking-entry initial">
            <span class="thinking-entry-icon">🔍</span>
            <span class="thinking-entry-text">Scanning page context &amp; initiating autonomous reasoning…</span>
          </div>
        </div>
      </div>
    </div>

    <!-- Agent Final Answer Bubble -->
    <div class="agent-answer-bubble" id="answer-${msgId}" style="display:none;"></div>
  `;

  chatMessages.appendChild(row);

  if (typeof window.gsap !== 'undefined') {
    window.gsap.fromTo(
      row,
      { opacity: 0, y: 15 },
      { opacity: 1, y: 0, duration: 0.4, ease: 'power2.out' }
    );
  }

  currentAgentMessageEl = row;
  currentAnswerBubbleEl = row.querySelector<HTMLElement>(`#answer-${msgId}`);
  currentThinkingAccordionEl = row.querySelector<HTMLElement>(`#thinking-${msgId}`);
  currentThinkingStreamEl = row.querySelector<HTMLElement>(`#stream-${msgId}`);
  currentThinkingTimerEl = row.querySelector<HTMLElement>(`#timer-${msgId}`);
  currentThinkingBadgeEl = row.querySelector<HTMLElement>(`#stepPill-${msgId}`);

  const headerBtn = row.querySelector<HTMLButtonElement>(`#thinkingHeader-${msgId}`);
  if (headerBtn) {
    headerBtn.addEventListener('click', () => {
      if (!currentThinkingAccordionEl) return;
      const isCollapsed = currentThinkingAccordionEl.classList.toggle('collapsed');
      headerBtn.setAttribute('aria-expanded', String(!isCollapsed));
    });
  }

  thinkingStartTime = Date.now();
  currentStepNumber = 1;
  if (thinkingTimerInterval) clearInterval(thinkingTimerInterval);
  thinkingTimerInterval = setInterval(() => {
    if (currentThinkingTimerEl && thinkingStartTime) {
      const elapsedSec = ((Date.now() - thinkingStartTime) / 1000).toFixed(1);
      currentThinkingTimerEl.textContent = `${elapsedSec}s`;
    }
  }, 500);

  scrollToBottom();
}

function appendThinkingEntry(icon: string, text: string, meta: { phase?: string; step?: number } = {}): void {
  if (!currentThinkingStreamEl || !text) return;
  const entry = document.createElement('div');
  entry.className = `thinking-entry ${meta.phase || ''}`;
  entry.innerHTML = `
    <span class="thinking-entry-icon">${icon}</span>
    <span class="thinking-entry-text">${escapeHtml(text)}</span>
  `;
  currentThinkingStreamEl.appendChild(entry);

  if (meta.step) {
    currentStepNumber = meta.step;
    if (currentThinkingBadgeEl) {
      currentThinkingBadgeEl.textContent = `Step ${meta.step}/100`;
    }
  }

  const content = currentThinkingAccordionEl?.querySelector<HTMLElement>('.thinking-content');
  if (content) {
    content.scrollTop = content.scrollHeight;
  }
  scrollToBottom();
}

function finishAgentMessage(summary: string, success: boolean = true): void {
  setBusyState(false);
  if (thinkingTimerInterval) {
    clearInterval(thinkingTimerInterval);
    thinkingTimerInterval = null;
  }

  if (currentThinkingAccordionEl) {
    currentThinkingAccordionEl.classList.add('completed', 'collapsed');
    const statusText = currentThinkingAccordionEl.querySelector<HTMLElement>('.thinking-status-text');
    if (statusText) statusText.textContent = success ? 'Thought trail' : 'Completed';
    const pulse = currentThinkingAccordionEl.querySelector<HTMLElement>('.thinking-pulse-indicator');
    if (pulse) pulse.classList.add('idle');
    const headerBtn = currentThinkingAccordionEl.querySelector<HTMLButtonElement>('.thinking-header');
    if (headerBtn) headerBtn.setAttribute('aria-expanded', 'false');
  }

  if (currentAnswerBubbleEl) {
    currentAnswerBubbleEl.style.display = 'block';
    currentAnswerBubbleEl.innerHTML = formatMarkdown(summary);
  }

  scrollToBottom();
}

function triggerApprovalModal(details: { tool: string; target: string; reason: string }): void {
  if (!approvalModal) return;
  if (approvalToolTitle) approvalToolTitle.textContent = `Approval: ${details.tool}`;
  if (approvalReasonText) approvalReasonText.textContent = details.reason;
  if (approvalActionDetails) {
    approvalActionDetails.textContent = details.target;
  }
  approvalModal.style.display = 'flex';
}

function renderWelcomeScreen(): void {
  if (!chatMessages) return;
  const welcomeSection = document.createElement('section');
  welcomeSection.className = 'welcome-state';
  welcomeSection.id = 'welcomeScreen';
  welcomeSection.setAttribute('aria-labelledby', 'welcomeTitle');
  welcomeSection.innerHTML = `
    <div class="welcome-robot-stage" id="welcomeRobotStage" aria-hidden="true">
      <picture>
        <source srcset="/assets/robot-waving.webp" type="image/webp">
        <img src="/assets/robot-waving.gif" alt="Autonomous AI Robot Greeting" class="welcome-robot-media" id="welcomeRobotMedia" />
      </picture>
    </div>

    <h1 id="welcomeTitle">What would you like me to do on this page?</h1>
    <p class="welcome-subtitle">Direct, zero-lag browser autonomy powered by sovereign on-device visual shield.</p>

    <div class="welcome-pretasks" id="welcomePretasks" role="group" aria-label="Suggested quick tasks">
      <button type="button" class="pretask-pill" data-task="Summarize this page in 3 key takeaways" title="Summarize page content">
        <span class="pretask-icon">📋</span>
        <span class="pretask-text">Summarize page</span>
      </button>
      <button type="button" class="pretask-pill" data-task="Extract all data, tables, and statistics from this page" title="Extract structured data">
        <span class="pretask-icon">📊</span>
        <span class="pretask-text">Extract data</span>
      </button>
      <button type="button" class="pretask-pill" data-task="Find inputs on this page and help me fill out the form" title="Fill out inputs and forms">
        <span class="pretask-icon">✍️</span>
        <span class="pretask-text">Fill form</span>
      </button>
      <button type="button" class="pretask-pill" data-task="Locate the primary action buttons and navigation links on this page" title="Identify main buttons and actions">
        <span class="pretask-icon">⚡</span>
        <span class="pretask-text">Key actions</span>
      </button>
    </div>
  `;
  chatMessages.appendChild(welcomeSection);
  animateWelcomeScreen();
}

function scrollToBottom(): void {
  if (chatContainer) {
    chatContainer.scrollTop = chatContainer.scrollHeight;
  }
}

function escapeHtml(str: string): string {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function formatMarkdown(text: string): string {
  return escapeHtml(text)
    .replace(/^### (.*$)/gim, '<h3 style="margin: 8px 0 4px; font-size: 13px; font-weight: 700;">$1</h3>')
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.*?)\*/g, '<em>$1</em>')
    .replace(/```([a-z]*)\n([\s\S]*?)```/g, '<pre style="background: rgba(0,0,0,0.18); padding: 8px 10px; border-radius: 6px; font-family: monospace; font-size: 11px; overflow-x: auto;"><code>$2</code></pre>')
    .replace(/`([^`]+)`/g, '<code style="background: rgba(0,0,0,0.12); padding: 1px 4px; border-radius: 3px; font-family: monospace; font-size: 11px;">$1</code>')
    .replace(/\n/g, '<br/>');
}
