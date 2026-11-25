import { defineConfig } from "@playwright/test";

// The dev server's port (the base URL's host): overridable per shard via
// DOCBLOCKS_PORT (the parallel dev servers' stand); the default keeps the
// single-server runs at :5173.
const PORT = process.env.DOCBLOCKS_PORT ?? "5173";
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./test/e2e",
  // The dev server's module-graph warm-up before the first spec (the
  // cold-server's on-demand transform stands the parallel early loads
  // queue behind it — `test/e2e/global-setup.ts`).
  globalSetup: "./test/e2e/global-setup.ts",
  // The per-test budget stands the verified baseline (the 30 s over the
  // test's logic + the async waits): the 5 s convention stands the
  // unit's logic, but the e2e's two-pane sync legitimately settles over
  // the SETTLE (15 s, `test/e2e/helpers/`) — a 5 s budget stands the
  // suite red over the settle (the measure: 71 red of 436,
  // 68 of them the timeout class). The slow-test regression stands
  // visible over the 30 s instead (the stalled settle drifts into the
  // 30 s, the warm-up's globalSetup keeps the cold-server's transform
  // stalls out of the picture). The two-pane's settle specs stand a
  // raised 45 s budget over the file's `test.setTimeout` (the loaded
  // machine's flake zone — the 15 s SETTLE's panes + the page loads
  // stand the 30 s at its edge).
  timeout: 30_000,
  // The per-test cost is the two context loads (the relay + the panes'
  // boot), not the test logic — higher parallelism loads the single
  // vite+relay dev server and the panes hard enough for the
  // sync/presence polls to flake. Measured over the full suite: workers
  // 2 = 127s / 0 flakes, 4 = 83s / 0 flakes (two runs), 6 = 71s / 1
  // flake per run, 8 = 67s / 4 flakes (the 16-core machine); the
  // 32-core re-measure stands the four's default (workers 6 over the
  // loaded shared box = 36 flakes of the SETTLE class over the 12
  // parallel pages). A CI runner (fewer cores) lowers this via the
  // PLAYWRIGHT_WORKERS env (the local default stays four).
  workers: Number(process.env.PLAYWRIGHT_WORKERS ?? 4),
  // The flake's one-shot stand over the loaded machine: the local Makefile
  // e2e targets export PLAYWRIGHT_RETRIES=1, and a load-induced timeout
  // redoes the test once over the same worker (a real failure fails twice
  // and stays red). The CI's e2e step passes --retries=1 over the CLI (the
  // runner's 2 vCPU's load class). The npm scripts' default stands zero.
  retries: Number(process.env.PLAYWRIGHT_RETRIES ?? 0),
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
    baseURL: BASE_URL,
  },
  webServer: {
    command: "npm run dev -w apps/playground",
    url: BASE_URL,
    // Reuse of an already-running :5173 is an explicit local opt-in
    // (PLAYWRIGHT_REUSE_SERVER=true) — the default stands the run's own
    // server. The dev server is strict-port, so an occupied :5173 fails the
    // start rather than the run silently testing a stale dist / another
    // service (the gate and CI never reuse).
    reuseExistingServer: process.env.PLAYWRIGHT_REUSE_SERVER === "true",
    timeout: 30_000,
  },
});
