# BigFish

Private browser MCP + LangGraph agent.

BigFish exposes your real Chrome browser to AI agents over MCP. PII is redacted inside the extension before any data leaves the browser. A LangGraph agent on the server can also drive the browser, and use TinyFish for public web research.

Full plan: [`Docs/Plan.md`](Docs/Plan.md).

## Status

Working end to end on a real browser: sign in, connect, run an agent prompt, use all 13 browser tools.

| Part | State |
|---|---|
| Monorepo, workspace, TypeScript config | Done |
| Server: `/health`, Google login, `/mcp-ws` (extension is the MCP server, server is the MCP client) | Running |
| Server: device sessions per user (max 3), tool calls one at a time per device | Running |
| Server: agent (LangGraph plan, act, verify, finalize on NVIDIA, OpenRouter or Mistral), SSE run API with cancel | Running |
| Server: TinyFish cloud research | Not built yet |
| Extension: Google sign-in, MCP connection with reconnect, side panel account bar | Running |
| Extension: 13 browser tools, refs + deltas, PII vault, approvals (side panel or popup), URL policy | Running |
| Auth: Google token -> JWT -> one-time ticket for `/mcp-ws` | Running |
| ML | Roadmap only |

## Layout

| Path | What |
|---|---|
| `packages/contracts` | Shared zod tool schemas, wire protocol, error codes |
| `packages/mcp-ws` | MCP over one WebSocket: framing, handshake, heartbeats (used by server and extension) |
| `apps/extension` | WXT Chrome extension (background, content, side panel, safety) |
| `apps/server` | Node + Hono server on `127.0.0.1:8787` (`/health`, `/api/auth/google`, `/api/ws-ticket`, `/api/devices`, `/api/agent/*`, `/mcp-ws`) |
| `apps/server/fixtures` | Local test pages for the E2E tests |
| `ML` | Python (uv) ML experiments, roadmap only |
| `Docs` | Build plan |
| `scripts` | Helper scripts (empty for now) |

## Prerequisites

