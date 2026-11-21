import { type Page, expect, test } from "@playwright/test";

import {
  SETTLE,
  insertBlockType,
  pasteFromClipboard,
  readClipboardPayload,
  seedClipboardPayload,
  twoPanes,
} from "./helpers";

/** The inner contenteditables of the pane's text blocks, in order. */
function inners(page: Page, client: "a" | "b") {
  return page.locator(`[data-testid="doc-${client}"] [data-slot="docblocks/block-content"]`);
}

/** Press Shift+ArrowLeft n times, one by one (discrete presses coalesce otherwise). */
async function selectLeft(page: Page, n: number): Promise<void> {
  for (let i = 0; i < n; i++) await page.keyboard.press("Shift+ArrowLeft");
}

/**
 * Seed the page's paste payload with the rich content a default copy of the
 * block would carry (its innerHTML as text/html plus the plain text). The
 * copy side is simulated (the headless engine does not write the system
 * clipboard from a keyboard copy); the paste side is the real pipeline.
 */
async function copyBlockToClipboard(page: Page, client: "a" | "b"): Promise<void> {
  const payload = await page.evaluate((client) => {
    const inner = document.querySelector<HTMLElement>(
      `[data-testid="doc-${client}"] [data-slot="docblocks/block-content"]`
    );
    if (inner === null) throw new Error("the pane should have a block");
    return { html: `<html><body>${inner.innerHTML}</body></html>`, plain: inner.textContent ?? "" };
  }, client);
  await seedClipboardPayload(page, payload);
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
  // The two-pane sync settles over the wire (the SETTLE's deadline, not the
  // assertion's default).
  await expect.poll(async () => await inners(b, "b").first().textContent(), SETTLE).toBe("hello");
  await a.getByTestId("status-a").click();

  const firstB = inners(b, "b").first();
  await firstB.click();
  await b.keyboard.press("End");
  await selectLeft(b, 5);
  await b.keyboard.press("Control+b");
  await expect.poll(async () => await firstA.locator("strong").textContent(), SETTLE).toBe("hello");

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

test("a copy over a native table block stands the spreadsheet's grid (the html table + the TSV)", async ({
  browser,
}) => {
  const { a, close } = await twoPanes(browser, "ui04-table-copy", {
    permissions: ["clipboard-read", "clipboard-write"],
  });
  // The seed: a paragraph, a 2×2 table (its cells' texts), and the tail —
  // the drag / select-all range spans the table. The table's cells are
  // mini-docs, so a native copy across them would flatten the grid into a
  // column of lines; the editor's payload keeps the rows and the columns.
  const tableId = await a.evaluate(() => {
    const doc = window.__paneDocs?.a ?? null;
    if (doc === null) throw new Error("the pane's doc is not mounted");
    let tableId = "";
    doc.transact(() => {
      for (const child of doc.getChildren(doc.toJSON().id)) doc.removeBlock(child);
      const before = doc.insertBlock("paragraph");
      doc.insertText(before, 0, "before");
      tableId = doc.insertBlock("table", { cols: 2, columnWidths: [100, 100] });
      for (let row = 0; row < 2; row += 1) {
        const rowId = doc.insertBlock("table-row", undefined, { parent: tableId });
        for (let col = 0; col < 2; col += 1) {
          const cellId = doc.insertBlock("table-cell", undefined, { parent: rowId });
          const paragraph = doc.insertBlock("paragraph", undefined, { parent: cellId });
          doc.insertText(paragraph, 0, `r${row}c${col}`);
        }
      }
      const after = doc.insertBlock("paragraph");
      doc.insertText(after, 0, "after");
    });
    return tableId;
  });
  await expect(a.locator('table[data-slot="docblocks/table"]').first()).toBeVisible(SETTLE);
  await a
    .locator('[data-slot="docblocks/page"]')
    .first()
    .click({ position: { x: 4, y: 4 } });
  await a.keyboard.press("Control+a");
  await a.keyboard.press("Control+c");
  await expect
    .poll(async () => await readClipboardPayload(a), SETTLE)
    .toEqual({
      html: "<div>before</div><table><tbody><tr><td>r0c0</td><td>r0c1</td></tr><tr><td>r1c0</td><td>r1c1</td></tr></tbody></table><div>after</div>",
      plain: "before\nr0c0\tr0c1\nr1c0\tr1c1\nafter",
    });
  // The table block's own selection (the row's gutter press) copies the
  // whole grid — the block-level copy's stand.
  const tableRow = a.locator('[data-slot="docblocks/row"]', { has: a.locator(`[data-block-id="${tableId}"]`) }).first();
  await tableRow.hover();
  await tableRow.locator('[data-slot="docblocks/gutter"]').first().click();
  await a.keyboard.press("Control+c");
  await expect
    .poll(async () => await readClipboardPayload(a), SETTLE)
    .toEqual({
      html: "<table><tbody><tr><td>r0c0</td><td>r0c1</td></tr><tr><td>r1c0</td><td>r1c1</td></tr></tbody></table>",
      plain: "r0c0\tr0c1\nr1c0\tr1c1",
    });
  await close();
});
