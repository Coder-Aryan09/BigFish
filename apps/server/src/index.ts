// BigFish server entrypoint.
import { mistralConfigFromEnv, mistralModels } from "./agent/models.js";
import { authConfigFromEnv } from "./auth/config.js";
import { startServer } from "./server.js";

const PORT = Number(process.env.PORT ?? 8787);
const HOST = process.env.HOST ?? "127.0.0.1";
const DEV = process.env.ENABLE_DEV_ROUTES === "1";
const mistral = mistralConfigFromEnv(process.env);
if (!mistral) console.warn("[BigFish] MISTRAL_API_KEY is not set. /api/agent/invoke answers 503.");

const { port, close } = await startServer({
  port: PORT,
  host: HOST,
  devRoutes: DEV,
  auth: authConfigFromEnv(process.env, { dev: DEV }),
  agent: { models: mistral && mistralModels(mistral) },
});
console.log(`[BigFish] server on http://${HOST}:${port} (extensions dial ws://${HOST}:${port}/mcp-ws)`);
if (mistral) console.log(`[BigFish] agent model ${mistral.model}, judge ${mistral.judgeModel}`);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    console.log(`[BigFish] ${signal}, closing`);
    void close().then(() => process.exit(0));
  });
}
