// Step 1 checks for the /mcp-ws pipe: extension = MCP server, server = MCP client.
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { z } from "zod";
import { Client } from "@modelcontextprotocol/client";
import { McpServer } from "@modelcontextprotocol/server";
import { CloseCode, ErrorCode, TOOLS, WIRE_VERSION, encodeCtl } from "@bigfish/contracts";
import { FramedTransport, SocketOpenError, openMcpSocket } from "@bigfish/mcp-ws";
import { startServer } from "../src/server.js";
import { SessionError } from "../src/mcp/session.js";
import { DEV_USER_ID } from "../src/ws/mcp-ws.js";
import { startFakeExtension, type FakeExtensionOptions } from "../scripts/fake-extension.js";

// Short timings so failure paths finish fast.
const TUNING = { helloTimeoutMs: 300, heartbeatIntervalMs: 100, heartbeatDeadlineMs: 500 };

let srv: Awaited<ReturnType<typeof startServer>>;
let wsUrl: string;
let httpUrl: string;

before(async () => {
  srv = await startServer({ port: 0, host: "127.0.0.1", devRoutes: true, socket: TUNING });
  httpUrl = `http://127.0.0.1:${srv.port}`;
  wsUrl = `ws://127.0.0.1:${srv.port}/mcp-ws`;
});

after(async () => {
  await srv.close();
});

function fake(opts: Omit<FakeExtensionOptions, "url"> = {}) {
  return startFakeExtension({
    url: wsUrl,
    heartbeatIntervalMs: TUNING.heartbeatIntervalMs,
    heartbeatDeadlineMs: TUNING.heartbeatDeadlineMs,
    ...opts,
  });
}

async function waitFor<T>(fn: () => T | undefined, timeoutMs = 2_000): Promise<T> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const value = fn();
    if (value !== undefined) return value;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error("waitFor timed out");
}

const session = (deviceId: string) => waitFor(() => srv.registry.get(DEV_USER_ID, deviceId));

function textOf(result: { content: unknown }): string {
  const blocks = result.content as Array<{ type: string; text?: string }>;
  return blocks.map((b) => b.text ?? "").join("");
}

// A raw socket for protocol-level tests. Resolves with the close code.
function rawSocket(onOpen: (ws: WebSocket) => void): Promise<number> {
  return new Promise((resolve) => {
    const ws = new WebSocket(wsUrl);
    ws.addEventListener("open", () => onOpen(ws));
    ws.addEventListener("close", (e) => resolve(e.code));
  });
}

describe("FramedTransport (in memory)", () => {
  test("McpServer and Client talk over two linked transports", async () => {
    const pair: { a?: FramedTransport; b?: FramedTransport } = {};
    const sink = (to: () => FramedTransport | undefined) => ({
      send: (text: string) => queueMicrotask(() => to()?.deliver(JSON.parse(text).m)),
      close: () => to()?.socketClosed(),
    });
    pair.a = new FramedTransport(sink(() => pair.b), "a");
    pair.b = new FramedTransport(sink(() => pair.a), "b");

    const server = new McpServer({ name: "mem", version: "0" });
    server.registerTool("echo", { description: "echo", inputSchema: z.object({ msg: z.string() }) }, async ({ msg }) => ({
      content: [{ type: "text", text: `echo ${msg}` }],
    }));
    await server.connect(pair.a);
    const client = new Client({ name: "mem-client", version: "0" });
    await client.connect(pair.b);

    const res = await client.callTool({ name: "echo", arguments: { msg: "hi" } });
    assert.equal(textOf(res), "echo hi");
    await client.close();
  });
});

