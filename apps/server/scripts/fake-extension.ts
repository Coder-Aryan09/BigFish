// Fake BigFish extension. Speaks the same /mcp-ws protocol as the real one
// (dial out, hello, then act as the MCP server) without Chrome.
// Used by tests, and by hand: `pnpm --filter @bigfish/server fake-ext [deviceId]`.
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { McpServer } from "@modelcontextprotocol/server";
import { TOOLS, type ToolContract } from "@bigfish/contracts";
import { openMcpSocket, type OpenMcpSocketOptions } from "@bigfish/mcp-ws";

export type FakeHandler = (
  args: Record<string, unknown>,
  extra: { signal: AbortSignal },
) => Promise<string | { text: string; isError?: boolean }> | string | { text: string; isError?: boolean };

export interface FakeExtensionOptions
  extends Partial<Pick<OpenMcpSocketOptions, "contracts" | "heartbeatIntervalMs" | "heartbeatDeadlineMs">> {
  url: string;
  deviceId?: string;
  ext?: string;
  // Extra tools on top of the contract TOOLS (e.g. to test the server allowlist).
  extraTools?: ToolContract[];
  handlers?: Record<string, FakeHandler>;
}

const FAKE_EXT_VERSION = "0.0.0-fake";

export async function startFakeExtension(opts: FakeExtensionOptions) {
  const deviceId = opts.deviceId ?? `fake-${randomUUID()}`;
  const ext = opts.ext ?? FAKE_EXT_VERSION;
  const socket = await openMcpSocket({
    url: opts.url,
    deviceId,
    ext,
    contracts: opts.contracts,
    heartbeatIntervalMs: opts.heartbeatIntervalMs,
    heartbeatDeadlineMs: opts.heartbeatDeadlineMs,
  });

  const server = new McpServer({ name: "bigfish-fake-extension", version: ext });
  for (const tool of [...TOOLS, ...(opts.extraTools ?? [])]) {
    server.registerTool(
      tool.name,
      { description: tool.description, inputSchema: tool.input, annotations: tool.annotations },
      async (args, ctx) => {
        const handler = opts.handlers?.[tool.name] ?? defaultHandler(tool.name, ext);
        const out = await handler(args as Record<string, unknown>, { signal: ctx.mcpReq.signal });
        const { text, isError } = typeof out === "string" ? { text: out, isError: false } : out;
        return { content: [{ type: "text" as const, text }], isError };
      },
    );
  }
  await server.connect(socket.transport);

  return { deviceId, socket, server, close: () => socket.close() };
}

function defaultHandler(name: string, ext: string): FakeHandler {
  if (name === "browser_ping") return () => `ok pong | ext ${ext} | fake`;
  return () => ({ text: `ERROR UNKNOWN_TOOL: ${name} is not implemented in the fake extension.`, isError: true });
}

// CLI: connect once and stay connected until the socket closes.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const url = process.env.BIGFISH_WS_URL ?? "ws://127.0.0.1:8787/mcp-ws";
  const fake = await startFakeExtension({ url, deviceId: process.argv[2] });
  console.log(`[fake-ext] connected as ${fake.deviceId} (conn ${fake.socket.connId}) to ${url}`);
  const closed = await fake.socket.closed;
  console.log(`[fake-ext] closed: ${closed.code} ${closed.reason}`);
  process.exit(0);
}
