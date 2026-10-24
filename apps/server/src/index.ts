// BigFish server: bridge WS, MCP endpoint, and agent runs.
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { mcpHandler } from "./mcp.js";
import { bridge } from "./bridge.js";

const PORT = Number(process.env.PORT ?? 8787);
const HOST = process.env.HOST ?? "127.0.0.1";

const app = new Hono();

app.get("/health", (c) => c.json({ ok: true, name: "bigfish", bridge: bridge.isConnected() }));
app.all("/mcp", (c) => mcpHandler.fetch(c.req.raw));

serve({ fetch: app.fetch, port: PORT, hostname: HOST }, (info) => {
  console.log(`[BigFish] server on http://${HOST}:${info.port}`);
});
