# BigFish

Private browser MCP + LangGraph agent. See `Docs/Plan.md`.

## Layout

| Path | What |
|---|---|
| `packages/contracts` | Shared zod tool schemas, bridge messages, error codes |
| `apps/extension` | WXT Chrome extension (background, content, side panel, safety) |
| `apps/server` | Node + Hono server on `127.0.0.1:8787` (`/health`, `/mcp`) |
| `ML` | Python (uv) ML experiments, roadmap only |

## Run

```bash
pnpm install
pnpm dev:server
pnpm dev:ext
```

ML: `cd ML && uv sync && uv run python main.py`
