import { defineConfig } from "@playwright/test";

/** End-to-end checks run against the static demo build, the same thing Vercel serves. */
export default defineConfig({
  testDir: "e2e",
  timeout: 60_000,
  use: { baseURL: "http://localhost:4323" },
  webServer: { command: "npx vite preview --port 4323 --strictPort", cwd: "apps/web", url: "http://localhost:4323", reuseExistingServer: !process.env.CI },
});
