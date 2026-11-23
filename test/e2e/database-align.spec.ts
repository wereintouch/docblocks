// The cell's value's column type's align's stand (the number's right,
// the boolean's center, the text's left) + the header's name's
// off-the-icon's stand (the value's edge's stand stands none).
import { type Browser, type Page, expect, test } from "@playwright/test";

import { SETTLE, editorContext, openPane } from "./helpers";

/**
 * Two panes in ONE browser context (the same origin): the persistent
 * bridges share the localStorage snapshot, so both panes' bridges stand
 * the same seeded tables over the deterministic ids. The existing
 * `twoPanes` helper uses separate contexts (isolated origins). A pane's
 * grid reads its own bridge only — the cross-bridge live event stand is
 * none, so a spec's cross-pane bridge assertions stand the pane's own
 * bridge only.
 */
async function twoPanesSharedContext(
  browser: Browser,
  room: string
): Promise<{ a: Page; b: Page; close: () => Promise<void> }> {
  const context = await editorContext(browser);
  const uniqueRoom = `${room}-${Math.random().toString(36).slice(2, 8)}`;
  const a = await context.newPage();
  const b = await context.newPage();
  await openPane(a, "a", uniqueRoom);
  await openPane(b, "b", uniqueRoom);
  return {
    a,
    b,
    close: async () => {
      await context.close();
    },
  };
}

test("the cell's value stands the column type's align (the number's right; the boolean's center; the header's name stands off the icon; the text's left regression)", async ({
  browser,
}) => {
  const { a, b, close } = await twoPanesSharedContext(browser, "db-align-stand");
  try {
    const { tableId, bodyColId, numColId, boolColId } = await a.evaluate(async () => {
      const bridge = window.__bridge!;
      const ctx = () => ({ operationId: crypto.randomUUID(), issuedAt: new Date().toISOString() });
      const table = await bridge.createTable({ name: "AlignCell" }, ctx());
      const id = table.result.id;
      const bodyCol = await bridge.createColumn(
        id,
        { column: { name: "Body", type: "text", position: 0, nullable: true } },
        ctx()
      );
      const numCol = await bridge.createColumn(
        id,
        { column: { name: "Num", type: "integer", position: 1, nullable: true } },
        ctx()
      );
      const boolCol = await bridge.createColumn(
        id,
        { column: { name: "Flag", type: "boolean", position: 2, nullable: true } },
        ctx()
      );
      await bridge.batchRows(
        id,
        {
          ops: [
            {
              op: "create",
              row: { [bodyCol.result.id]: "Some text", [numCol.result.id]: 1234567, [boolCol.result.id]: true },
              beforeRowId: null,
            },
          ],
        },
        ctx()
      );
      return { tableId: id, bodyColId: bodyCol.result.id, numColId: numCol.result.id, boolColId: boolCol.result.id };
    });
    const blockA = await a.evaluate((id) => window.__paneDocs!.a!.insertBlock("database", { tableId: id }), tableId);
    await b.evaluate((id) => window.__paneDocs!.b!.insertBlock("database", { tableId: id }), tableId);
    const gridA = a.locator(`[data-block-id='${blockA}'] [data-slot='docblocks/database-grid']`);
    await expect(gridA).toBeVisible(SETTLE);

    // The display's stand from one read (the grid's own DOM — no locator's
    // auto-wait / the strict-mode's stand over the grid's rows).
    const readAlign = () =>
      a.evaluate(
        ({ blockId, cols }) => {
          const grid = document.querySelector(
            `[data-block-id="${blockId}"] [data-slot="docblocks/database-grid"]`
          ) as HTMLElement | null;
          if (grid === null) return null;
          const cell = (col: string) =>
            grid.querySelector(
              `[data-slot="docblocks/database-cell"][data-column-id="${col}"][data-row="0"]`
            ) as HTMLElement | null;
          const display = (col: string) =>
            cell(col)?.querySelector('[data-slot="docblocks/database-cell-display"]') as HTMLElement | null;
          const header = (col: string) =>
            grid.querySelector(
              `[data-slot="docblocks/database-header-cell"][data-column-id="${col}"] span`
            ) as HTMLElement | null;
          const checkbox = cell(cols.bool)?.querySelector(
            '[data-slot="docblocks/database-cell-checkbox"]'
          ) as HTMLElement | null;
          const num = display(cols.num);
          const body = display(cols.body);
          if (num === null || body === null || checkbox === null) return null;
          const numCell = cell(cols.num)!;
          const boolCell = cell(cols.bool)!;
          const cbRect = checkbox.getBoundingClientRect();
          const boolRect = boolCell.getBoundingClientRect();
          return {
            numDisplayAlign: getComputedStyle(num).textAlign,
            bodyDisplayAlign: getComputedStyle(body).textAlign,
            numHeaderAlign: header(cols.num) !== null ? getComputedStyle(header(cols.num)!).textAlign : null,
            boolHeaderAlign: header(cols.bool) !== null ? getComputedStyle(header(cols.bool)!).textAlign : null,
            bodyHeaderAlign: header(cols.body) !== null ? getComputedStyle(header(cols.body)!).textAlign : null,
            // The value's right edge stands the cell's right edge (the number's
            // right align — the text's right edge is over the cell's right
            // padding, not the left).
            numValueRightOffset: numCell.getBoundingClientRect().right - num.getBoundingClientRect().right,
            // The checkbox's center stands the cell's center (the boolean's
            // center — the offset is the padding's asymmetry, ~0).
            cbCenterOffset: Math.abs(cbRect.left + cbRect.right - boolRect.left - boolRect.right) / 2,
          };
        },
        { blockId: blockA, cols: { body: bodyColId, num: numColId, bool: boolColId } }
      );
    await expect.poll(async () => (await readAlign()) !== null, SETTLE).toBe(true);
    const align = await readAlign();

    // ---- The number: the display AND the value stand the right edge.
    expect(align?.numDisplayAlign).toBe("right");
    // The value's right edge is over the cell's right padding (the right
    // align stands — not the left edge).
    expect(align?.numValueRightOffset).toBeLessThan(12);
    // ---- The text: the left's stand (the regression — the align is out;
    // the default's `start` over the LTR).
    expect(align?.bodyDisplayAlign).toBe("start");
    // ---- The boolean: the checkbox's center stands the cell's center.
    expect(align?.cbCenterOffset).toBeLessThan(4);

    // ---- The header's name stands off the icon (the uniform gap over all
    // the column's types — the align's stand is the value's, the header's
    // label stands next to the icon, not the value's edge).
    expect(align?.numHeaderAlign).toBe("start");
    expect(align?.boolHeaderAlign).toBe("start");
    expect(align?.bodyHeaderAlign).toBe("start");

    // ---- The number's EDIT input: the right align (the double press's
    // stand; the input's cursor / the type stand standard over the right).
    await gridA.locator(`[data-slot='docblocks/database-cell'][data-column-id='${numColId}'][data-row='0']`).dblclick();
    const inputAlign = await a.evaluate((blockId) => {
      const input = document.querySelector(
        `[data-block-id="${blockId}"] [data-slot="docblocks/database-cell-input"]`
      ) as HTMLElement | null;
      return input !== null ? getComputedStyle(input).textAlign : null;
    }, blockA);
    expect(inputAlign).toBe("right");
  } finally {
    await close();
  }
});
