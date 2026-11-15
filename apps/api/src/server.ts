import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { buildApp } from "./app";

const port = Number(process.env.PORT ?? 8080);
const host = process.env.HOST ?? "0.0.0.0";
const webDir = resolve(process.cwd(), "apps/web/dist");
const app = await buildApp({ logger: true, webDir: existsSync(webDir) ? webDir : undefined });
await app.listen({ port, host });

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, async () => {
    await app.close();
    process.exit(0);
  });
}
