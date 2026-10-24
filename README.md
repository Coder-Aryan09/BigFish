# BigFish

Private browser MCP + LangGraph agent.

BigFish exposes your real Chrome browser to AI agents over MCP. PII is redacted inside the extension before any data leaves the browser. A LangGraph agent on the server can also drive the browser, and use TinyFish for public web research.

Full plan: [`Docs/Plan.md`](Docs/Plan.md).

## Status

Early skeleton. Most files are stubs.

| Part | State |
|---|---|
| Monorepo, workspace, TypeScript config | Done |
| Server: `/health` and `/mcp` routes | Running |
| Server: bridge to the extension | Stub, always "not connected" |
| Server: agent (graph, models, tinyfish, tools) | Not built yet |
| Extension: service worker, side panel | Boots, no features yet |
| Extension: safety modules | Files present, not wired |
| Auth on `/mcp` (bearer tokens) | Not built yet |
| ML | Roadmap only |

## Layout

| Path | What |
|---|---|
| `packages/contracts` | Shared zod tool schemas, bridge messages, error codes |
| `apps/extension` | WXT Chrome extension (background, content, side panel, safety) |
| `apps/server` | Node + Hono server on `127.0.0.1:8787` (`/health`, `/mcp`) |
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
| `ANTHROPIC_API_KEY` | empty | Key for the agent model. Used once the agent is built |
| `AGENT_MODEL` | `claude-sonnet-5-5` | Model for the agent. Used once the agent is built |
| `TINYFISH_API_KEY` | empty | TinyFish key for public web research. Used once the agent is built |
| `TINYFISH_REPLAY` | `0` | `1` replays cached TinyFish runs |
| `USE_MCP_LOOPBACK` | `0` | `1` makes the agent call the browser through MCP instead of in-process |
| `MCP_TOKEN_CLAUDE_CODE` | empty | Bearer token for Claude Code. Not enforced yet |
| `MCP_TOKEN_INSPECTOR` | empty | Bearer token for MCP Inspector. Not enforced yet |
| `DEVICE_TOKEN` | empty | Token for the extension bridge. Not enforced yet |

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
# {"ok":true,"name":"bigfish","bridge":false}
```

`bridge: false` is expected until the bridge is built.

### Load the extension by hand (optional)

If `pnpm dev:ext` does not open Chrome for you:

1. Run `pnpm --filter @bigfish/extension build`
2. Open `chrome://extensions`
3. Turn on **Developer mode**
4. Click **Load unpacked**
5. Pick the folder `apps/extension/.output/chrome-mv3`

## Scripts

Run from the repo root.

| Command | Does |
|---|---|
| `pnpm dev:server` | Server with file watch |
| `pnpm dev:ext` | Extension dev mode (WXT) |
| `pnpm build` | Build all packages |
| `pnpm typecheck` | Typecheck all packages |
| `pnpm --filter @bigfish/extension zip` | Zip the extension for upload |

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
| `/health` shows `"bridge": false` | Expected for now, the bridge is a stub |
| MCP tool says "Extension not connected" | Same reason, the bridge is not built yet |
| Extension type errors after install | Run `pnpm --filter @bigfish/extension exec wxt prepare` |

## Security notes

- The server binds to `127.0.0.1` only. Do not change `HOST` to `0.0.0.0` until `/mcp` has auth.
- Never commit `.env` files, keys, or tokens. `.gitignore` blocks them.
