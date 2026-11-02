// The suite's warm-up: the dev server transforms the playground's module
// graph on demand (the app's deps, the mermaid subpath's import, the
// highlight.js grammars). The first page load pays the whole graph; under
// the parallel workers the early specs' page loads queue behind the
// transforms and burn their settle budgets (the cold-server 504 class —
// the late-discovered dynamic deps). A single real page load over the
// catalog (the heaviest doc: every block type, the mermaid render, the
// relay's room) warms the server-side transform cache before the first
// spec runs. The webServer stands up before the globalSetup, so the port
// is live when this runs (the run's own server — the reuse opt-in keeps
// this warm-up valid for a running server too, it just warms what is not
// warm yet).
import { type FullConfig, chromium } from "@playwright/test";

const RELAY = "ws://localhost:5199";

export default async function globalSetup(config: FullConfig): Promise<void> {
  const baseURL = (config.projects?.[0]?.use?.baseURL as string | undefined) ?? "http://localhost:5173";
  const browser = await chromium.launch();
  try {
    const page = await (await browser.newContext()).newPage();
    await page.goto(`${baseURL}/?client=a&catalog=1&syncUrl=${RELAY}/warmup`, { timeout: 60_000 });
    // The pane's relay connect (the ws room's bootstrap + the full-state
    // exchange stand executed once).
    await page.waitForFunction(
      () => document.querySelector('[data-testid="status-a"]')?.textContent === "connected",
      undefined,
      { timeout: 30_000 }
    );
    // The catalog doc rendered (the app's module graph — the panes, the
    // block renderers, the dynamic deps' chunks — stands transformed and
    // cached server-side; the later specs' page loads read the cache).
    await page.waitForSelector('[data-block-type="paragraph"]', { timeout: 30_000 });
    await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => undefined);
    // The rest of the graph (the non-critical transforms) settles behind
    // the first paint.
    await page.waitForTimeout(2_000);
  } finally {
    await browser.close();
  }
}
