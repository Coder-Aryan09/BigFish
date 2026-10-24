// BigFish bridge protocol between the extension and the server.
export type BridgeMessage =
  | { type: "hello"; token: string; ver: string }
  | { type: "call"; id: string; tool: string; args: unknown; client: string; runId?: string }
  | { type: "result"; id: string; ok: boolean; text: string; meta?: Record<string, unknown> }
  | { type: "abort"; id?: string; runId?: string }
  | { type: "ping" }
  | { type: "pong" };
