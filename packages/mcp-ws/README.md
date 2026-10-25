# 📦 BigFish MCP-over-WebSocket Transport

> Carries MCP JSON-RPC between the agent server and the extension over one WebSocket: JSON frames, a hello handshake, and a heartbeat on both ends.

![Version](https://img.shields.io/badge/version-0.1.0-blue)
![Status](https://img.shields.io/badge/status-Development-yellow)
![Runtime](https://img.shields.io/badge/runtime-TypeScript%20(Node%20%2B%20service%20worker)-informational)

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
`@bigfish/mcp-ws` lets an MCP client (the server) and an MCP server (the extension) talk over one WebSocket. It wraps each JSON-RPC message in a small JSON frame, runs a hello → ready handshake, and keeps a heartbeat on both ends, because a browser WebSocket cannot see protocol-level ping frames.

### Why this is its own package (not duplicated in apps)
- **Bounded context:** owns the socket lifecycle only: frames, handshake, heartbeat and close codes. No auth decisions and no tool logic.
- **Independent scaling need:** none; it is a library that runs inside the server process and the extension's service worker.
- **Independent deployability:** none; it ships inside both apps. It is a package so both ends use the exact same code.
- **Failure isolation:** a bad frame, a missing hello or a silent peer closes that one socket with a specific code. The apps decide what happens next.
- **Data isolation strategy:** no storage.

### The "User" of this package

| Consumer | Integration Type | Why it imports this package |
|---|---|---|
| `@bigfish/server` ([`ws/mcp-ws.ts`](../../apps/server/src/ws/mcp-ws.ts)) | In-process import | `ServerSocket` accepts `/mcp-ws`; `onHello` does auth and limits, then an MCP `Client` connects to the `FramedTransport` |
| `@bigfish/extension` ([`conn/connection.ts`](../../apps/extension/entrypoints/background/conn/connection.ts)) | In-process import | `openMcpSocket` dials the server; the extension's `McpServer` connects to the transport. Reconnect and backoff live in the extension |
| `apps/server/scripts/fake-extension.ts` | In-process import | A Node stand-in for the extension in tests |

---

## 🚧 Built Features & Current State

### Current state
| Field | Value |
|---|---|
| **Status** | 🟡 Development |
| **Version** | `0.1.0` |
| **Last deployed** | Workspace package, not published |
| **Owner(s)** | BigFish team |
| **Known technical debt** | One socket per `openMcpSocket` call; reconnect and backoff are left to the caller, so every client must reimplement them. |

### Features built (working today)
- `FramedTransport` — an MCP `Transport` over any `FrameSink` (`send`, `close`, `terminate`); queues up to 64 messages that arrive before `start()` — ✅ done
- `ServerSocket` — accepting side: 5 s hello deadline, contracts version check, `onHello` hook (throw `HandshakeError` to refuse with a close code), `ready` reply, then the transport — ✅ done
- `openMcpSocket` — dialing side: open, send hello, wait for ready, return `{ connId, transport, closed, close }`; `SocketOpenError` carries the close code so the caller knows whether to retry — ✅ done
- `startLiveness` — sends a heartbeat every 20 s and declares the peer dead after 45 s of silence — ✅ done

### How it was built
- **Language/runtime:** TypeScript; runs in Node ≥ 22 and in a Chrome MV3 service worker
- **Framework:** none (framework-free; the HTTP layer feeds raw text in)
- **Design patterns used:**
  - **Adapter:** `FramedTransport` adapts a WebSocket to the MCP SDK's `Transport` interface, so neither the MCP client nor the server knows about frames.
  - **Dependency injection:** sockets take a `FrameSink` and options (timeouts, `WebSocketImpl`), so tests swap in an in-memory pipe and short timers.
- **Key libraries:** `@bigfish/contracts` (frame schemas and constants)

---

## 🏗️ Architecture & Design Patterns

The server receives a hello and checks it, then replies ready; after that, MCP flows. Each side owns its socket and feeds frames to the transport; `mcp` frames go to the MCP SDK, `ctl` frames are handled here.

```
packages/mcp-ws/
├── src/
│   ├── framed-transport.ts    # MCP Transport over a FrameSink
│   ├── server-socket.ts       # accepting side: hello, version check, ready, liveness
│   ├── client-socket.ts       # dialing side: hello, wait for ready, liveness
│   ├── liveness.ts            # heartbeat timer and dead-peer detection
│   └── index.ts               # exports
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
pnpm --filter @bigfish/mcp-ws typecheck

# 4. Run tests (the transport is tested from the server package)
pnpm --filter @bigfish/server test
```

Dialing side, as the extension does it:

```typescript
import { openMcpSocket } from "@bigfish/mcp-ws";

const socket = await openMcpSocket({ url: `${WS_URL}?ticket=${ticket}`, deviceId, ext: "0.1.0" });
await mcpServer.connect(socket.transport);
const { code, reason } = await socket.closed; // decide here whether to reconnect
```

### Run via Docker / Skaffold
Not applicable: a library.

---

## 🔌 Communication & Contracts

### Synchronous (REST/gRPC)
| Direction | Protocol | Endpoint / method | Counterpart |
|---|---|---|---|
| Both | WebSocket text frames | `{"v":1,"k":"ctl","c":{"t":"hello"\|"ready"\|"hb",…}}` | the other end |
| Both | WebSocket text frames | `{"v":1,"k":"mcp","m":<JSON-RPC 2.0>}` | the other end's MCP SDK |

### Asynchronous (event/queue)
| Event | Direction | Broker / topic | Payload schema ref |
|---|---|---|---|
| Heartbeat `hb` | Produces and consumes | none (same socket) | [`wire.ts`](../contracts/src/wire.ts) |

### Contract source of truth
[`packages/contracts/src/wire.ts`](../contracts/src/wire.ts): frames, `HELLO_TIMEOUT_MS` (5 s), `HEARTBEAT_INTERVAL_MS` (20 s), `HEARTBEAT_DEADLINE_MS` (45 s), `MAX_FRAME_BYTES` (4 MB), and close codes (`4001` unauthorized, `4002` bad frame, `4003` replaced, `4004` hello timeout, `4005` heartbeat timeout, `4006` MCP init failed, `4008` too many devices, `4426` upgrade required, `1012` service restart).

---

## 🛡️ Production Readiness

### Health & observability
- **Liveness:** no `/healthz` (a library); per socket, the heartbeat closes a peer silent for 45 s with `4005`
- **Readiness:** no `/ready`; a socket is usable only after the `ready` frame
- **Graceful shutdown:** the server closes devices with `1012` (service restart); the extension reconnects after any code except `4003`, `4008` and `4426` (`NO_RECONNECT_CODES`)
- **Structured logging:** ❌ none in this package
- **Tracing:** ❌ none
- **Metrics:** ❌ none

### Security & compliance
- **AuthN/AuthZ:** none here; the server's `onHello` checks the ticket and limits
- **CORS policy:** not applicable
- **Rate limiting:** not applicable
- **Hardening:** frames over 4 MB or not matching the schema close the socket with `4002`
- **Secrets management:** none handled

### CI/CD & deployment
- **Container:** none
- **Orchestration:** none
- **Pipeline:** none yet
- **Rollback strategy:** git revert; bump `WIRE_VERSION` for any frame change

---

## 📝 Changelog & Migration State

| Version | Date | Change | Migration notes |
|---|---|---|---|
| `v0.1.0` | 2026-10 | Framed transport, hello/ready handshake, heartbeat on both ends | none |

---

## 🤝 Ownership
- **Maintainer(s):** BigFish team (see the root README)
- **Escalation:** GitHub issues on the repo
