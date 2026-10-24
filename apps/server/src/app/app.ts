// BigFish HTTP app: health, the /mcp-ws socket for extensions, and dev routes.
import { Hono } from "hono";
import { createNodeWebSocket } from "@hono/node-ws";
import { MAX_FRAME_BYTES, WS_PATH } from "@bigfish/contracts";
import { SessionRegistry } from "../mcp/registry.js";
import { mcpHandler } from "../mcp.js";
import { devRoutes } from "../routes/dev.routes.js";
import { mcpWsHandler, type SocketTuning } from "../ws/mcp-ws.js";

export interface AppOptions {
  registry?: SessionRegistry;
  devRoutes?: boolean;
  socket?: SocketTuning;
}

export function createApp(opts: AppOptions = {}) {
  const registry = opts.registry ?? new SessionRegistry();
  const app = new Hono();
  const nodeWs = createNodeWebSocket({ app });
  // ws reads this per upgrade. Bigger frames close the socket with 1009.
  nodeWs.wss.options.maxPayload = MAX_FRAME_BYTES;

  app.get("/health", (c) => c.json({ ok: true, name: "bigfish", devices: registry.size }));
  app.get(WS_PATH, mcpWsHandler(nodeWs.upgradeWebSocket, { registry, socket: opts.socket }));
  // Old server-hosted MCP endpoint. Replaced by /mcp-ws, removed in step 2.
  app.all("/mcp", (c) => mcpHandler.fetch(c.req.raw));
  if (opts.devRoutes) app.route("/api/dev", devRoutes(registry));

  return { app, registry, injectWebSocket: nodeWs.injectWebSocket, wss: nodeWs.wss };
}
