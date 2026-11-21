// The cell's press model's stand: the single press's selection (the
// outline's frame), the double press's edit session, the drag's region
// (the fill's stand), the Delete's clear (the ONE's commit), the
// keyboard's selection's navigation.
import { type Page, expect, test } from "@playwright/test";

import { SETTLE, editorContext, openPane } from "./helpers";

/**
 * The pane's default-bridge demo table (the playground seeds it per page at
 * module load — id `table-demo` (derived from the name), name "Demo",
 * 3 rows). Polls until the async seed settles and returns the first
 * table's ref. The id stands the name's slug derivation (deterministic),
 * so the `tableId` reference resolves on every page of the context's
 * storage.
 */
async function bridgeDemoTable(page: Page): Promise<{ id: string; name: string }> {
  let result: { id: string; name: string } | null = null;
  await expect
    .poll(async () => {
      result = await page.evaluate(async () => {
        if (window.__bridge === undefined) return null;
        const tables = await window.__bridge.listTables();
        // The seed creates the enum's system table before the Demo table
        // (it stands the catalog out), so the demo is found by name, not by
        // position.
        return tables.find((table) => table.name === "Demo") ?? null;
      });
      return result;
    }, SETTLE)
    .not.toBeNull();
  return result!;
}

/** The demo table's column ids by their schema names (the bridge's
 * schema read — the column ids stand the bridge's allocation, not the
 * spec's stand). */
async function demoColumns<K extends string>(
  page: Page,
  tableId: string,
  names: readonly K[]
): Promise<Record<K, string>> {
  const ids = await page.evaluate(
    async ({ tableId, names }) => {
      const { columns } = await window.__bridge!.describeTable(tableId);
      return names.map((name) => columns.find((column) => column.name === name)?.id ?? null);
    },
    { tableId, names }
  );
  const out = {} as Record<K, string>;
  names.forEach((name, index) => {
    const id = ids[index]!;
    if (id === null) throw new Error(`the demo table's "${name}" column stands absent`);
    out[name] = id;
  });
  return out;
}

