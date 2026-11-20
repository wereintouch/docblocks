import { type Page } from "@playwright/test";

/** The in-process relay the dev server hosts (the playwright config's webServer; the strict port). */
const RELAY = "ws://localhost:5199";

/** The slow-machine settle window for the wire/log polls. */
const SETTLE: { timeout: number } = { timeout: 15_000 };

/** The pane's wire log's outbound-update count (the wire log's `] out` entries). */
async function outCount(page: Page, client: "a" | "b"): Promise<number> {
  const text = await page.getByTestId(`wire-${client}`).innerText();
  return text.match(/\] out \d+B/g)?.length ?? 0;
}

export { RELAY, SETTLE, outCount };
