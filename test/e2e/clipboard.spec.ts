import { type Page, expect, test } from "@playwright/test";

import { SETTLE, insertBlockType, pasteFromClipboard, twoPanes } from "./helpers";

/** The inner contenteditables of the pane's text blocks, in order. */
function inners(page: Page, client: "a" | "b") {
  return page.locator(`[data-testid="doc-${client}"] [data-slot="docblocks/block-content"]`);
}

/** Press Shift+ArrowLeft n times, one by one (discrete presses coalesce otherwise). */
async function selectLeft(page: Page, n: number): Promise<void> {
  for (let i = 0; i < n; i++) await page.keyboard.press("Shift+ArrowLeft");
}

/**
 * Seed the clipboard with the rich content a default copy of the block
 * would carry (its innerHTML as text/html plus the plain text). Headless
 * Chromium does not write the system clipboard from a keyboard copy, so
 * the copy side is simulated; the paste side uses the real clipboard.
 */
async function copyBlockToClipboard(page: Page, client: "a" | "b"): Promise<void> {
  await page.evaluate(async (client) => {
    const inner = document.querySelector<HTMLElement>(
      `[data-testid="doc-${client}"] [data-slot="docblocks/block-content"]`
    );
    if (inner === null) throw new Error("the pane should have a block");
    await navigator.clipboard.write([
      new ClipboardItem({
        "text/html": new Blob([`<html><body>${inner.innerHTML}</body></html>`], { type: "text/html" }),
        "text/plain": new Blob([inner.textContent ?? ""], { type: "text/plain" }),
      }),
    ]);
  }, client);
}

/**
 * Paste the OS clipboard into the focused element: the real clipboard
 * payload is read back and dispatched as a paste event (headless Chromium
 * does not synthesize a paste event from Control+v).
 */

test("a rich paste carries the clipboard marks into both panes", async ({ browser }) => {
  const { a, b, close } = await twoPanes(browser, "ui04-clipboard", {
    permissions: ["clipboard-read", "clipboard-write"],
  });

  // The room starts with pane "a"'s single starter.
  await expect(inners(a, "a")).toHaveCount(1);
  const firstA = inners(a, "a").first();
  const firstId = (await firstA.getAttribute("data-block-id")) ?? "";
  expect(firstId).not.toBe("");

  // A types the word and blurs; B bolds the range, so the mark change
  // reaches A as a remote update while A's selection is outside — A's text
  // DOM re-syncs from the store and shows the <strong> (a mark-only change
  // does not rebuild while the selection is inside the block).
  await firstA.click();
  await a.keyboard.type("hello");
  await expect(inners(b, "b").first()).toHaveText("hello");
  await a.getByTestId("status-a").click();

  const firstB = inners(b, "b").first();
  await firstB.click();
  await b.keyboard.press("End");
  await selectLeft(b, 5);
  await b.keyboard.press("Control+b");
  await expect(firstA.locator("strong")).toHaveText("hello");

  // Copy the bold word to the clipboard (what a default copy would carry),
  // then paste it into a second (empty) block (inserted explicitly — the
  // room carries a single starter).
  await copyBlockToClipboard(a, "a");
  await insertBlockType(a, "a", "paragraph");
  await expect(inners(a, "a")).toHaveCount(2);
  const secondA = inners(a, "a").nth(1);
  await secondA.click();
  await pasteFromClipboard(a);

  // The runs arrive with the mark: one marked run only, no raw HTML nodes
  // or attribute soup in the DOM.
  await expect.poll(async () => await secondA.innerHTML(), SETTLE).toBe("<strong>hello</strong>");

  // The other pane converges to the same marked run.
  const secondB = inners(b, "b").nth(1);
  await expect.poll(async () => await secondB.innerHTML(), SETTLE).toBe("<strong>hello</strong>");
  await expect(secondB).toHaveText("hello");

  await close();
});
