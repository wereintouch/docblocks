import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./test/e2e",
  timeout: 30_000,
  // The machine stands 16 cores, but the per-test cost is the two context
  // loads (the relay + the panes' boot), not the test logic — higher
  // parallelism loads the dev server and the panes hard enough for the
  // sync/presence polls to flake. Measured on the machine (2026-10-22,
  // full 280-test suite): workers 2 = 127s / 0 flakes, 4 = 83s / 0 flakes
  // (two runs), 6 = 71s / 1 flake per run, 8 = 67s / 4 flakes. Four stands
  // the sweet spot: the flake rate stays at the baseline's zero.
  workers: 4,
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
