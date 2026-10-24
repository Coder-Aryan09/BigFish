// Dev-only routes for checking the MCP pipe by hand. Mounted only when
// ENABLE_DEV_ROUTES=1. Removed once the agent routes exist.
import { Hono } from "hono";
import { ErrorCode } from "@bigfish/contracts";
import type { SessionRegistry } from "../mcp/registry.js";
import { SessionError } from "../mcp/session.js";
import { DEV_USER_ID } from "../ws/mcp-ws.js";

export function devRoutes(registry: SessionRegistry) {
  const routes = new Hono();

  routes.get("/devices", (c) =>
    c.json(
      registry.all().map((s) => ({
        ...s.info,
        state: s.state,
        connectedAt: new Date(s.connectedAt).toISOString(),
        tools: s.tools.map((t) => t.name),
      })),
    ),
  );

  routes.get("/devices/:deviceId/ping", async (c) => {
    const session = registry.get(DEV_USER_ID, c.req.param("deviceId"));
    if (!session) return c.json({ ok: false, code: ErrorCode.NOT_CONNECTED }, 404);
    try {
      const result = await session.callTool("browser_ping", {}, { timeoutMs: 10_000 });
      return c.json({ ok: !result.isError, content: result.content });
    } catch (err) {
      const code = err instanceof SessionError ? err.code : ErrorCode.TIMEOUT;
      return c.json({ ok: false, code, message: err instanceof Error ? err.message : String(err) }, 502);
    }
  });

  return routes;
}
