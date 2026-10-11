import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./test/e2e",
  timeout: 30_000,
  // The suite is a few seconds even at low parallelism; higher parallelism
  // loads the relay + the panes hard enough for the sync/presence polls to
  // time out flakily.
  workers: 2,
  retries: 0,
  use: {
    baseURL: "http://localhost:5173",
  },
  webServer: {
    command: "npm run dev -w apps/playground",
    url: "http://localhost:5173",
    reuseExistingServer: true,
    timeout: 30_000,
  },
});
