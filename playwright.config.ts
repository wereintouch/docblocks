import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./test/e2e",
  // The dev server's module-graph warm-up before the first spec (the
  // cold-server's on-demand transform stands the parallel early loads
  // queue behind it — `test/e2e/global-setup.ts`).
  globalSetup: "./test/e2e/global-setup.ts",
  // The per-test budget stands the verified baseline (the 30 s over the
  // test's logic + the async waits): the 5 s convention stands the
  // unit's logic, but the e2e's two-pane sync legitimately settles over
  // the SETTLE (15 s, `test/e2e/helpers.ts`) — a 5 s budget stands the
  // suite red over the settle (the measure: 71 red of 436,
  // 68 of them the timeout class). The slow-test regression stands
  // visible over the 30 s instead (the stalled settle drifts into the
  // 30 s, the warm-up's globalSetup keeps the cold-server's transform
  // stalls out of the picture).
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
  // The browser matrix: chromium is the baseline (the visual's goldens and
  // the CI's e2e stand over it); firefox and webkit are the cross-engine
  // coverage (the webkit build stands the closest-to-Safari engine Playwright
  // can drive — the branded Safari is undrivable, Playwright relies on
  // patches the branded build rejects). A single-browser run selects its
  // project (the `test:e2e`'s default stands chromium, the CI's parity).
  projects: [
    { name: "chromium", use: { browserName: "chromium" } },
    { name: "firefox", use: { browserName: "firefox" } },
    { name: "webkit", use: { browserName: "webkit" } },
  ],
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
