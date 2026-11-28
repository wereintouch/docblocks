// The columns' manager's stand: the popover's hidden column's restore +
// the keyboard / the mouse's reorder (the columnWidths' rebase), and the
// create's column order (the creation order's stand, the committed
// order's intactness, the undo's stand).
import { type Page, expect, test } from "@playwright/test";

import { SETTLE, editorContext, openPane } from "./helpers";

/** The table's schema's column ids (the bridge's read). */
async function columnIds(page: Page, tableId: string): Promise<string[]> {
  return page.evaluate(
    async (id) => (await window.__bridge!.describeTable(id)).columns.map((column) => column.id),
    tableId
  );
}

test("the columns popover restores hidden columns and reorders by keyboard and mouse", async ({ browser }) => {
  const context = await editorContext(browser);
  const a = await context.newPage();
  try {
    await openPane(a, "a", "db-column-manager-" + Math.random().toString(36).slice(2, 8));
    const { dbId, ids } = await a.evaluate(async () => {
      const bridge = window.__bridge!;
      const ctx = () => ({ operationId: crypto.randomUUID(), issuedAt: new Date().toISOString() });
      const table = await bridge.createTable({ name: "Column manager" }, ctx());
      const tableId = table.result.id;
      const ids: string[] = [];
      for (const [position, name] of ["Alpha", "Beta", "Gamma"].entries()) {
        const column = await bridge.createColumn(
          tableId,
          { column: { name, type: "text", position, nullable: true } },
          ctx()
        );
        ids.push(column.result.id);
      }
      await bridge.batchRows(tableId, { ops: [{ op: "create", row: { [ids[0]!]: "row" }, beforeRowId: null }] }, ctx());
      const dbId = window.__paneDocs!.a!.insertBlock("database", {
        tableId,
        columnOrder: ids,
        hiddenColumns: [ids[1]!],
        columnWidths: [120, 140],
      });
      return { dbId, ids };
    });
    const [alpha, beta, gamma] = ids;
    await expect(a.locator("[data-slot='docblocks/database-grid']")).toHaveCount(1, SETTLE);
    await a.locator("[data-slot='docblocks/database-columns']").click();
    const content = a.locator("[data-slot='docblocks/database-columns-content']");
    await expect(content).toBeVisible(SETTLE);
    expect(await content.evaluate((el) => getComputedStyle(el).backgroundColor)).not.toBe("rgba(0, 0, 0, 0)");

    const betaVisibility = content.locator(
      `[data-slot='docblocks/database-column-visibility'][data-column-id='${beta}']`
    );
    await expect(betaVisibility).toHaveAttribute("data-state", "unchecked");
    await betaVisibility.click();
    await expect(a.locator(`[data-slot='docblocks/database-header-cell'][data-column-id='${beta}']`)).toHaveCount(
      1,
      SETTLE
    );
    await expect(content).toBeVisible();
    await a.evaluate((id) => window.__paneDocs!.a!.updateBlock(id, { columnWidths: [120, 130, 140] }), dbId);

    const grip = (columnId: string) =>
      content.locator(`[data-slot='docblocks/database-column-move'][data-column-id='${columnId}']`);
    const headerOrder = () =>
      a
        .locator("[data-slot='docblocks/database-header-cell']")
        .evaluateAll((cells) => cells.map((cell) => cell.getAttribute("data-column-id")));
    await grip(alpha!).focus();
    await a.keyboard.press("ArrowDown");
    await expect.poll(headerOrder, SETTLE).toEqual([beta, alpha, gamma]);
    await expect(content).toBeVisible();

    const from = (await grip(alpha!).boundingBox())!;
    const target = (await grip(gamma!).boundingBox())!;
    await a.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await a.mouse.down();
    const endY = target.y + target.height + 12;
    await a.mouse.move(from.x + from.width / 2, endY, { steps: 12 });
    // The drag's preview's settle over the release's position (the rAF's
    // tick's stand over the engine's input's batching — the release before
    // the settle stands the last slot's miss over the slow engine): the
    // item's center stands the pointer's end position before the release.
    await expect
      .poll(async () => {
        const box = (await grip(alpha!).boundingBox()) ?? null;
        return box === null ? null : Math.abs(box.y + box.height / 2 - endY);
      }, SETTLE)
      .toBeLessThan(2);
    await a.mouse.up();
    await expect.poll(headerOrder, SETTLE).toEqual([beta, gamma, alpha]);

    const attrs = await a.evaluate((id) => {
      const block = window.__paneDocs!.a!.toJSON().blocks[id];
      return block?.type === "database" ? block.attrs : null;
    }, dbId);
    expect(attrs?.columnOrder).toEqual([beta, gamma, alpha]);
    expect(attrs?.columnWidths).toEqual([130, 140, 120]);
  } finally {
    await context.close();
  }
});

