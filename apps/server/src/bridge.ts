// BigFish bridge: WS link to the extension. Stub until the extension dials in.
import { ErrorCode, toolError } from "@bigfish/contracts";

export interface CallResult {
  ok: boolean;
  text: string;
  meta?: Record<string, unknown>;
}

export const bridge = {
  isConnected(): boolean {
    return false;
  },
  async call(tool: string, _args: unknown, _opts: { client: string; runId?: string; timeoutMs?: number }): Promise<CallResult> {
    return { ok: false, text: toolError(ErrorCode.NOT_CONNECTED, `Extension not connected, cannot run ${tool}.`, "Open Chrome with BigFish loaded.") };
  },
};
