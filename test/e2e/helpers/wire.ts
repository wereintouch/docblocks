import { type Page } from "@playwright/test";

/** The in-process relay the dev server hosts (the playwright config's webServer; the strict port). The port follows DOCBLOCKS_RELAY_PORT per shard. */
const RELAY = `ws://localhost:${process.env.DOCBLOCKS_RELAY_PORT ?? "5199"}`;

/** The slow-machine settle window for the wire/log polls. */
const SETTLE: { timeout: number } = { timeout: 15_000 };

/** The negative invariant's window: the sample interval and the window's
 *  length. A fixed sleep samples the state once — a late commit lands after
 *  it and the check stands a false green; the window re-checks the
 *  invariant over its whole span. */
const NO_CHANGE_WINDOW_MS = 1_500;
const NO_CHANGE_INTERVAL_MS = 150;

/** The pane's wire log's outbound-update count (the wire log's `] out` entries). */
async function outCount(page: Page, client: "a" | "b"): Promise<number> {
  const text = await page.getByTestId(`wire-${client}`).innerText();
  return text.match(/\] out \d+B/g)?.length ?? 0;
}

/**
 * Holds a negative invariant over the window: `check` runs at every sample
 * (0 / 150 / … / 1500 ms) and its assertion stands the whole span.
 */
async function expectStays(check: () => Promise<void>, windowMs = NO_CHANGE_WINDOW_MS): Promise<void> {
  const deadline = Date.now() + windowMs;
  for (;;) {
    await check();
    if (Date.now() >= deadline) return;
    await new Promise((resolve) => setTimeout(resolve, NO_CHANGE_INTERVAL_MS));
  }
}

export { RELAY, SETTLE, expectStays, outCount };
