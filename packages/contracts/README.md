# 📦 BigFish Shared Contracts

> The one place that defines the 13 browser tools, the wire frames, the error codes and the agent events that the server and the extension both use.

![Version](https://img.shields.io/badge/version-0.1.0-blue)
![Status](https://img.shields.io/badge/status-Development-yellow)
![Runtime](https://img.shields.io/badge/runtime-TypeScript%20%2B%20Zod%204-informational)

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

### What this package does
`@bigfish/contracts` holds the Zod schemas and constants that both ends of BigFish must agree on: the input of each browser tool, the WebSocket frames, the error codes, the run limits and the `AgentEvent` stream. The extension registers its MCP tools from `TOOLS`, and the server builds the model's tool list and checks every model call against the same schemas.

### Why this is its own package (not duplicated in apps)
- **Bounded context:** owns the shape of everything that crosses the wire. No other package defines a tool schema or a frame.
- **Independent scaling need:** none; it is a set of schemas imported in-process.
- **Independent deployability:** none; it is a workspace package. Its value is that the server and extension cannot drift: a schema change breaks the typecheck of both.
- **Failure isolation:** a model call with bad arguments fails Zod validation on the server, before it reaches the browser.
- **Data isolation strategy:** no storage.

### The "User" of this package

| Consumer | Integration Type | Why it imports this package |
|---|---|---|
| `@bigfish/server` | In-process import | Tool defs for the model, `normalizeToolArgs` + Zod check of every call, error codes, `RUN_LIMITS`, `AgentEvent` |
| `@bigfish/extension` | In-process import | Registers the MCP tools from `TOOLS`, `normalizeToolArgs` in the executor, error codes, `AgentEvent` in the side panel |
| `@bigfish/mcp-ws` | In-process import | Frame encode/decode, handshake timeouts, close codes |

---

## 🚧 Built Features & Current State

### Current state
| Field | Value |
|---|---|
| **Status** | 🟡 Development |
| **Version** | `0.1.0` (`WIRE_VERSION` 1, `CONTRACTS_VERSION` 1) |
| **Last deployed** | Workspace package, not published |
| **Owner(s)** | BigFish team |
| **Known technical debt** | Shipped as TypeScript source (`main: ./src/index.ts`), so it only works inside this workspace; publishing would need a build step. The extension's MCP layer wraps the schemas to accept `null`/`""`; the base schemas do not. |

### Features built (working today)
- `TOOLS` — 13 tool contracts, each with a name, description, Zod input with per-field "when to omit" descriptions, and read-only/destructive hints — ✅ done:
  - `browser_ping`, `browser_tabs`, `browser_navigate`, `browser_snapshot`, `browser_find`
  - `browser_click`, `browser_type`, `browser_fill_form`, `browser_select`, `browser_press_key`
  - `browser_scroll`, `browser_wait_for`, `browser_extract`
- `normalizeToolArgs(name, args)` — drops filler args models send: `null`, `""`, and `false` unless the default is `true`. A `url` wins over a stray `action` — ✅ done
- `TOOL_NAMES` — the allowlist; tools an extension reports outside it never reach the agent — ✅ done
- Wire — `encodeMcp`, `encodeCtl`, `decodeFrame`, `WS_PATH` (`/mcp-ws`), timeouts, `MAX_FRAME_BYTES` (4 MB), `CloseCode`, `NO_RECONNECT_CODES` — ✅ done
- Errors — `ErrorCode` for tool results (`STALE_REF`, `NOT_ACTIONABLE`, `POLICY_BLOCKED`, `LOOP`, `STATE_UNKNOWN`…), `ApiErrorCode` for HTTP, and `toolError()` for the `ERROR CODE: message Hint: …` line — ✅ done
- Agent — `AgentEvent` union (`run`, `plan`, `step`, `tool_call`, `progress`, `tool_result`, `final`, `error`), `AgentErrorCode`, `RUN_LIMITS` (80 tool calls, 8 min, 4,000-char prompt) — ✅ done

### How it was built
- **Language/runtime:** TypeScript (ESM source)
- **Framework:** none
- **Design patterns used:**
  - **Schema as the contract:** Zod schemas are both the runtime check and the JSON Schema sent to models and MCP clients, so the docs a model sees are the rules the code enforces.
- **Key libraries:** `zod` 4

---

## 🏗️ Architecture & Design Patterns

Flat modules, one per concern, re-exported from `index.ts`.

```
packages/contracts/
├── src/
│   ├── tools.ts       # TOOLS (13 schemas), normalizeToolArgs, TOOL_NAMES
│   ├── wire.ts        # frames, encode/decode, timeouts, close codes
│   ├── errors.ts      # ErrorCode, ApiErrorCode, toolError()
│   ├── agent.ts       # AgentEvent, AgentErrorCode, RUN_LIMITS
│   └── index.ts       # exports
├── tsconfig.json
└── package.json
```

---

## ⚙️ Usage & Setup

### Environment variables

| Key | Required | Description | Example (fake) |
|---|---|---|---|
| none | ❌ | This package reads no environment variables | `n/a` |

### Run locally
```bash
# 1. Install dependencies (repo root)
pnpm install

# 2. Configure environment
# nothing to configure

# 3. Typecheck
pnpm --filter @bigfish/contracts typecheck

# 4. Run tests (contracts are tested through the server and extension suites)
pnpm --filter @bigfish/server test
```

Checking a model's tool call, as the server does:

```typescript
import { TOOLS, normalizeToolArgs } from "@bigfish/contracts";

const navigate = TOOLS.find((t) => t.name === "browser_navigate")!;
const args = normalizeToolArgs("browser_navigate", { url: "https://example.com", action: "forward", tab: null });
// → { url: "https://example.com" }
const parsed = navigate.input.safeParse(args);
```

### Run via Docker / Skaffold
Not applicable: a library.

---

## 🔌 Communication & Contracts

### Synchronous (REST/gRPC)
| Direction | Protocol | Endpoint / method | Counterpart |
|---|---|---|---|
| Defines | MCP `tools/call` | 13 `browser_*` inputs | Server (caller) and extension (callee) |
| Defines | WebSocket frames | `ctl` (`hello`, `ready`, `hb`) and `mcp` | `@bigfish/mcp-ws` |
| Defines | HTTP error body | `{ ok: false, code: ApiErrorCode, message }` | Server routes |

### Asynchronous (event/queue)
| Event | Direction | Broker / topic | Payload schema ref |
|---|---|---|---|
| `AgentEvent` (8 types) | Defines (server produces, side panel consumes) | SSE on `POST /api/agent/invoke` | [`agent.ts`](src/agent.ts) |

### Contract source of truth
This package. Change a tool or frame here, then run `pnpm typecheck` at the root to see every place that has to follow.

---

## 🛡️ Production Readiness

### Health & observability
- **Liveness:** no `/healthz` (a library; the server exposes `/healthz` and `/ready`)
- **Readiness:** no `/ready` (same reason)
- **Graceful shutdown:** not applicable
- **Structured logging:** not applicable
- **Tracing:** not applicable
- **Metrics:** not applicable

### Security & compliance
- **AuthN/AuthZ:** not applicable
- **CORS policy:** not applicable
- **Rate limiting:** `RUN_LIMITS` sets the caps the server enforces
- **Hardening:** Zod strips unknown keys; `decodeFrame` refuses frames over 4 MB or off-schema
- **Secrets management:** none handled

### CI/CD & deployment
- **Container:** none
- **Orchestration:** none
- **Pipeline:** none yet; covered by the root `pnpm typecheck`
- **Rollback strategy:** git revert. A breaking frame change must bump `WIRE_VERSION`; a breaking tool change must bump `CONTRACTS_VERSION`; the server then refuses an extension on another version at hello (close code `4426`)

---

## 📝 Changelog & Migration State

| Version | Date | Change | Migration notes |
|---|---|---|---|
| `v0.1.0` | 2026-10-25 | Field descriptions on every optional tool input; `normalizeToolArgs` | none (additive) |
| `v0.1.0` | 2026-10 | 13 tool schemas, wire frames, error codes, agent events | none |

---

## 🤝 Ownership
- **Maintainer(s):** BigFish team (see the root README)
- **Escalation:** GitHub issues on the repo
