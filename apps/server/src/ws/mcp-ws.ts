// GET /mcp-ws: the extension dials in here. The extension is the MCP server,
// this side is the MCP client. ServerSocket runs the handshake, then a
// DeviceSession connects an MCP Client over the socket and joins the registry.
import { randomUUID } from "node:crypto";
import type { NodeWebSocket } from "@hono/node-ws";
import { CloseCode, type Hello } from "@bigfish/contracts";
import { ServerSocket, type FramedTransport, type ServerSocketOptions } from "@bigfish/mcp-ws";
import { DeviceSession } from "../mcp/session.js";
import type { SessionRegistry } from "../mcp/registry.js";

// Until Google login lands (step 2), every device belongs to this user.
export const DEV_USER_ID = "dev";

export type SocketTuning = Partial<
  Pick<ServerSocketOptions, "helloTimeoutMs" | "heartbeatIntervalMs" | "heartbeatDeadlineMs">
>;

export interface McpWsOptions {
  registry: SessionRegistry;
  socket?: SocketTuning;
}

export function mcpWsHandler(upgradeWebSocket: NodeWebSocket["upgradeWebSocket"], opts: McpWsOptions) {
  return upgradeWebSocket(() => {
    const connId = randomUUID();
    const userId = DEV_USER_ID;
    let socket: ServerSocket | null = null;

    async function attach(transport: FramedTransport, hello: Hello): Promise<void> {
      try {
        const session = await DeviceSession.open(transport, {
          connId,
          userId,
          deviceId: hello.deviceId,
          ext: hello.ext,
        });
        if (session.state === "closed") return;
        opts.registry.add(session);
        console.log(`[BigFish] device ${hello.deviceId} connected (${session.tools.length} tools, ext ${hello.ext})`);
        session.onClose(() => console.log(`[BigFish] device ${hello.deviceId} disconnected`));
      } catch (err) {
        console.warn(`[BigFish] device ${hello.deviceId} failed MCP init:`, err instanceof Error ? err.message : err);
      }
    }

    return {
      onOpen(_event, ws) {
        socket = new ServerSocket(
          {
            send: (text) => ws.send(text),
            close: (code, reason) => ws.close(code, reason),
            terminate: () => ws.raw?.terminate(),
          },
          { connId, ...opts.socket, onReady: (transport, hello) => void attach(transport, hello) },
        );
      },
      onMessage(event) {
        if (typeof event.data !== "string") {
          socket?.close(CloseCode.BAD_FRAME, "binary frames not supported");
          return;
        }
        socket?.receive(event.data);
      },
      onClose() {
        socket?.socketClosed();
      },
    };
  });
}
