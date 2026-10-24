// The extension side of MCP: one McpServer per socket, built fresh on every
// connect. Each contract tool runs through the existing executor.
import { McpServer } from "@modelcontextprotocol/server";
import { TOOLS } from "@bigfish/contracts";
import { EXT_VERSION } from "../config.js";
import { executor } from "../executor.js";

const INSTRUCTIONS =
  "BigFish exposes the user's real browser. Results are plain text. Act by ref, read the delta, re-snapshot only after navigation.";

export function buildMcpServer(): McpServer {
  const server = new McpServer({ name: "bigfish-extension", version: EXT_VERSION }, { instructions: INSTRUCTIONS });
  for (const tool of TOOLS) {
    server.registerTool(
      tool.name,
      { description: tool.description, inputSchema: tool.input, annotations: tool.annotations },
      async (args, ctx) => {
        const meta = ctx.mcpReq._meta as { runId?: string; progressToken?: string | number } | undefined;
        // Progress keeps the server's timeout from firing while the user decides on an approval.
        let step = 0;
        const progressToken = meta?.progressToken;
        const onProgress =
          progressToken === undefined
            ? undefined
            : (message: string) =>
                void ctx.mcpReq
                  .notify({ method: "notifications/progress", params: { progressToken, progress: ++step, message } })
                  .catch(() => {});
        const res = await executor.execute(tool.name, args, "mcp", { signal: ctx.mcpReq.signal, runId: meta?.runId, onProgress });
        return { content: [{ type: "text" as const, text: res.text }], isError: !res.ok };
      },
    );
  }
  return server;
}
