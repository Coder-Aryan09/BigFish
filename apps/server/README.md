# 🧩 BigFish Agent Server

> Runs the LangGraph agent and acts as the MCP client to each user's browser over one WebSocket.

![Version](https://img.shields.io/badge/version-0.1.0-blue)
![Status](https://img.shields.io/badge/status-Development-yellow)
![Runtime](https://img.shields.io/badge/runtime-Node.js%2022%20%2B%20TypeScript-informational)

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
`@bigfish/server` takes a user's task, plans it with a LangGraph graph (plan → act → verify → finalize), and runs browser tools on that user's own Chrome. The extension is the MCP server; this service is the MCP client, reached over `/mcp-ws`. It streams every step to the side panel as Server-Sent Events.

### Why this is its own microservice (not part of a monolith)
- **Bounded context:** owns agent runs (plans, subtasks, saved facts), the guards that check every tool call before it runs, and which device belongs to which user.
- **Independent scaling need:** a run holds a model conversation and an SSE stream open for up to 8 minutes. That is long-lived I/O, unlike the extension (one per browser, mostly idle) and the ML daemon (short CPU/GPU bursts).
- **Independent deployability:** prompts, guards and model providers change often. Shipping them here needs no new extension build or Chrome Web Store review.
- **Failure isolation:** if this server stops, the user's tabs and sign-ins are untouched. The extension shows `backoff` and reconnects when the server is back. Runs in progress end with `CANCELLED`.
- **Data isolation strategy:** in memory only. Device sessions, tickets and runs live in process memory, and nothing is written to disk. Page text arrives already masked by the extension.

### The "User" of this service

| Caller | Call type | Why it calls this service |
|---|---|---|
| Extension side panel | Sync HTTP + SSE (`POST /api/agent/invoke`, `/api/agent/cancel`) | Starts and cancels runs, shows live steps |
| Extension side panel | Sync REST (`POST /api/auth/google`) | Swaps a Google token for a BigFish JWT |
| Extension service worker | Sync REST (`POST /api/ws-ticket`), then WebSocket (`/mcp-ws`) | Connects as the MCP server with the 13 browser tools |
| Developer tools | Sync REST (`/api/dev/*`, only with `ENABLE_DEV_ROUTES=1`) | Dev login and calling tools by hand |

---

## 🚧 Built Features & Current State

### Current state
| Field | Value |
|---|---|
| **Status** | 🟡 Development (runs locally end to end) |
| **Version** | `0.1.0` |
| **Last deployed** | Not deployed; runs on `127.0.0.1:8787` |
| **Owner(s)** | BigFish team |
| **Known technical debt** | Sessions, tickets and runs are in memory on one process, so a second instance would not share them. No structured logging (plain `console.log`), no rate limiting, no CORS middleware. Dev routes have no auth. |

### Features built (working today)
- `GET /health`, `GET /healthz`, `GET /ready` — return `{ ok, name, devices, runs }` — ✅ done
- `POST /api/auth/google` — body `{ accessToken }`, checks it with Google, returns `{ ok, token, expiresAt, email }` (HS256 JWT, 1 hour) — ✅ done
- `POST /api/ws-ticket` — JWT in, one-time ticket out (`{ ok, ticket }`), valid 30 s — ✅ done
- `GET /api/devices`, `POST /api/devices/:deviceId/ping` — the user's connected browsers, and a ping through MCP — ✅ done
- `POST /api/agent/invoke` — body `{ deviceId, prompt }` (prompt ≤ 4,000 chars), streams `AgentEvent`s as SSE — ✅ done
- `POST /api/agent/cancel` — body `{ runId }`, stops the run and the tool call in flight — ✅ done
- `GET /mcp-ws` — WebSocket upgrade; checks the ticket and that the Origin is `chrome-extension://<EXTENSION_ID>` — ✅ done
- Guards before every tool call — ✅ done:
  - **Arg normalizer:** drops `null`, `""`, `false` and an `action` next to a `url`.
  - **Personal-details guard:** names, emails, phones, addresses and IDs must come from the task or a page.
  - **Loop guard:** refuses the same call 3 times in a row, a call that failed twice, and two actions taking turns.
- Limits — 80 browser tool calls per run, 30 per subtask, 8 minutes, one run per device, 3 devices per user — ✅ done
- Model providers — NVIDIA (first), OpenRouter, Mistral; 90 s call timeout, 6 retries with backoff, retry on a reply cut at the token limit — ✅ done

### How it was built
- **Language/runtime:** Node.js ≥ 22, TypeScript, run with `tsx`
- **Framework:** Hono 4 with `@hono/node-server` and `@hono/node-ws`
- **Design patterns used:**
  - **State machine (LangGraph):** the graph keeps subtasks and saved facts, not a growing chat history, so each subtask starts with a small, fresh context.
  - **Dependency injection:** the graph only sees the `AgentModels` interface ([`models.ts`](src/agent/models.ts)), so tests run with scripted models and providers swap by env var.
  - **Guard chain:** normalizer, loop guard and personal guard run in [`actor.ts`](src/agent/actor.ts) before a call reaches the browser, so a bad call is refused instead of undone.
  - **One-time ticket auth:** the WebSocket never sees the JWT; a ticket works once and expires in 30 s.
- **Key libraries:** `@langchain/langgraph`, `@langchain/openai` (NVIDIA and OpenRouter), `@langchain/mistralai`, `@modelcontextprotocol/client`, `jose`, `zod`, `@bigfish/contracts`, `@bigfish/mcp-ws`

---

## 🏗️ Architecture & Design Patterns

A request goes route → controller → graph. Each graph node is small: `plan` asks the planner for 1 to 6 subtasks, `act` runs the tool loop for one subtask ([`actor.ts`](src/agent/actor.ts)), `verify` asks a judge model with the page text and saved facts, and `finalize` writes the answer. Tool calls go through [`tool-policy.ts`](src/agent/tool-policy.ts): read-only tools retry once after a reconnect; tools that change the page never retry and return `STATE_UNKNOWN`.

```
apps/server/
├── src/
│   ├── agent/             # graph, actor, prompts, models, tools, tool-policy, loop-guard, personal-guard
│   ├── auth/              # Google token check, JWT, tickets, middleware
│   ├── controllers/       # agent invoke and cancel (SSE, heartbeat, limits)
│   ├── mcp/               # device sessions and registry (max 3 per user)
│   ├── routes/            # /api/auth, /api/devices, /api/agent, /api/dev
│   ├── ws/                # /mcp-ws upgrade and handshake
│   ├── app/               # Hono app factory
│   ├── runs.ts            # run registry and cancel
│   ├── server.ts          # start and close
│   └── index.ts           # entrypoint: env, model provider, signals
├── fixtures/              # local pages for E2E tests and agent evals
├── scripts/fake-extension.ts
├── test/                  # 41 tests: agent loop, MCP pipe, auth, loop guard, personal guard
└── package.json
```

---

## ⚙️ Usage & Setup

### Environment variables

| Key | Required | Description | Example (fake) |
|---|---|---|---|
| `PORT` | ❌ | Port to listen on (default 8787) | `8787` |
| `HOST` | ❌ | Bind address (default 127.0.0.1) | `127.0.0.1` |
| `NVIDIA_API_KEY` | One model key ✅ | NVIDIA key (free at build.nvidia.com). Used first when set | `nvapi-sample-xxxxxxxx` |
| `NVIDIA_MODEL` | ❌ | NVIDIA agent model (must support tool calling) | `nvidia/nemotron-3.5-super-vl-120b-a12b` |
| `NVIDIA_JUDGE_MODEL` | ❌ | NVIDIA model that checks each subtask | `nvidia/nemotron-3.5-lightning-30b-a3b` |
| `OPEN_ROUTER_API_KEY` | One model key ✅ | OpenRouter key. Used when no NVIDIA key is set | `sk-or-v1-sample-xxxxxxxx` |
| `OPEN_ROUTER_MODEL` | ❌ | OpenRouter agent model | `openai/gpt-6-luna` |
| `OPEN_ROUTER_JUDGE_MODEL` | ❌ | OpenRouter judge model (defaults to `OPEN_ROUTER_MODEL`) | `openai/gpt-6-luna` |
| `MISTRAL_API_KEY` | One model key ✅ | Mistral key. Used when no NVIDIA or OpenRouter key is set. With no model key, `/api/agent/invoke` answers 503 | `mstrl_sample_api_key_xxxxxxxx` |
| `AGENT_MODEL` | ❌ | Mistral agent model (must support tool calling) | `mistral-medium-latest` |
| `AGENT_JUDGE_MODEL` | ❌ | Mistral judge model | `mistral-small-latest` |
| `TINYFISH_API_KEY` | ❌ | Reserved for TinyFish web research (not built yet) | `tf_sample_xxxxxxxx` |
| `GOOGLE_EXTENSION_CLIENT_ID` | ✅ | Google OAuth client of type "Chrome Extension" | `123456789-sample.apps.googleusercontent.com` |
| `JWT_SECRET` | ✅ | Signs BigFish JWTs; at least 32 random characters | `super-secret-random-jwt-key-32chars` |
| `EXTENSION_ID` | ✅ | The only Origin `/mcp-ws` accepts | `abcdefghijklmnopabcdefghijklmnop` |
| `ENABLE_DEV_ROUTES` | ❌ | `1` adds `/api/dev/*` (no auth) and relaxes missing auth values. Never in production | `0` |

### Run locally
```bash
# 1. Install dependencies (repo root)
pnpm install

# 2. Configure environment
cp apps/server/.env.example apps/server/.env

# 3. Start in dev mode (file watch; restart after editing .env)
pnpm dev:server

# 4. Run tests and typecheck
pnpm --filter @bigfish/server test
pnpm --filter @bigfish/server typecheck
```

### Run via Docker / Skaffold
No Dockerfile or manifests yet. The server runs with `tsx` directly.

---

## 🔌 Communication & Contracts

### Synchronous (REST/gRPC)
| Direction | Protocol | Endpoint / method | Counterpart |
|---|---|---|---|
| Inbound | HTTP + SSE | `POST /api/agent/invoke`, `POST /api/agent/cancel` | Extension side panel |
| Inbound | HTTP | `POST /api/auth/google`, `POST /api/ws-ticket`, `GET /api/devices` | Extension |
| Inbound | WebSocket | `GET /mcp-ws` (JSON frames, MCP inside) | Extension service worker (MCP server) |
| Outbound | MCP `tools/call` over `/mcp-ws` | the 13 `browser_*` tools | Extension |
| Outbound | HTTPS | chat completions | NVIDIA, OpenRouter or Mistral |
| Outbound | HTTPS | Google token check | Google |

### Asynchronous (event/queue)
| Event | Direction | Broker / topic | Payload schema ref |
|---|---|---|---|
| `run`, `plan`, `step`, `tool_call`, `progress`, `tool_result`, `final`, `error` | Produces (SSE to the side panel) | none (HTTP stream) | [`agent.ts`](../../packages/contracts/src/agent.ts) |

No message broker. The SSE stream also sends a `: keepalive` comment every 15 s.

### Contract source of truth
[`packages/contracts`](../../packages/contracts/README.md): tool schemas in `tools.ts`, wire frames in `wire.ts`, error codes in `errors.ts`, events in `agent.ts`.

---

## 🛡️ Production Readiness

### Health & observability
- **Liveness:** `GET /healthz` (also `/health`) — the process answers; returns device and run counts
- **Readiness:** `GET /ready` — same data; it does not check models or Google
- **Graceful shutdown:** on `SIGINT`/`SIGTERM`, runs end with `CANCELLED`, devices get close code `1012` (service restart), sockets still in the handshake are dropped, then the HTTP server closes
- **Structured logging:** ❌ not yet. Plain `console.log` lines prefixed `[BigFish]`
- **Tracing:** ❌ none
- **Metrics:** ❌ none

### Security & compliance
- **AuthN/AuthZ:** Google token → HS256 JWT (1 hour, no refresh) → one-time 30 s ticket for `/mcp-ws`. Devices and runs are looked up under the JWT user, so other users' devices are not found
- **CORS policy:** ❌ no CORS middleware; the API is meant for the extension on localhost
- **Rate limiting:** ❌ none; one run per device at a time
- **Hardening:** Zod validation on every tool call; page text sent to the model as `<page untrusted>`; personal-details guard; `/mcp-ws` checks Origin
- **Secrets management:** `.env` (gitignored). No vault yet

### CI/CD & deployment
- **Container:** none yet
- **Orchestration:** none yet
- **Pipeline:** none yet; run tests locally
- **Rollback strategy:** git revert

---

## 📝 Changelog & Migration State

| Version | Date | Change | Migration notes |
|---|---|---|---|
| `v0.1.0` | 2026-10-25 | Agent hardening: arg normalizer, personal-details guard, ping-pong loop guard, judge sees task and facts, SSE heartbeat, timeouts and retries. NVIDIA and OpenRouter providers | Add one model key to `.env` (`NVIDIA_API_KEY` recommended) |
| `v0.1.0` | 2026-10 | LangGraph plan, act, verify, finalize; Hono server; Google login; `/mcp-ws` | none |

---

## 🤝 Ownership
- **Maintainer(s):** BigFish team (see the root README)
- **Escalation:** GitHub issues on the repo
