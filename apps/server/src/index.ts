// BigFish server entrypoint.
import { authConfigFromEnv } from "./auth/config.js";
import { startServer } from "./server.js";

const PORT = Number(process.env.PORT ?? 8787);
const HOST = process.env.HOST ?? "127.0.0.1";
const DEV = process.env.ENABLE_DEV_ROUTES === "1";

const { port, close } = await startServer({
  port: PORT,
  host: HOST,
  devRoutes: DEV,
  auth: authConfigFromEnv(process.env, { dev: DEV }),
});
console.log(`[BigFish] server on http://${HOST}:${port} (extensions dial ws://${HOST}:${port}/mcp-ws)`);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    console.log(`[BigFish] ${signal}, closing`);
    void close().then(() => process.exit(0));
  });
}
