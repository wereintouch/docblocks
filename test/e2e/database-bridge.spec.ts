// The pane's own bridge's stand: the write's envelope over the pane's own
// subscription (the grid's refetch — no doc wire), and the table's
// rename (the bridge's attribute — every block over the tableId stands
// it, the doc stands).
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

test("the bridge is live: the pane's own row mutation delivers the write's envelope over its own subscription and the grid refetches (no doc wire)", async ({
  browser,
}) => {
  const context = await editorContext(browser);
  const a = await context.newPage();
  try {
    await openPane(a, "a", "db-bridge-live-" + Math.random().toString(36).slice(2, 8));

    // The pane's bridge stands the seeded demo table; the block's grid
    // stands the demo's row count.
    const demo = await bridgeDemoTable(a);
    await a.evaluate((tableId) => {
      window.__paneDocs!.a!.insertBlock("database", { tableId });
    }, demo.id);
    const gridA = a.locator("[data-slot='docblocks/database-grid']");
    await expect(gridA.first()).toBeVisible(SETTLE);
    // The row-count badge stands in the block's header chrome (outside the
    // grid's scroller) — scoped over the block's wrapper.
    const wrapperA = a.locator("[data-block-type='database']").first();
    await expect(wrapperA.locator("[data-slot='docblocks/database-count']")).toHaveText("3 rows", SETTLE);

    // The pane's starter paragraph stands before the wire's baseline (the
    // seeder's doc write must not land inside the comparison's window).
    await expect
      .poll(
        async () =>
          a.evaluate(() => {
            const doc = window.__paneDocs?.a;
            if (doc === null || doc === undefined) return false;
            return Object.values(doc.toJSON().blocks).some((block) => block.type === "paragraph");
          }),
        SETTLE
      )
      .toBe(true);
    const outBefore = await a.locator("[data-testid='wire-a'] li", { hasText: " out " }).count();

    // The live contract: the pane's own subscription over its own bridge
    // stands the write's envelope (the `commit` kind over the write's own
    // operationId — the memory bridge's delivery stands synchronous over
    // the commit, before the write's resolve).
    await a.evaluate(async (tableId) => {
      const bridge = window.__bridge!;
      const snapshot = await bridge.snapshotTable(tableId, {});
      const rowId = snapshot.page.rows[0]?.id;
      const titleColumnId = snapshot.columns.find((column) => column.name === "Title")?.id;
      if (rowId === undefined || rowId === null || titleColumnId === undefined || titleColumnId === null) {
        throw new Error("the demo's first row / the Title column stand absent");
      }
      const operationId = crypto.randomUUID();
      let committed = false;
      const handle = bridge.subscribeTable(
        tableId,
        { afterSeq: snapshot.page.asOfSeq },
        {
          ready: () => undefined,
          event: (envelope) => {
            if (envelope.kind === "commit" && envelope.operationId === operationId) committed = true;
          },
          status: () => undefined,
          error: () => undefined,
          reset: () => undefined,
        }
      );
      try {
        await bridge.batchRows(
          tableId,
          { ops: [{ op: "update", rowId, cells: { [titleColumnId]: "SYNCED" } }] },
          { operationId, issuedAt: new Date().toISOString() }
        );
      } finally {
        handle.unsubscribe();
      }
      if (!committed) throw new Error("the write's envelope stands absent over the pane's own subscription");
    }, demo.id);

    // The pane's grid refetches over the subscription's event and shows the
    // updated title — no doc update (the row's data is not in the doc). The
    // cell stands the display (the stand until the double press), so assert
    // on the text.
    const { Title: titleColId } = await demoColumns(a, demo.id, ["Title"]);
    const titleCells = gridA.locator(`[data-slot='docblocks/database-cell'][data-column-id='${titleColId}']`);
    await expect
      .poll(async () => {
        const count = await titleCells.count();
        for (let i = 0; i < count; i += 1) {
          if ((await titleCells.nth(i).textContent()) === "SYNCED") return true;
        }
        return false;
      }, SETTLE)
      .toBe(true);
    expect(await a.locator("[data-testid='wire-a'] li", { hasText: " out " }).count()).toBe(outBefore);
  } finally {
    await context.close();
  }
});

test("the display name: the rename renames the table (the bridge's attribute) — every block over the tableId stands it", async ({
  browser,
}) => {
  const context = await editorContext(browser);
  const a = await context.newPage();
  try {
    await openPane(a, "a", "db-table-name-" + Math.random().toString(36).slice(2, 8));

    const demo = await bridgeDemoTable(a);
    const dbId = (await a.evaluate((tableId) => window.__paneDocs!.a!.insertBlock("database", { tableId }), demo.id))!;
    // The second block over the same table: its name stand is the table's
    // attribute too (every block reads the table's name, not a per-block
    // copy).
    await a.evaluate((tableId) => window.__paneDocs!.a!.insertBlock("database", { tableId }), demo.id);

    const nameA = a.locator("[data-slot='docblocks/database-name']");
    // The bridge's table name stands by default (both blocks' grids over
    // the pane's own bridge).
    await expect(nameA.first()).toHaveText("Demo", SETTLE);
    await expect(nameA.nth(1)).toHaveText("Demo", SETTLE);

    // The rename (the header's line): the commit is the blur.
    await nameA.first().click();
    const input = a.locator("[data-slot='docblocks/database-name-input']").first();
    await expect(input).toBeVisible(SETTLE);
    await input.fill("My Board");
    await input.blur();
    // The table's attribute stands in every block over the tableId — both
    // blocks' grids refetch over the pane's bridge (no doc update).
    await expect(nameA.first()).toHaveText("My Board", SETTLE);
    await expect(nameA.nth(1)).toHaveText("My Board", SETTLE);
    // No doc write: the blocks' JSON stands untouched (no `name` attr).
    const names = await a.evaluate(
      (ids) => ids.map((id) => window.__paneDocs!.a!.getBlock(id)?.attrs?.name ?? null),
      [dbId]
    );
    expect(names).toEqual([null]);

    // The grid's undo reverts the rename (the bridge's undo stack: the
    // table's name stands back over the pane's bridge, both blocks).
    const { Title: undoTitleColId } = await demoColumns(a, demo.id, ["Title"]);
    await a.locator(`[data-slot='docblocks/database-cell'][data-column-id='${undoTitleColId}']`).first().click();
    await a.keyboard.press("Control+z");
    await expect(nameA.first()).toHaveText("Demo", SETTLE);
    await expect(nameA.nth(1)).toHaveText("Demo", SETTLE);
  } finally {
    await context.close();
  }
});