describe("/mcp-ws", () => {
  test("browser_ping round trip through the registry", async () => {
    const ext = await fake();
    const s = await session(ext.deviceId);
    assert.deepEqual(
      s.tools.map((t) => t.name),
      TOOLS.map((t) => t.name),
    );

    const res = await s.callTool("browser_ping");
    assert.match(textOf(res), /pong/);

    const health = await (await fetch(`${httpUrl}/health`)).json();
    assert.ok(health.devices >= 1);
    const ping = await (await fetch(`${httpUrl}/api/dev/devices/${ext.deviceId}/ping`)).json();
    assert.equal(ping.ok, true);

    ext.close();
    await waitFor(() => (srv.registry.get(DEV_USER_ID, ext.deviceId) ? undefined : true));
  });

  test("tools outside the contract allowlist never reach the server side", async () => {
    const ext = await fake({
      extraTools: [{ name: "evil_tool", description: "not in contracts", input: z.object({}) }],
    });
    const s = await session(ext.deviceId);
    assert.equal(s.hasTool("evil_tool"), false);
    await assert.rejects(s.callTool("evil_tool"), (err: unknown) => {
      return err instanceof SessionError && err.code === ErrorCode.UNKNOWN_TOOL;
    });
    ext.close();
  });

  test("a second connection for the same device replaces the first with 4003", async () => {
    const first = await fake({ deviceId: "device-replace-1" });
    const firstSession = await session(first.deviceId);
    const second = await fake({ deviceId: "device-replace-1" });

    const closed = await first.socket.closed;
    assert.equal(closed.code, CloseCode.REPLACED);
    const current = await waitFor(() => {
      const s = srv.registry.get(DEV_USER_ID, "device-replace-1");
      return s && s !== firstSession ? s : undefined;
    });
    assert.equal(current.info.connId, second.socket.connId);
    second.close();
  });

  test("unsupported contracts version is refused with 4426", async () => {
    await assert.rejects(
      openMcpSocket({ url: wsUrl, deviceId: "device-old-1", ext: "0.0.1", contracts: 99 }),
      (err: unknown) => err instanceof SocketOpenError && err.code === CloseCode.UPGRADE_REQUIRED,
    );
  });

  test("an invalid frame closes the socket with 4002", async () => {
    const code = await rawSocket((ws) => ws.send("not json"));
    assert.equal(code, CloseCode.BAD_FRAME);
  });

  test("an MCP frame before hello closes the socket with 4002", async () => {
    const code = await rawSocket((ws) => ws.send(JSON.stringify({ v: WIRE_VERSION, k: "mcp", m: { jsonrpc: "2.0" } })));
    assert.equal(code, CloseCode.BAD_FRAME);
  });

  test("no hello in time closes the socket with 4004", async () => {
    const code = await rawSocket(() => {});
    assert.equal(code, CloseCode.HELLO_TIMEOUT);
  });

  test("a peer that stops sending heartbeats is dropped", async () => {
    const started = Date.now();
    const code = await rawSocket((ws) =>
      ws.send(encodeCtl({ t: "hello", deviceId: "device-silent-1", ext: "0", contracts: 1 })),
    );
    // The server terminates the TCP socket, so the client sees an abnormal close.
    assert.equal(code, 1006);
    assert.ok(Date.now() - started >= TUNING.heartbeatDeadlineMs);
  });

  test("tool calls on one device run one at a time, in order", async () => {
    const events: string[] = [];
    let calls = 0;
    const ext = await fake({
      handlers: {
        browser_ping: async () => {
          const id = ++calls === 1 ? "a" : "b";
          events.push(`start ${id}`);
          await new Promise((r) => setTimeout(r, 50));
          events.push(`end ${id}`);
          return `ok ${id}`;
        },
      },
    });
    const s = await session(ext.deviceId);
    await Promise.all([s.callTool("browser_ping"), s.callTool("browser_ping")]);
    assert.deepEqual(events, ["start a", "end a", "start b", "end b"]);
    ext.close();
  });

  test("aborting a call cancels it on the extension side", async () => {
    let aborted = false;
    const ext = await fake({
      handlers: {
        browser_ping: (_args, extra) =>
          new Promise((resolve) => {
            extra.signal.addEventListener("abort", () => {
              aborted = true;
              resolve("cancelled");
            });
          }),
      },
    });
    const s = await session(ext.deviceId);
    const controller = new AbortController();
    const call = s.callTool("browser_ping", {}, { signal: controller.signal });
    setTimeout(() => controller.abort(), 50);
    await assert.rejects(call);
    await waitFor(() => (aborted ? true : undefined));
    ext.close();
  });

  test("a disconnect mid-call fails the call fast instead of waiting for the timeout", async () => {
    const ext = await fake({ handlers: { browser_ping: () => new Promise(() => {}) } });
    const s = await session(ext.deviceId);
    const started = Date.now();
    const call = s.callTool("browser_ping", {}, { timeoutMs: 30_000 });
    setTimeout(() => ext.close(), 50);
    await assert.rejects(call);
    assert.ok(Date.now() - started < 2_000);
    assert.equal(s.state, "closed");
  });
});