test("the create's column order stands the creation order (the new stands last); the create keeps the committed columnOrder intact (the visible order stands complete)", async ({
  browser,
}) => {
  const context = await editorContext(browser);
  const a = await context.newPage();
  try {
    await openPane(a, "a", "db-colorder-" + Math.random().toString(36).slice(2, 8));

    // A fresh (empty) table over the pane's own bridge: the create's order
    // is the append's stand.
    const tableId = await a.evaluate(async () => {
      const bridge = window.__bridge!;
      const receipt = await bridge.createTable(
        { name: "colorder-" + Date.now() },
        { operationId: crypto.randomUUID(), issuedAt: new Date().toISOString() }
      );
      return receipt.result.id;
    });
    const dbId = (await a.evaluate((tableId) => window.__paneDocs!.a!.insertBlock("database", { tableId }), tableId))!;

    const emptyA = a.locator("[data-testid=\"doc-a\"] [data-slot='docblocks/database-empty']");
    await expect(emptyA).toHaveCount(1, SETTLE);

    // The create form's drive: open the "+" menu, pick the type's entry,
    // fill the name, commit on the form's button (awaited — the creates are
    // sequential, not racy). The trigger's press may stand swallowed over a
    // just-closed portaled wrapper (the ~150 ms exit capture) or a mid-
    // re-render (a doc write just landed) — retry the press until the menu
    // stands.
    const addColumn = async (pane: Page, entryKey: string, colName: string) => {
      const trigger = pane.locator("[data-slot='docblocks/database-add-column-trigger']");
      const item = pane.locator(`[data-column-entry="${entryKey}"]`);
      for (let attempt = 0; ; attempt++) {
        await trigger.click();
        const opened = await item
          .waitFor({ state: "visible", timeout: 1500 })
          .then(() => true)
          .catch(() => false);
        if (opened) break;
        if (attempt >= 3) throw new Error(`the add-column menu did not open (entry ${entryKey})`);
        await pane.keyboard.press("Escape");
        await pane.waitForTimeout(250);
      }
      await item.click();
      const form = pane.locator("[data-slot='docblocks/database-add-column-form']");
      await form.waitFor({ state: "visible", timeout: 5000 });
      await form.locator("[data-slot='docblocks/database-add-column-name']").fill(colName);
      await form.getByRole("button", { name: "Add column" }).click();
      // The form's popover's close animation stands the portaled wrapper's
      // pointer capture for ~150 ms (the closing popper's gotcha): the next
      // trigger's press stands swallowed over it. Settle the close.
      await pane.waitForTimeout(250);
    };
    const headerIds = (pane: Page, client: "a" | "b") =>
      pane
        .locator(`[data-testid="doc-${client}"] [data-slot='docblocks/database-header-cell']`)
        .evaluateAll((cells) => cells.map((cell) => cell.getAttribute("data-column-id")));
    const columnOrderOf = (page: Page, client: "a" | "b") =>
      page.evaluate(
        ({ c, id }) => {
          const doc = c === "a" ? window.__paneDocs?.a : window.__paneDocs?.b;
          const block = doc?.toJSON().blocks[id];
          return block?.type === "database" ? ((block.attrs?.columnOrder as string[] | undefined) ?? null) : null;
        },
        { c: client, id: dbId }
      );

    // Create: decimal -> text -> enum (the create form's sequence).
    await addColumn(a, "decimal", "Dec");
    await addColumn(a, "text", "Txt");
    await addColumn(a, "enum", "Status");

    // The header's DOM order stands the creation order (the new stands last)
    // over the pane's own grid.
    const schemaIds = await columnIds(a, tableId);
    expect(schemaIds).toHaveLength(3);
    const [id1, id2, id3] = [schemaIds[0]!, schemaIds[1]!, schemaIds[2]!];
    await expect.poll(async () => headerIds(a, "a"), SETTLE).toEqual([id1, id2, id3]);
    // No explicit columnOrder yet (the bridge's schema order stands).
    expect(await columnOrderOf(a, "a")).toBeNull();

    // The create commit's columnOrder consistency: the block's explicit
    // columnOrder (a drag's stand — the visible order) keeps the previous
    // columns in their committed order; the new column stands in the view
    // over the schema-order remainder (the bridge assigns its id — the
    // view's completeness stands the header's order, not the attr's tail).
    // Simulate the drag's stand.
    await a.evaluate(({ id, order }) => window.__paneDocs!.a!.updateBlock(id, { columnOrder: order }), {
      id: dbId,
      order: [id2, id1, id3],
    });
    await addColumn(a, "text", "Link"); // the fourth column
    const schemaIds4 = await columnIds(a, tableId);
    expect(schemaIds4).toHaveLength(4);
    const id4 = schemaIds4[3]!;
    await expect.poll(async () => headerIds(a, "a"), SETTLE).toEqual([id2, id1, id3, id4]);
    // The committed order's head stands intact over the create (the drag's
    // stand survives; the created column's real id stands the view only).
    expect((await columnOrderOf(a, "a"))?.slice(0, 3)).toEqual([id2, id1, id3]);

    // The create's undo stands the order back: the grid's Undo (the bridge's
    // stack — the column's removal) drops the new column; the visible order
    // stands the previous one (the columnOrder's stale tail stands ignored —
    // the next drag re-commits it).
    await a.locator("[data-slot='docblocks/database-undo']").click();
    await expect.poll(async () => (await headerIds(a, "a")).length, SETTLE).toBe(3);
    await expect.poll(() => headerIds(a, "a"), SETTLE).toEqual([id2, id1, id3]);
  } finally {
    await context.close();
  }
});
