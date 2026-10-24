// BigFish MCP endpoint. Registers every tool from @bigfish/contracts.
import { McpServer, createMcpHandler } from "@modelcontextprotocol/server";
import { TOOLS } from "@bigfish/contracts";
import { bridge } from "./bridge.js";

const INSTRUCTIONS =
  "BigFish exposes the user's real browser. Results are plain text. Act by ref, read the delta, re-snapshot only after navigation.";

function buildServer() {
  const server = new McpServer({ name: "bigfish", version: "0.1.0" }, { instructions: INSTRUCTIONS });
  for (const tool of TOOLS) {
    server.registerTool(
      tool.name,
      { description: tool.description, inputSchema: tool.input, annotations: tool.annotations },
      async (args) => {
        const res = await bridge.call(tool.name, args, { client: "mcp" });
        return { content: [{ type: "text", text: res.text }], isError: !res.ok };
      },
    );
  }
  return server;
}

export const mcpHandler = createMcpHandler(buildServer);
