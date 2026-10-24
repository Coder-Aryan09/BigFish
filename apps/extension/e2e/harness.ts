// E2E harness: fixture web server, Chromium with the extension, a BigFish
// server process, and a signed-in extension connection (dev login, no Google).
import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import { chromium, type BrowserContext, type Page, type Worker } from "@playwright/test";

export const E2E_SERVER_PORT = 8799;

const EXTENSION_DIR = fileURLToPath(new URL("../dist/chrome-mv3-e2e", import.meta.url));
const SERVER_DIR = fileURLToPath(new URL("../../server", import.meta.url));
const FIXTURES_DIR = fileURLToPath(new URL("../../server/fixtures/", import.meta.url));

export interface Harness {
  context: BrowserContext;
  page: Page;
  panel: Page;
  extensionId: string;
  serverUrl: string;
  fixtureUrl: (name: string) => string;
  callTool: (name: string, args?: Record<string, unknown>) => Promise<{ ok: boolean; text: string }>;
  close: () => Promise<void>;
}

export async function startHarness(): Promise<Harness> {
  const fixtures = await startFixtureServer();
  const context = await chromium.launchPersistentContext("", {
    channel: "chromium",
    headless: true,
    args: [`--disable-extensions-except=${EXTENSION_DIR}`, `--load-extension=${EXTENSION_DIR}`],
  });
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker"));
  if (process.env.E2E_DEBUG) worker.on("console", (m) => console.log(`[sw] ${m.text()}`));
  const extensionId = new URL(worker.url()).host;

  const serverUrl = `http://127.0.0.1:${E2E_SERVER_PORT}`;
  const server = await startBigFishServer(extensionId);

  try {
    // Dev login instead of Google: put the JWT where the extension keeps it.
    const login = (await (await fetch(`${serverUrl}/api/dev/login`, { method: "POST" })).json()) as { token: string; expiresAt: number };
    await worker.evaluate(async (auth) => {
      await (globalThis as any).chrome.storage.session.set({ "bigfish.auth": auth });
    }, { token: login.token, expiresAt: login.expiresAt, email: "dev@localhost" });

    // Opening the side panel page makes the worker connect.
    const panel = await context.newPage();
    await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
    const deviceId = await waitForDevice(serverUrl);

    const page = context.pages()[0] ?? (await context.newPage());
    await page.goto(fixtures.url("heading.html"));
    await page.bringToFront();

    const callTool = async (name: string, args: Record<string, unknown> = {}) => {
      const res = await fetch(`${serverUrl}/api/dev/devices/${deviceId}/tools/${name}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(args),
      });
      const body = (await res.json()) as { ok: boolean; content?: { text?: string }[]; message?: string };
      return { ok: body.ok, text: body.content?.map((c) => c.text ?? "").join("\n") ?? body.message ?? "" };
    };

    return {
      context,
      page,
      panel,
      extensionId,
      serverUrl,
      fixtureUrl: fixtures.url,
      callTool,
      close: async () => {
        await context.close();
        server.kill();
        fixtures.server.close();
      },
    };
  } catch (err) {
    await context.close();
    server.kill();
    fixtures.server.close();
    throw err;
  }
}

async function startFixtureServer(): Promise<{ server: Server; url: (name: string) => string }> {
  const server = createServer(async (req, res) => {
    const name = (req.url ?? "/").split("?")[0]!.replace(/^\/+/, "");
    if (!/^[\w-]+\.html$/.test(name)) {
      res.writeHead(404).end();
      return;
    }
    try {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(await readFile(FIXTURES_DIR + name));
    } catch {
      res.writeHead(404).end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return { server, url: (name) => `http://127.0.0.1:${port}/${name}` };
}

async function startBigFishServer(extensionId: string): Promise<ChildProcess> {
  const child = spawn(`${SERVER_DIR}/node_modules/.bin/tsx`, ["src/index.ts"], {
    cwd: SERVER_DIR,
    env: {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      PORT: String(E2E_SERVER_PORT),
      HOST: "127.0.0.1",
      JWT_SECRET: randomBytes(32).toString("hex"),
      EXTENSION_ID: extensionId,
      GOOGLE_EXTENSION_CLIENT_ID: "e2e-unused.apps.googleusercontent.com",
      ENABLE_DEV_ROUTES: "1",
    },
    stdio: ["ignore", "inherit", "inherit"],
  });
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`BigFish server exited with ${child.exitCode}`);
    const ok = await fetch(`http://127.0.0.1:${E2E_SERVER_PORT}/health`).then((r) => r.ok, () => false);
    if (ok) return child;
    await new Promise((r) => setTimeout(r, 200));
  }
  child.kill();
  throw new Error("BigFish server did not start");
}

async function waitForDevice(serverUrl: string): Promise<string> {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const devices = (await (await fetch(`${serverUrl}/api/dev/devices`)).json()) as { deviceId: string }[];
    if (devices[0]) return devices[0].deviceId;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error("The extension did not connect to the server");
}

export type { Worker };
