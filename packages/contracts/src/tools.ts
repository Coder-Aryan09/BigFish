// BigFish MCP tool contracts (zod v4). The 12 browser tools are defined here.
import { z } from "zod";

export interface ToolContract {
  name: string;
  description: string;
  input: z.ZodObject;
  annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean };
}

export const TOOLS: ToolContract[] = [
  {
    name: "browser_ping",
    description: "Check that the BigFish extension is connected.",
    input: z.object({}),
    annotations: { readOnlyHint: true },
  },
];