test("the cell's press model: the single press selects, the double press edits, the drag stands the region, the Delete clears (the commit over the pane's bridge)", async ({
  browser,
}) => {
  const context = await editorContext(browser);
  const a = await context.newPage();
  try {
    await openPane(a, "a", "db-cellmodel-" + Math.random().toString(36).slice(2, 8));

    const demo = await bridgeDemoTable(a);
    await a.evaluate((tableId) => window.__paneDocs!.a!.insertBlock("database", { tableId }), demo.id);
    const gridA = a.locator("[data-slot='docblocks/database-grid']");
    await expect(gridA.first()).toBeVisible(SETTLE);
    const {
      Title: titleColId,
      Count: countColId,
      Done: doneColId,
    } = await demoColumns(a, demo.id, ["Title", "Count", "Done"]);

    const cell = (r: number, c: number) =>
      a.locator(`[data-slot='docblocks/database-cell'][data-row='${r}'][data-col='${c}']`);
    const region: ReadonlyArray<readonly [number, number]> = [
      [0, 0],
      [0, 1],
      [1, 0],
      [1, 1],
    ];

    // The single press stands the selection (the view state only: no edit
    // session, no doc wire).
    const outBefore = await a.locator("[data-testid='wire-a'] li", { hasText: " out " }).count();
    await cell(0, 0).click();
    await expect(cell(0, 0)).toHaveAttribute("data-selected", "true", SETTLE);
    expect(await cell(0, 0).getAttribute("data-editing")).toBe(null);
    expect(await a.locator("[data-testid='wire-a'] li", { hasText: " out " }).count()).toBe(outBefore);
    // The sole selection's stand: the canvas figure's outline (the thin
    // cyan frame over the tint), the inset offset (the negative — the
    // four sides stand over the edge cells: the outset frame over the
    // scroller's content edge stands clipped).
    const outlineStand = await cell(0, 0).evaluate((el) => {
      const cs = getComputedStyle(el);
      return { width: cs.outlineWidth, offset: cs.outlineOffset, style: cs.outlineStyle };
    });
    expect(outlineStand.width).toBe("1px");
    expect(outlineStand.offset).toBe("-1px");
    expect(outlineStand.style).toBe("solid");

    // The double press stands the edit (the floating 6-row editor over the
    // cell: the display drops, the portaled box stands over the rows
    // below); the Escape cancels the session (the draft reverts, no write).
    await cell(0, 0).dblclick();
    await expect(cell(0, 0)).toHaveAttribute("data-editing", "true", SETTLE);
    await expect(a.locator("[data-slot='docblocks/database-cell-multiline']")).toBeVisible(SETTLE);
    await a.keyboard.type(" draft");
    await a.keyboard.press("Escape");
    await expect(cell(0, 0)).toHaveText("First task", SETTLE);

    // The press-drag stands the rectangle (rows 0-1 × columns 0-1: the
    // title + the count of the first two rows).
    const startBox = (await cell(0, 0).boundingBox())!;
    const endBox = (await cell(1, 1).boundingBox())!;
    await a.mouse.move(startBox.x + 10, startBox.y + 10);
    await a.mouse.down();
    await a.mouse.move(endBox.x + 10, endBox.y + 10, { steps: 8 });
    await a.mouse.up();
    for (const [r, c] of region) {
      await expect(cell(r, c)).toHaveAttribute("data-selected", "true", SETTLE);
    }
    // The region's drag stands the cell selection, not the native text
    // selection (the table's select-none: the cell's text stands selected
    // by no drag).
    expect(await a.evaluate(() => window.getSelection()?.toString() ?? "")).toBe("");
    // The multi-selection's stand: the fill (the canvas selection's fill —
    // the border token at 50%), no outline (the sole selection's frame
    // stands dropped — cell(0, 0) was the single selection over the
    // region's start).
    const regionStand = await cell(0, 0).evaluate((el) => {
      const cs = getComputedStyle(el);
      // The token's resolved stand (the theme's cyan at 50%) via the probe
      // element inside the cell (the token is scoped to the editor root) —
      // the comparison stands the semantics, not the serialization.
      const probe = document.createElement("div");
      probe.style.background = "var(--docblocks-canvas-selection-fill)";
      el.appendChild(probe);
      const fill = getComputedStyle(probe).backgroundColor;
      probe.remove();
      // The no-outline's stand: the outline's style is the initial none
      // (the width stands the medium initial — the style discriminates).
      return { background: cs.backgroundColor, fill, outlineStyle: cs.outlineStyle };
    });
    expect(regionStand.background).toBe(regionStand.fill);
    expect(regionStand.outlineStyle).toBe("none");

    // The Delete clears the region (the batch's ONE commit — one
    // updateRows call, the cells stand null over the pane's bridge;
    // the doc stands).
    await a.keyboard.press("Delete");
    for (const [r, c] of region) {
      await expect(cell(r, c)).toHaveAttribute("data-empty", "true", SETTLE);
      await expect(cell(r, c)).toHaveText("", SETTLE);
    }
    const rowsA = await a.evaluate(async (tableId) => {
      const page = await window.__bridge!.snapshotTable(tableId, {});
      return page.page.rows.map((row) => row.cells);
    }, demo.id);
    // The clear's stand: the cells stand explicit null (the bridge's clear
    // writes null, not a key's drop).
    for (const cells of rowsA.slice(0, 2)) {
      expect(cells[titleColId]).toBeNull();
      expect(cells[countColId]).toBeNull();
    }
    expect(rowsA[2]![titleColId]).toBe("Third task"); // the region stands the first two rows only

    // The clear stands ONE commit: the grid's Undo stands the WHOLE clear
    // back (every cleared row) over the single press (the two-commits bug:
    // the undo used to stand one row per press).
    const undoBtn = a.locator("[data-slot='docblocks/database-undo']");
    await expect(undoBtn).toBeEnabled(SETTLE);
    await undoBtn.click();
    await expect(cell(0, 0)).toHaveText("First task", SETTLE);
    await expect(cell(1, 0)).toHaveText("Second task", SETTLE);
    const rowsA2 = await a.evaluate(async (tableId) => {
      const page = await window.__bridge!.snapshotTable(tableId, {});
      return page.page.rows.map((row) => row.cells);
    }, demo.id);
    expect(rowsA2[0]![titleColId]).toBe("First task");
    expect(rowsA2[0]![countColId]).toBe(1);
    expect(rowsA2[1]![titleColId]).toBe("Second task");
    expect(rowsA2[1]![countColId]).toBe(2);

    // The keyboard's selection stand (the press's clear stands the region's
    // press over it; the table's focus stands over the cell's press): the
    // arrow stands the selection's move over the data cells (the grid's
    // edge stands no move), the shift+arrow stands the region's extension
    // over the anchor (the region's fill stand stands, no per-cell outline),
    // and the region's slide stands the shape over the edge's clamp.
    await cell(0, 0).click();
    await expect(cell(0, 0)).toHaveAttribute("data-selected", "true", SETTLE);
    // The grid's top edge stands no move.
    await a.keyboard.press("ArrowUp");
    await expect(cell(0, 0)).toHaveAttribute("data-selected", "true");
    // The single cell's move: the arrow stands the next data cell.
    await a.keyboard.press("ArrowRight");
    await expect(cell(0, 1)).toHaveAttribute("data-selected", "true", SETTLE);
    await expect(cell(0, 0)).not.toHaveAttribute("data-selected", "true");
    // The shift+arrow's region (the anchor stands, the cursor moves): the
    // 2x1 over the column 1, then the 2x2 over the columns 0-1 (the fill
    // stand, no outline).
    await a.keyboard.press("Shift+ArrowDown");
    await expect(cell(1, 1)).toHaveAttribute("data-selected", "true", SETTLE);
    await expect(cell(1, 0)).not.toHaveAttribute("data-selected", "true");
    await a.keyboard.press("Shift+ArrowLeft");
    await expect(cell(0, 0)).toHaveAttribute("data-selected", "true", SETTLE);
    await expect(cell(1, 1)).toHaveAttribute("data-selected", "true");
    const kbRegion = await cell(1, 1).evaluate((el) => {
      const cs = getComputedStyle(el);
      const probe = document.createElement("div");
      probe.style.background = "var(--docblocks-canvas-selection-fill)";
      el.appendChild(probe);
      const fill = getComputedStyle(probe).backgroundColor;
      probe.remove();
      return { background: cs.backgroundColor, fill, outlineStyle: cs.outlineStyle };
    });
    expect(kbRegion.background).toBe(kbRegion.fill);
    expect(kbRegion.outlineStyle).toBe("none");
    // The region's slide (the shape stands): the 2x2 slides over the right
    // to the columns 2-3 (the grid's right edge stands the slide's clamp —
    // the following rights are the no-op stands, the region stands cols
    // 2-3, not the over-the-edge no-selection).
    await a.keyboard.press("ArrowRight");
    await expect(cell(1, 2)).toHaveAttribute("data-selected", "true", SETTLE);
    await a.keyboard.press("ArrowRight");
    await a.keyboard.press("ArrowRight");
    await a.keyboard.press("ArrowRight");
    await expect(cell(1, 3)).toHaveAttribute("data-selected", "true", SETTLE);
    await expect(cell(1, 2)).toHaveAttribute("data-selected", "true");
    await expect(cell(1, 1)).not.toHaveAttribute("data-selected", "true");

    // The boolean's double press stands the toggle (over the pane's bridge;
    // the pane's bridge read stands the committed value).
    const doneCell = cell(2, 2);
    await expect(doneCell.locator("[data-slot='docblocks/database-cell-checkbox']")).not.toHaveAttribute(
      "aria-checked",
      "true"
    );
    await doneCell.dblclick();
    await expect(doneCell.locator("[data-slot='docblocks/database-cell-checkbox']")).toHaveAttribute(
      "aria-checked",
      "true",
      SETTLE
    );
    const rowA = await a.evaluate(async (tableId) => {
      const page = await window.__bridge!.snapshotTable(tableId, {});
      return page.page.rows[page.page.rows.length - 1]?.cells ?? null;
    }, demo.id);
    expect(rowA?.[doneColId]).toBe(true);

    // The interactive stand: the sole selection's checkbox stands the pointer
    // cursor + the press over the checkbox stands the toggle (the selecting
    // press itself stands no toggle).
    const firstDone = cell(0, 2);
    await firstDone.click();
    const wrap = firstDone.locator("[data-slot='docblocks/database-cell-checkbox-wrap']");
    await expect(wrap).toHaveCSS("cursor", "pointer", SETTLE);
    await wrap.click();
    await expect(firstDone.locator("[data-slot='docblocks/database-cell-checkbox']")).toHaveAttribute(
      "aria-checked",
      "true",
      SETTLE
    );
    const rowA2 = await a.evaluate(async (tableId) => {
      const page = await window.__bridge!.snapshotTable(tableId, {});
      return page.page.rows[0]?.cells ?? null;
    }, demo.id);
    expect(rowA2?.[doneColId]).toBe(true);

    // The double press over the interactive stand stands exactly one toggle
    // (back) — and stands no native text selection (the bug's stand: the
    // neighbor cell's text over the old stand). The 600ms wait stands the
    // fresh gesture (the browser's click-detail window — the previous
    // toggle's click otherwise stands the burst's continuation).
    await a.waitForTimeout(600);
    await firstDone.dblclick();
    expect(await a.evaluate(() => window.getSelection()?.toString() ?? "")).toBe("");
    await expect(firstDone.locator("[data-slot='docblocks/database-cell-checkbox']")).not.toHaveAttribute(
      "aria-checked",
      "true",
      SETTLE
    );
    const rowA3 = await a.evaluate(async (tableId) => {
      const page = await window.__bridge!.snapshotTable(tableId, {});
      return page.page.rows[0]?.cells ?? null;
    }, demo.id);
    expect(rowA3?.[doneColId]).toBe(false);
  } finally {
    await context.close();
  }
});
