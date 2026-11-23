// The document mode's read-only content rendering: the empty text chains
// collapse (the data stands untouched — the edit's mode restores the full
// rows) and the cell's long word wraps over the view's mode (the class's own
// overflow-wrap, not the UA's editing default).
import { type Browser, type Page, expect, test } from "@playwright/test";

import { SETTLE, editorContext, openPane } from "./helpers";

interface PaneJson {
  meta: { title: string; avatar: string | null };
  blocks: Record<string, { type: string; content?: { text: string; marks: Record<string, unknown> }[] }>;
}

/** The pane's live doc's JSON (the __paneDocs' harness stand). */
async function paneDocJson(page: Page, client: "a" | "b"): Promise<PaneJson> {
  return (await page.evaluate((c) => {
    const docs = window.__paneDocs;
    const doc = (c === "a" ? docs?.a : docs?.b) ?? null;
    if (doc === null) throw new Error("the pane's doc is not mounted");
    return doc.toJSON();
  }, client)) as unknown as PaneJson;
}

/** The mode switcher's option (the DocHeader's segment's button). */
const modeOption = (page: Page, label: string) =>
  page.locator(`[data-slot="docblocks/doc-header-mode"] button[aria-label="${label}"]`);

/** The pane's page rows (the flat page's row stand). */
const pageRows = (page: Page, client: "a" | "b") =>
  page.locator(`[data-testid="doc-${client}"] [data-slot="docblocks/row"]`);

/** Switch the pane's mode to the view's mode and pin the read-only's stand. */
async function toViewMode(page: Page): Promise<void> {
  await modeOption(page, "View mode").click();
  await expect(page.locator('[data-slot="docblocks/editor"]').first()).toHaveAttribute("data-readonly", "true");
}

test("the empty text chains collapse over the view's modes (the edit's mode stands the full stand)", async ({
  browser,
}: {
  browser: Browser;
}) => {
  const context = await editorContext(browser);
  const page = await context.newPage();
  await openPane(page, "a", "vm-collapse");
  try {
    // The seed: the starter's empty paragraph + the three empties + the
    // tail's text's paragraph (the one non-empty over the flat page).
    await page.evaluate(() => {
      const doc = window.__paneDocs?.a ?? null;
      if (doc === null) throw new Error("the pane's doc is not mounted");
      doc.insertBlock("paragraph");
      doc.insertBlock("paragraph");
      doc.insertBlock("paragraph");
      const id = doc.insertBlock("paragraph");
      doc.insertText(id, 0, "tail");
    });
    // The edit's mode: the full's rows' stand (the count stands over the
    // JSON's blocks' stand — the starter's parity is independent: the
    // pane's seeder's stand may stand the one's more empty's paragraph).
    const editJson = await paneDocJson(page, "a");
    const paragraphs = Object.values(editJson.blocks).filter((block) => block.type === "paragraph").length;
    expect(paragraphs).toBeGreaterThanOrEqual(4); // the three empties + the tail's text's paragraph
    await expect(pageRows(page, "a")).toHaveCount(paragraphs, SETTLE);
    await toViewMode(page);
    // The view's mode: the chain's collapse (the empties' chain stands the
    // one's row + the tail — the two rows).
    await expect(pageRows(page, "a")).toHaveCount(2, SETTLE);
    // The data stands untouched (the collapse is the render's stand, the
    // doc's blocks stand the paragraphs' stand).
    const json = await paneDocJson(page, "a");
    expect(Object.values(json.blocks).filter((block) => block.type === "paragraph").length).toBe(paragraphs);
    // The switch back: the full stand returns (the data was never the
    // collapsed's stand).
    await modeOption(page, "Edit mode").click();
    await expect(pageRows(page, "a")).toHaveCount(paragraphs, SETTLE);
  } finally {
    await context.close();
  }
});

test("the cell's long word wraps over the view's mode (the editable's wrap's parity)", async ({
  browser,
}: {
  browser: Browser;
}) => {
  const context = await editorContext(browser);
  const page = await context.newPage();
  await openPane(page, "a", "vm-table-wrap");
  try {
    // The seed: a two-column table with a fixed column width; the first
    // cell carries a word wider than the cell's content box (the fixed
    // layout keeps the columns at the width — the word must break inside
    // the cell, not spill onto the neighbor).
    const longWord = "Supercalifragilisticexpialidociouslongword";
    await page.evaluate((word) => {
      const doc = window.__paneDocs?.a ?? null;
      if (doc === null) throw new Error("the pane's doc is not mounted");
      doc.transact(() => {
        for (const child of doc.getChildren(doc.toJSON().id)) doc.removeBlock(child);
        const tableId = doc.insertBlock("table", { cols: 2, columnWidths: [120, 120] });
        const rowId = doc.insertBlock("table-row", undefined, { parent: tableId });
        for (let col = 0; col < 2; col += 1) {
          const cellId = doc.insertBlock("table-cell", undefined, { parent: rowId });
          const paragraph = doc.insertBlock("paragraph", undefined, { parent: cellId });
          doc.insertText(paragraph, 0, col === 0 ? word : "neighbor");
        }
      });
    }, longWord);
    const cellInners = page.locator('td[data-slot="docblocks/table-cell"] [data-slot="docblocks/block-content"]');
    await expect(cellInners.first()).toBeVisible(SETTLE);

    /** The first cell's overflow + the neighbor's overlap (the measurement's stand). */
    const measure = async () =>
      page.evaluate(() => {
        const inners = Array.from(
          document.querySelectorAll<HTMLElement>(
            'td[data-slot="docblocks/table-cell"] [data-slot="docblocks/block-content"]'
          )
        );
        const first = inners[0];
        const second = inners[1];
        if (first === undefined || second === undefined) return null;
        return {
          overflowWrap: getComputedStyle(first).overflowWrap,
          overflow: first.scrollWidth - first.clientWidth,
          // The neighbor's box vs the first cell's right edge (the spill's
          // stand: a word over the neighbor's box crosses into it).
          gap: second.getBoundingClientRect().left - first.getBoundingClientRect().right,
        };
      });
    // The edit's mode: the word breaks inside the cell (the browser's
    // editing default over the shared editable).
    await expect.poll(measure, { timeout: SETTLE.timeout }).toEqual({
      overflowWrap: "break-word",
      overflow: 0,
      gap: expect.any(Number),
    });
    const editStand = await measure();
    expect(editStand?.gap ?? 0, "the edit's mode's no-spill's stand").toBeGreaterThanOrEqual(0);

    await toViewMode(page);
    // The view's mode: the same wrap — the word breaks inside the cell (the
    // class's own overflow-wrap, not the UA's editing default) and the
    // neighbor's box stands clear of the cell's text.
    await expect.poll(measure, { timeout: SETTLE.timeout }).toEqual({
      overflowWrap: "break-word",
      overflow: 0,
      gap: expect.any(Number),
    });
    const viewStand = await measure();
    expect(viewStand?.gap ?? 0, "the view's mode's no-spill's stand").toBeGreaterThanOrEqual(0);
    // The word stands wrapped (multiple lines), not clipped into one
    // overflowing line.
    expect((await cellInners.first().boundingBox())?.width ?? 0).toBeLessThanOrEqual(120);
  } finally {
    await context.close();
  }
});
