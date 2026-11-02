// The link href's renderer gate over the real browser (the security
// stand: the remote input is not validated — a crafted Yjs update over the
// CRDT's raw escape hatch carries any href; the renderer stands the
// unsafe scheme as the plain text, never the raw <a>, and the document
// stays viewable). The write path's rejection (the C0-trim stand) and the
// lenient load's survival stand in the core / react-ui units; the browser
// pin is the execution side (an <a> over the javascript: scheme would be
// the script's execution surface).
import { type Page, expect, test } from "@playwright/test";

import { SETTLE, twoPanes } from "./helpers";

const UNSAFE_HREF = "javascript:alert(1)";

/** Type the fixture text into the seeded (empty) paragraph. */
async function typeText(page: Page, client: "a" | "b"): Promise<void> {
  const inner = page.locator(`[data-testid="doc-${client}"] [data-slot="docblocks/block-content"]`).first();
  await inner.click();
  await page.keyboard.type("hello world");
}

/** The pane's first block id + its text length (the seeded paragraph). */
async function firstTextBlock(page: Page, client: "a" | "b"): Promise<{ id: string; length: number }> {
  return page.evaluate((c) => {
    const doc = window.__paneDocs?.[c];
    if (doc === null || doc === undefined) throw new Error("the pane's doc is not mounted");
    const id = doc.getChildren(doc.toJSON().id)[0]!;
    return { id, length: doc.getText(id).length };
  }, client);
}

/** Format the block's first characters with the link mark over the raw Yjs
 *  (the remote input's stand: the validator is not in the apply path). */
async function injectUnsafeLink(page: Page, client: "a" | "b", length: number): Promise<void> {
  await page.evaluate(
    ([c, length, href]) => {
      const doc = window.__paneDocs?.[c];
      if (doc === null || doc === undefined) throw new Error("the pane's doc is not mounted");
      const yblocks = doc.raw.getMap("blocks");
      const id = doc.getChildren(doc.toJSON().id)[0]!;
      const yblock = yblocks.get(id) as { get: (key: string) => unknown };
      const ytext = yblock.get("content") as { format: (start: number, length: number, attrs: unknown) => void };
      ytext.format(0, length, { link: { href } });
    },
    [client, length, UNSAFE_HREF] as const
  );
}

test("the crafted unsafe link href stands the plain text (no <a>, the document stands viewable)", async ({ browser }) => {
  const { a, b, close } = await twoPanes(browser, "link-unsafe");
  try {
    await typeText(a, "a");
    const first = await firstTextBlock(a, "a");
    expect(first.length).toBeGreaterThan(0);
    // The crafted mark lands over the wire (the raw Yjs mutation on pane a
    // syncs to b as an ordinary remote update).
    await injectUnsafeLink(a, "a", first.length);

    // A: the renderer's gate — the run's text stands, the <a> stands none
    // (the unsafe scheme never renders the link's tag).
    await expect
      .poll(async () => a.locator('[data-testid="doc-a"] a').count(), SETTLE)
      .toBe(0);
    await expect(a.locator('[data-testid="doc-a"]').first()).toContainText("hello world");

    // B: the same stand over the wire (the remote input's stand — pane b
    // received the crafted mark as a plain sync frame).
    await expect.poll(async () => b.locator('[data-testid="doc-b"] a').count(), SETTLE).toBe(0);
    await expect(b.locator('[data-testid="doc-b"]').first()).toContainText("hello world");

    // The document stands viewable (the poisoned data renders, the editor
    // stands no crash): the pane's blocks stand.
    expect(await a.locator('[data-testid="doc-a"] [data-slot="docblocks/block"]').count()).toBeGreaterThan(0);
  } finally {
    await close();
  }
});