| Tool | Version | Needed for |
|---|---|---|
| Node.js | 22 or newer | Everything |
| pnpm | 12.15.0 | Everything. Run `corepack enable` and it picks the right version |
| Chrome | 116 or newer | Running the extension |
| Python + [uv](https://docs.astral.sh/uv/) | See `ML/.python-version` | `ML` folder only |

## Setup

```bash
git clone https://github.com/Coder-Aryan09/BigFish.git
cd BigFish
corepack enable
pnpm install
cp apps/server/.env.example apps/server/.env
```

- `pnpm install` also runs `wxt prepare` for the extension.
- Edit `apps/server/.env` and fill the keys you have. Never commit this file.

### Environment variables

All live in `apps/server/.env`.

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `8787` | Server port. Read today |
| `HOST` | `127.0.0.1` | Bind address. Keep it local. Read today |
| `NVIDIA_API_KEY` | empty | NVIDIA key (free at build.nvidia.com). When set, it is used before OpenRouter and Mistral |
| `NVIDIA_MODEL` | `nvidia/nemotron-3.5-super-vl-120b-a12b` | NVIDIA model for the agent (must support tool calling) |
| `NVIDIA_JUDGE_MODEL` | `nvidia/nemotron-3.5-lightning-30b-a3b` | NVIDIA model that checks each subtask |
| `OPEN_ROUTER_API_KEY` | empty | OpenRouter key, used when no NVIDIA key is set |
| `OPEN_ROUTER_MODEL` | `openai/gpt-6-luna` | OpenRouter model for the agent (must support tool calling) |
| `OPEN_ROUTER_JUDGE_MODEL` | same as `OPEN_ROUTER_MODEL` | OpenRouter model that checks each subtask |
| `MISTRAL_API_KEY` | empty | Mistral key, used when no OpenRouter key is set. With neither key, `/api/agent/invoke` answers 503 |
| `AGENT_MODEL` | `mistral-medium-latest` | Mistral model for the agent (must support tool calling) |
| `AGENT_JUDGE_MODEL` | `mistral-small-latest` | Cheaper model that checks each subtask |
| `TINYFISH_API_KEY` | empty | TinyFish key for public web research. Used once the agent is built |
| `TINYFISH_REPLAY` | `0` | `1` replays cached TinyFish runs |
| `GOOGLE_EXTENSION_CLIENT_ID` | empty | Google OAuth client (type "Chrome Extension"). Required unless dev routes are on |
| `JWT_SECRET` | empty | Signs BigFish JWTs. At least 32 random characters. Required unless dev routes are on |
| `EXTENSION_ID` | empty | Fixed extension ID. `/mcp-ws` only accepts this Origin. Required unless dev routes are on |
| `ENABLE_DEV_ROUTES` | `0` | `1` adds dev login, device list and ping under `/api/dev`, and relaxes missing auth values. Never in production |

The extension reads `apps/extension/.env` (see `.env.example` there): `WXT_SERVER_URL`, `WXT_EXTENSION_KEY` (public key only), `WXT_GOOGLE_CLIENT_ID`.

## Run

Use two terminals from the repo root.

```bash
# Terminal 1: server
pnpm dev:server

# Terminal 2: extension (opens a dev Chrome with the extension loaded)
pnpm dev:ext
```

Check the server:

```bash
curl http://127.0.0.1:8787/health
# {"ok":true,"name":"bigfish","devices":1,"runs":0}
```

`devices` is 1 once the extension is signed in and connected.

### Load the extension by hand (optional)

If `pnpm dev:ext` does not open Chrome for you:

1. Run `pnpm --filter @bigfish/extension build`
2. Open `chrome://extensions`
3. Turn on **Developer mode**
4. Click **Load unpacked**
5. Pick the folder `apps/extension/dist/chrome-mv3`

## Scripts

Run from the repo root.

| Command | Does |
|---|---|
| `pnpm dev:server` | Server with file watch |
| `pnpm dev:ext` | Extension dev mode (WXT) |
| `pnpm build` | Build all packages |
| `pnpm typecheck` | Typecheck all packages |
| `pnpm --filter @bigfish/extension zip` | Zip the extension for upload |
| `pnpm --filter @bigfish/server test` | Server tests: MCP pipe, login, agent run loop (fake extension, scripted model) |
| `pnpm --filter @bigfish/extension test` | Safety unit tests: PII, rehydration, action and URL policy |
| `pnpm --filter @bigfish/extension e2e` | Playwright E2E: Chromium + built extension + server + fixture pages, incl. tool edge cases (`tools-edge.spec.ts`). First run: `pnpm --filter @bigfish/extension exec playwright install chromium` |
| `NVIDIA_API_KEY=... pnpm --filter @bigfish/extension exec tsx e2e/agent-eval.ts [case...]` | Agent evals with the real model on fixture pages (forms, shop, table, mail, chat). Needs the e2e build (run `e2e` once). Traces go to `test-results/agent-eval/` |

## ML (optional)

```bash
cd ML
uv sync
uv run python main.py
```

## Working with AI agents

This repo has guardrails for AI coding agents (Claude Code, Cursor, Codex, Gemini, Copilot).

- Rules for agents: [`AGENTS.md`](AGENTS.md)
- Enable the pre-commit secret check once per clone:

```bash
git config core.hooksPath .githooks
```

- Check the guardrails:

```bash
node agent-guardrails/test-guardrails.mjs
```

## Troubleshooting

| Problem | Fix |
|---|---|
| `pnpm: command not found` or wrong version | Run `corepack enable`, then retry |
| Node version error | Install Node 22 or newer |
| Port 8787 already in use | Set a different `PORT` in `apps/server/.env` |
| Server exits with `Missing auth config` | Fill `GOOGLE_EXTENSION_CLIENT_ID`, `JWT_SECRET`, `EXTENSION_ID`, or set `ENABLE_DEV_ROUTES=1` for local work |
| Side panel stays "Signed out" after clicking sign in | Check `WXT_GOOGLE_CLIENT_ID` and `WXT_EXTENSION_KEY`, then rebuild and reload the extension |
| Extension type errors after install | Run `pnpm --filter @bigfish/extension exec wxt prepare` |

## Security notes

- The server binds to `127.0.0.1` by default. Before exposing it, run without `ENABLE_DEV_ROUTES` and with all three auth values set.
- Never commit `.env` files, keys, or tokens. `.gitignore` blocks them.
