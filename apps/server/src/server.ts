// Starts the HTTP server with WebSocket upgrades wired in. Used by index.ts and tests.
import type { AddressInfo } from "node:net";
import { serve } from "@hono/node-server";
import { CloseCode } from "@bigfish/contracts";
import { createApp, type AppOptions } from "./app/app.js";

export interface StartOptions extends AppOptions {
  port: number;
  host: string;
}

export async function startServer(opts: StartOptions) {
  const { app, registry, injectWebSocket, wss } = createApp(opts);

  const server = await new Promise<ReturnType<typeof serve>>((resolve) => {
    const s = serve({ fetch: app.fetch, port: opts.port, hostname: opts.host }, () => resolve(s));
    injectWebSocket(s);
  });
  const port = (server.address() as AddressInfo).port;

  async function close(): Promise<void> {
    registry.closeAll(CloseCode.SERVICE_RESTART, "server shutting down");
    // Sockets that never finished the handshake are not in the registry.
    for (const ws of wss.clients) ws.terminate();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  return { server, port, registry, close };
}
