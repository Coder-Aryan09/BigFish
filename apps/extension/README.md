# 🧩 BigFish Chrome Extension

> Turns the user's own Chrome into an MCP server with 13 browser tools, and masks personal data before any page text leaves the browser.

![Version](https://img.shields.io/badge/version-0.1.0-blue)
![Status](https://img.shields.io/badge/status-Development-yellow)
![Runtime](https://img.shields.io/badge/runtime-Chrome%20MV3%20%2B%20WXT%200.21-informational)

---

## 📖 Table of Contents
- [Overview & The "Why"](#-overview--the-why)
- [Built Features & Current State](#-built-features--current-state)
- [Architecture & Design Patterns](#-architecture--design-patterns)
- [Usage & Setup](#-usage--setup)
- [Communication & Contracts](#-communication--contracts)
- [Production Readiness](#-production-readiness)
- [Changelog & Migration State](#-changelog--migration-state)

---

## 🎯 Overview & The "Why"

### What this service does
`@bigfish/extension` runs in the user's real Chrome. Its service worker is an MCP server with 13 browser tools (navigate, snapshot, find, click, type, fill forms, and more). It dials out to the agent server over one WebSocket. Every tool result passes through the PII filter first, and risky actions wait for the user to approve them in the side panel.

### Why this is its own microservice (not part of a monolith)
- **Bounded context:** the only part with access to the live DOM, the user's sign-ins, the PII vault, and the approval prompts. Raw personal values exist only here.
- **Independent scaling need:** one per browser, running on the user's machine. Server load does not grow with page work; it grows with concurrent runs.
- **Independent deployability:** shipped as a Chrome extension build (unpacked today, Web Store later), on a slower cadence than the server's prompts and guards.
- **Failure isolation:** if the server goes away, browsing is not affected. The connection goes to `backoff` (full jitter, 1 s to 30 s) and comes back on its own.
- **Data isolation strategy:** the PII vault and the JWT live in `chrome.storage.session` (memory only, gone when the browser closes). Nothing goes to the server except masked tool results.

### The "User" of this service

| Caller | Call type | Why it calls this service |
|---|---|---|
| End user | Direct UI (side panel, approval popup) | Types or speaks a task, watches steps, approves risky actions |
| BigFish agent server | MCP `tools/call` over `/mcp-ws` (the extension dials out) | Runs the 13 browser tools |
| Developer tools | `/api/dev/devices/:id/tools/:name` on the server, forwarded over MCP | Calling tools by hand |

---

## 🚧 Built Features & Current State

### Current state
| Field | Value |
|---|---|
| **Status** | 🟡 Development (runs end to end on a real browser) |
| **Version** | `0.1.0` |
| **Last deployed** | Not published; load `dist/chrome-mv3` unpacked |
| **Owner(s)** | BigFish team |
| **Known technical debt** | Elements inside iframes are not visible to the tools. A native `alert()`/`confirm()` can block a page while a tool waits on it. Vault tokens use a simple string hash, not a keyed hash. Voice input uses the Web Speech API, which needs Google's servers. |

### Features built (working today)
- **13 browser tools** — `browser_ping`, `browser_tabs`, `browser_navigate`, `browser_snapshot`, `browser_find`, `browser_click`, `browser_type`, `browser_fill_form`, `browser_select`, `browser_press_key`, `browser_scroll`, `browser_wait_for`, `browser_extract` — ✅ done
- **Refs and deltas** — elements get refs like `3:12`. After an action the result says what changed — ✅ done:
  - new or removed elements
  - changed values
  - alerts
  - **new text** on the page
  - **tabs the action opened**
- **Field context** — every field shows its question or group (`radio "2022" [ ] in "Graduation year"`), incl. Google Forms "Your answer" boxes — ✅ done
- **Shadow DOM** — elements in open shadow roots can be found, typed into and clicked — ✅ done
- **PII vault** — emails, phones, PAN, SSN, cards (Luhn) and Aadhaar (Verhoeff) become tokens like `[EMAIL_7F3A]`. URLs are left intact. Tokens turn back into real values only on the site they came from, and a cross-site use needs approval. Made-up tokens are refused — ✅ done
- **Approvals** — clicks and submits labelled send, pay, buy, delete, transfer, publish and similar wait for Approve. The prompt shows in the side panel, or in a popup when the panel is closed — ✅ done
- **Clear errors** — each comes with a hint that fits — ✅ done:
  - error pages (404, site down)
  - no history for back/forward
  - covered, disabled and read-only elements
  - malformed refs and unknown keys
  - `select` on an element that is not a dropdown
- **Filler args** — `null`, `""` and `false` for optional fields are dropped, from the agent and from any MCP client — ✅ done
- **Side panel** — sign-in, live plan and steps, tool results, voice dictation, agent cursor on the page — ✅ done

### How it was built
- **Language/runtime:** TypeScript, Chrome Manifest V3 (Chrome ≥ 116)
- **Framework:** WXT 0.21
- **Design patterns used:**
  - **Reverse MCP:** the browser is the server and dials out, so nothing has to reach into the user's machine.
  - **Token vault:** the model reasons over `[EMAIL_7F3A]`; the real value is filled in only on its own origin ([`privacy.ts`](safety/privacy.ts), [`pii-vault.ts`](safety/pii-vault.ts)).
  - **Ref map with fingerprints:** a ref that went stale after a re-render is found again by role and name if it is unique ([`dom-actions.ts`](entrypoints/content/dom-actions.ts)).
- **Key libraries:** `@modelcontextprotocol/server`, `@bigfish/contracts`, `@bigfish/mcp-ws`, `zod`; Playwright for E2E

---

## 🏗️ Architecture & Design Patterns

The service worker owns the MCP server, the connection and the executor. The executor runs each tool, scans the page before and after, and builds the delta. It sends DOM work to the content script by message. The safety layer runs on every result and every outgoing value. The server sends one tool call at a time per device, so actions never overlap.

```
apps/extension/
├── entrypoints/
│   ├── background/        # MCP server, connection (states, backoff), executor, snapshot and delta text, tabs
│   ├── content/           # DOM engine (scan, refs, actions, shadow DOM), agent cursor
│   ├── sidepanel/         # UI, agent client (SSE), voice input
│   └── mic-permission/    # microphone permission page
├── safety/                # PII vault, sanitize and rehydrate, action policy, approvals, URL policy
├── e2e/                   # Playwright: bigfish, tools-edge, voice specs; agent-eval runner; harness
├── wxt.config.ts          # output in dist/, fixed key, OAuth client
└── package.json
```

---

## ⚙️ Usage & Setup

### Environment variables

| Key | Required | Description | Example (fake) |
|---|---|---|---|
| `WXT_SERVER_URL` | ❌ | Server base URL; the socket uses `ws://` on the same host (default `http://127.0.0.1:8787`) | `http://127.0.0.1:8787` |
| `WXT_EXTENSION_KEY` | ✅ for sign-in | Public key that fixes the extension ID (never the private `.pem`) | `MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAsample` |
| `WXT_GOOGLE_CLIENT_ID` | ✅ for sign-in | Google OAuth client of type "Chrome Extension" for that ID | `123456789-sample.apps.googleusercontent.com` |

Values are baked in at build time, so rebuild after changing `.env`.

### Run locally
```bash
# 1. Install dependencies (repo root)
pnpm install

# 2. Configure environment
cp apps/extension/.env.example apps/extension/.env

# 3. Build, then load apps/extension/dist/chrome-mv3 in chrome://extensions (Developer mode → Load unpacked)
pnpm --filter @bigfish/extension build
#    or dev mode with reload: pnpm dev:ext

# 4. Run tests
pnpm --filter @bigfish/extension test      # safety unit tests (12)
pnpm --filter @bigfish/extension e2e       # Playwright (31): first run `pnpm --filter @bigfish/extension exec playwright install chromium`

# Agent evals: the real model on fixture pages (forms, shop, table, mail, chat). Needs the e2e build (run e2e once).
# Traces go to test-results/agent-eval/
NVIDIA_API_KEY=... pnpm --filter @bigfish/extension exec tsx e2e/agent-eval.ts [case...]
```

After a rebuild, press **Reload** on the extension and reload open tabs, so they get the new content script.

### Run via Docker / Skaffold
Not applicable: this runs inside Chrome. For CI, the E2E harness starts headless Chromium with the e2e build.

---

## 🔌 Communication & Contracts

### Synchronous (REST/gRPC)
| Direction | Protocol | Endpoint / method | Counterpart |
|---|---|---|---|
| Outbound | HTTP | `POST /api/auth/google`, `POST /api/ws-ticket` | Agent server |
| Outbound | WebSocket | `ws://<server>/mcp-ws?ticket=…` (JSON frames: `ctl` hello/ready/heartbeat, `mcp` JSON-RPC) | Agent server |
| Inbound (over that socket) | MCP `tools/list`, `tools/call` | the 13 `browser_*` tools | Agent server (MCP client) |
| Outbound | HTTP + SSE | `POST /api/agent/invoke`, `/api/agent/cancel` (side panel) | Agent server |

### Asynchronous (event/queue)
| Event | Direction | Broker / topic | Payload schema ref |
|---|---|---|---|
| `AgentEvent` stream | Consumes (side panel) | none (SSE) | [`agent.ts`](../../packages/contracts/src/agent.ts) |
| `notifications/progress` | Produces (while waiting for approval or a slow page) | none (MCP over the socket) | MCP spec |

### Contract source of truth
[`packages/contracts/src/tools.ts`](../../packages/contracts/src/tools.ts) for tool schemas, [`wire.ts`](../../packages/contracts/src/wire.ts) for frames.

---

## 🛡️ Production Readiness

### Health & observability
- **Liveness:** no `/healthz` or `/ready` (an extension has no HTTP server). The side panel shows the connection state: `signed_out`, `idle`, `ticket`, `connecting`, `mcp_init`, `ready`, `backoff`, `stopped`
- **Readiness:** `browser_ping` through the server (`POST /api/devices/:id/ping`)
- **Graceful shutdown:** a connection that drops mid-call makes read-only tools retry once after reconnect; tools that change the page are never retried (`STATE_UNKNOWN`)
- **Structured logging:** ❌ console only
- **Tracing:** ❌ none
- **Metrics:** ❌ none

### Security & compliance
- **AuthN/AuthZ:** Google sign-in via `chrome.identity`; the server's JWT; a one-time ticket per socket; the server checks the extension's Origin
- **CORS policy:** not applicable (the extension calls the server)
- **Rate limiting:** one tool call at a time per device (server side)
- **Hardening:** URL policy blocks `chrome:`, `chrome-extension:`, `edge:`, `about:`, `file:`, `data:`, `javascript:` and the Chrome Web Store; risky actions need approval; PII masked on every result; made-up tokens refused
- **Secrets management:** `.env` holds only public values (the public key and OAuth client ID); the private key stays outside the repo

### CI/CD & deployment
- **Container:** none
- **Orchestration:** none
- **Pipeline:** none yet; `pnpm --filter @bigfish/extension zip` makes a store upload
- **Rollback strategy:** load the previous build

---

## 📝 Changelog & Migration State

| Version | Date | Change | Migration notes |
|---|---|---|---|
| `v0.1.0` | 2026-10-25 | Tool hardening: arg normalizer, lenient MCP schemas, field context, text and new-tab deltas, shadow DOM, find ranking, clearer errors, unknown-token check; 13 edge-case E2E tests | Rebuild, reload the extension and open tabs |
| `v0.1.0` | 2026-10 | 13 tools, MV3 build, MCP over `/mcp-ws`, PII vault, approvals, agent cursor, voice input | none |

---

## 🤝 Ownership
- **Maintainer(s):** BigFish team (see the root README)
- **Escalation:** GitHub issues on the repo
