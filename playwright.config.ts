import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./test/e2e",
  timeout: 30_000,
  // The machine stands 16 cores, but the per-test cost is the two context
  // loads (the relay + the panes' boot), not the test logic — higher
  // parallelism loads the dev server and the panes hard enough for the
  // sync/presence polls to flake. Measured over the full suite: workers 2 =
  // 127s / 0 flakes, 4 = 83s / 0 flakes (two runs), 6 = 71s / 1 flake per
  // run, 8 = 67s / 4 flakes. Four stands the sweet spot: the flake rate
  // stays at the baseline's zero. A CI runner (fewer cores) lowers this via
  // the PLAYWRIGHT_WORKERS env (the local default stays four).
  workers: Number(process.env.PLAYWRIGHT_WORKERS ?? 4),
  retries: 0,
  use: {
    baseURL: "http://localhost:5173",
  },
  webServer: {
    command: "npm run dev -w apps/playground",
    url: "http://localhost:5173",
    // Reuse of an already-running :5173 is an explicit local opt-in
    // (PLAYWRIGHT_REUSE_SERVER=true) — the default stands the run's own
    // server. The dev server is strict-port, so an occupied :5173 fails the
    // start rather than the run silently testing a stale dist / another
    // service (the gate and CI never reuse).
    reuseExistingServer: process.env.PLAYWRIGHT_REUSE_SERVER === "true",
    timeout: 30_000,
  },
});
