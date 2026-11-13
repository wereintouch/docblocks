import { type Browser, type Page, expect, test } from "@playwright/test";

import { SETTLE, editorContext, insertBlockType, openPane, twoPanes } from "./helpers";

/** Insert one v1 type at the root through the pane's harness control. */
async function insertType(page: Page, client: "a" | "b", type: string): Promise<void> {
  await insertBlockType(page, client, type);
}

/** The pane's database block from the harness global (its own letter). */
function readDatabase(page: Page, client: "a" | "b", dbId: string) {
  return page.evaluate(
    ({ client, dbId }) => {
      const doc = client === "a" ? window.__paneDocs?.a : window.__paneDocs?.b;
      const block = doc?.toJSON().blocks[dbId];
      return block?.type === "database" ? { rowOrder: block.rowOrder!, rows: block.rows! } : null;
    },
    { client, dbId }
  );
}

/** The database id + the seed row order, from the pane's live doc. */
async function databaseInfo(page: Page): Promise<{ dbId: string; rowOrder: string[] }> {
  const info = await page.evaluate(() => {
    const doc = window.__paneDocs?.a;
    if (!doc) return null;
    const json = doc.toJSON();
    const dbId = Object.keys(json.blocks).find((id) => json.blocks[id]!.type === "database");
    if (dbId === undefined) return null;
    const block = json.blocks[dbId]!;
    return { dbId, rowOrder: block.type === "database" ? block.rowOrder! : [] };
  });
  expect(info).not.toBeNull();
  return info!;
}

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

/** The statuses' system table's option row id by its label (the enum's
 * options' catalog read — the option's row IS the option). */
async function statusOptionId(page: Page, label: string): Promise<string> {
  const id = await page.evaluate(async (label) => {
    const snapshot = await window.__bridge!.snapshotTable("table-statuses-enum", {});
    const nameColumnId = snapshot.columns.find((column) => column.name === "name")?.id ?? null;
    if (nameColumnId === null) return null;
    return snapshot.page.rows.find((row) => row.cells[nameColumnId] === label)?.id ?? null;
  }, label);
  if (id === null) throw new Error(`the "${label}" option stands absent over the statuses' system table`);
  return id;
}

/** The table's schema's column ids (the bridge's read). */
async function columnIds(page: Page, tableId: string): Promise<string[]> {
  return page.evaluate(
    async (id) => (await window.__bridge!.describeTable(id)).columns.map((column) => column.id),
    tableId
  );
}

/** Poll the table's schema until it stands `count` columns and return the
 * last one's id (the form's create's stand — the new column stands
 * appended). */
async function awaitedLastColumnId(page: Page, tableId: string, count: number): Promise<string> {
  await expect.poll(async () => (await columnIds(page, tableId)).length, SETTLE).toBe(count);
  return (await columnIds(page, tableId))[count - 1]!;
}

test("a database inserted in A renders in both panes and reaches the JSON", async ({ browser }) => {
  const { a, b, close } = await twoPanes(browser, "ext04-card");

  await insertType(a, "a", "database");

  for (const [pane, client] of [
    [a, "a"],
    [b, "b"],
  ] as const) {
    const doc = pane.locator(`[data-testid="doc-${client}"]`);
    const wrapper = doc.locator('[data-block-type="database"]');

    // The placeholder card in both panes: the column names (from the
    // harness seed) and the row count 2 (the seed rows synced over the
    // wire in B).
    await expect(wrapper).toHaveCount(1);
    await expect(wrapper.locator("[data-slot='docblocks/database-header']")).toContainText("Name");
    await expect(wrapper.locator("[data-slot='docblocks/database-header']")).toContainText("Done");
    await expect(wrapper.locator("[data-slot='docblocks/database-header']")).toContainText("Status");
    await expect(wrapper.locator("[data-slot='docblocks/database-count']")).toHaveText("2 rows");
    // The card frame reads the table border tokens (zone 3 — the classes
    // replaced the removed wrapper rule; the catalog has no database
    // block, so this pane is its visual pin).
    const cardStyle = await wrapper.first().evaluate((el) => {
      const s = getComputedStyle(el);
      return { width: s.borderTopWidth, style: s.borderTopStyle, radius: s.borderTopLeftRadius };
    });
    expect(cardStyle).toEqual({ width: "1px", style: "solid", radius: "10px" });
    // The wrapper contract: not text-editable, no gutter.
    expect(await wrapper.locator('[data-slot="docblocks/block-content"]').count()).toBe(0);
    expect(await wrapper.locator('[data-slot="docblocks/gutter"]').count()).toBe(0);
  }

  // The JSON inspector of pane A shows the rows + rowOrder + a cell value.
  const jsonA = a.getByTestId("json-a");
  await expect.poll(async () => (await jsonA.innerText()).includes('"type": "database"'), SETTLE).toBe(true);
  const jsonText = await jsonA.innerText();
  expect(jsonText).toContain('"rows"');
  expect(jsonText).toContain('"rowOrder"');
  expect(jsonText).toContain('"First task"');
  expect(jsonText).toContain('"status": "active"');

  await close();
});

test("the row commands over the wire: insertRow / setCell / moveRow / removeRow reach pane B", async ({ browser }) => {
  const { a, b, close } = await twoPanes(browser, "ext04-wire");

  await insertType(a, "a", "database");
  const cardB = b.locator('[data-block-type="database"]');
  await expect.poll(async () => cardB.count(), SETTLE).toBe(1);
  await expect(cardB.locator("[data-slot='docblocks/database-count']")).toHaveText("2 rows");

  const info = await databaseInfo(a);
  const { dbId, rowOrder: seedOrder } = info;
  const outBefore = await a.locator("[data-testid='wire-a'] li", { hasText: " out " }).count();

  // Stage 1: insertRow + one transact of two setCells (the name + a
  // select cell with a valid option) — two wire updates.
  const newRow = await a.evaluate(
    ({ dbId }: { dbId: string }) => {
      const doc = window.__paneDocs!.a!;
      const newRow = doc.insertRow(dbId);
      doc.transact(() => {
        doc.setCell(dbId, newRow, "name", "New row");
        doc.setCell(dbId, newRow, "status", "active");
      });
      return newRow;
    },
    { dbId }
  );
  await expect
    .poll(async () => a.locator("[data-testid='wire-a'] li", { hasText: " out " }).count(), SETTLE)
    .toBeGreaterThanOrEqual(outBefore + 2);

  // Pane B: the new row present with the values, the count updated (3 rows).
  await expect
    .poll(async () => readDatabase(b, "b", dbId), SETTLE)
    .toMatchObject({
      rowOrder: [...seedOrder, newRow],
    });
  const stage1 = await readDatabase(b, "b", dbId);
  expect(stage1?.rows[newRow]).toEqual({ name: "New row", status: "active" });
  await expect(cardB.locator("[data-slot='docblocks/database-count']")).toHaveText("3 rows");

  // Stage 2: moveRow (the first seed row to the end, pre-move index) +
  // removeRow (the second seed row) — two more wire updates.
  await a.evaluate(
    ({ dbId }: { dbId: string }) => {
      const doc = window.__paneDocs!.a!;
      const json = doc.toJSON();
      const block = json.blocks[dbId]!;
      const [first, second] = block.type === "database" ? block.rowOrder! : [];
      doc.moveRow(dbId, first!, 2);
      doc.removeRow(dbId, second!);
    },
    { dbId }
  );
  await expect
    .poll(async () => a.locator("[data-testid='wire-a'] li", { hasText: " out " }).count(), SETTLE)
    .toBeGreaterThanOrEqual(outBefore + 4);

  // Pane B: the order moved, the removed row gone, the count back to 2.
  await expect
    .poll(async () => readDatabase(b, "b", dbId), SETTLE)
    .toMatchObject({
      rowOrder: [seedOrder[0]!, newRow],
    });
  const final = await readDatabase(b, "b", dbId);
  expect(final?.rows[seedOrder[0]!]).toEqual({ name: "First task", done: false, status: "active" });
  expect(final?.rows[newRow]).toEqual({ name: "New row", status: "active" });
  expect(final?.rows[seedOrder[1]!]).toBeUndefined();
  await expect(cardB.locator("[data-slot='docblocks/database-count']")).toHaveText("2 rows");

  // The four command updates are visible in A's wire log.
  const wireText = await a.locator("[data-testid='wire-a']").innerText();
  expect((wireText.match(/ out /g) ?? []).length).toBeGreaterThanOrEqual(outBefore + 4);

  await close();
});

test("setCell with an out-of-options select value throws InvalidCellValueError (the doc is unchanged)", async ({
  browser,
}) => {
  const { a, close } = await twoPanes(browser, "ext04-error");

  await insertType(a, "a", "database");
  const { dbId, rowOrder: seedOrder } = await databaseInfo(a);
  const rowId = seedOrder[0]!;

  const snapshotOf = () => a.evaluate(() => JSON.stringify(window.__paneDocs?.a?.toJSON() ?? null));
  // The document's tail contract: the peer's remote feed stands the doc's
  // trailing paragraph over the wire (the non-text tail stands no caret
  // home). Settle it before the stability baseline, or the stand lands
  // inside the comparison window and reads as a "changed" doc.
  await expect
    .poll(
      () =>
        a.evaluate(() => {
          const doc = window.__paneDocs?.a;
          if (doc === null || doc === undefined) return false;
          const json = doc.toJSON();
          const root = json.blocks[json.id]!;
          const children = root.children;
          if (children === undefined) return false;
          const lastId = children[children.length - 1];
          return lastId !== undefined && json.blocks[lastId]!.type === "paragraph";
        }),
      SETTLE
    )
    .toBe(true);
  const before = await snapshotOf();

  const outcome = await a.evaluate(
    ({ dbId, rowId }) => {
      const doc = window.__paneDocs!.a!;
      try {
        doc.setCell(dbId, rowId, "status", "bogus");
        return "no-throw";
      } catch (error) {
        return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
      }
    },
    { dbId, rowId }
  );
  expect(outcome.startsWith("InvalidCellValueError")).toBe(true);
  expect(outcome).toContain("status");

  // The failed command left the doc untouched (the JSON is stable).
  expect(await snapshotOf()).toBe(before);

  await close();
});

test("the external form (the tableId reference) syncs over the wire and renders the live grid", async ({ browser }) => {
  const { a, b, close } = await twoPanes(browser, "ext04-external");

  // Both panes' default bridges seed the identical demo table (per page);
  // the reference only travels over the wire, the data is per-page.
  const demoA = await bridgeDemoTable(a);
  const demoB = await bridgeDemoTable(b);
  expect(demoA.id).toBe(demoB.id);
  expect(demoA.name).toBe("Demo");

  const dbId = (await a.evaluate((tableId) => window.__paneDocs!.a!.insertBlock("database", { tableId }), demoA.id))!;

  for (const [pane, client] of [
    [a, "a"],
    [b, "b"],
  ] as const) {
    const doc = pane.locator(`[data-testid="doc-${client}"]`);
    const wrapper = doc.locator("[data-block-type='database']");
    await expect(wrapper).toHaveCount(1, SETTLE);
    // The ready grid stands (not the broken state): the table name from the
    // pane's own bridge + the demo row count (3 rows).
    const card = wrapper.locator("[data-slot='docblocks/database']");
    await expect(card).toHaveCount(1, SETTLE);
    await expect(card).not.toHaveAttribute("data-state", "broken", SETTLE);
    await expect(wrapper.locator("[data-slot='docblocks/database-name']")).toHaveText("Demo", SETTLE);
    await expect(wrapper.locator("[data-slot='docblocks/database-count']")).toHaveText("3 rows", SETTLE);

    // The doc keeps the reference only: the inline schema is absent on both sides.
    const json = await pane.evaluate(
      ({ client, dbId }) => {
        const d = client === "a" ? window.__paneDocs?.a : window.__paneDocs?.b;
        const block = d?.toJSON().blocks[dbId] as { attrs?: Record<string, unknown> } | undefined;
        return {
          tableId: typeof block?.attrs?.tableId === "string" ? block.attrs.tableId : null,
          columns: Array.isArray(block?.attrs?.columns) ? (block.attrs.columns as unknown[]).length : null,
        };
      },
      { client, dbId }
    );
    expect(json.tableId).toBe(demoA.id);
    expect(json.columns).toBeNull();
  }

  await close();
});

test("the slash Database picker inserts a block referencing a table", async ({ browser }) => {
  const { a, close } = await twoPanes(browser, "ext04-slash");

  const demo = await bridgeDemoTable(a);

  // Seed a paragraph with a caret, open the menu, filter to Database.
  const inner = a.locator('[data-testid="doc-a"] [data-slot="docblocks/block-content"]').first();
  await inner.click();
  await a.keyboard.type("/database");
  const menuItem = a.locator('[data-slot="docblocks/slash-menu"] [role="menuitem"]');
  await expect(menuItem, "the Database command filters to one entry").toHaveCount(1, SETTLE);
  await expect(menuItem).toHaveText("Database");
  await a.keyboard.press("Enter");

  // The picker stands over the open menu (the phrase intact).
  const picker = a.locator("[data-slot='docblocks/slash-database-picker']");
  await expect(picker).toBeVisible(SETTLE);
  // The picker lists the bridge's tables (the seeded demo + the extra dev
  // fixture); pick the demo table by its id so the assertion is seed-count
  // agnostic.
  const demoTable = picker.locator(`[data-slot='docblocks/slash-database-table'][data-table-id="${demo.id}"]`);
  await expect(demoTable).toBeVisible(SETTLE);
  await expect(demoTable).toHaveText("Demo");

  // Pick the demo table: the phrase strips and the database block lands
  // (the `tableId` reference) — the ready grid renders from the bridge.
  await demoTable.click();

  const wrapper = a.locator("[data-block-type='database']");
  await expect(wrapper).toHaveCount(1, SETTLE);
  await expect(wrapper.locator("[data-slot='docblocks/database-name']")).toHaveText("Demo", SETTLE);
  await expect(wrapper.locator("[data-slot='docblocks/database-count']")).toHaveText("3 rows", SETTLE);

  // The doc holds the reference only (no inline schema).
  const json = await a.evaluate(() => {
    const doc = window.__paneDocs!.a!;
    const json = doc.toJSON();
    const dbId = Object.keys(json.blocks).find((id) => json.blocks[id]!.type === "database")!;
    const block = json.blocks[dbId]!;
    return { tableId: block.attrs?.tableId, columns: block.attrs?.columns };
  });
  expect(json.tableId).toBe(demo.id);
  expect(json.columns).toBeUndefined();

  await close();
});

test("the slash Database picker's create-new: the auto-focused form, the Enter commit over the wire, the table's stand over the other pane's reload", async ({
  browser,
}) => {
  // One context (the same origin): the panes' bridges share the
  // localStorage snapshot over a load. The block stands in the other pane
  // over the doc's wire; the created table stands there over its reload
  // (the snapshot's restore — the cross-bridge live channel stands none).
  const { a, b, close } = await twoPanesSharedContext(browser, "ext04-slash-create");
  try {
    // Wait for the pane's bridge (the seeded demo stands — the picker's
    // listTables resolves against the same bridge).
    await bridgeDemoTable(a);
    // Seed a paragraph with a caret, open the menu, filter to Database.
    const inner = a.locator('[data-testid="doc-a"] [data-slot="docblocks/block-content"]').first();
    await inner.click();
    await a.keyboard.type("/database");
    const menuItem = a.locator('[data-slot="docblocks/slash-menu"] [role="menuitem"]');
    await expect(menuItem).toHaveCount(1, SETTLE);
    await a.keyboard.press("Enter");
    const picker = a.locator("[data-slot='docblocks/slash-database-picker']");
    await expect(picker).toBeVisible(SETTLE);
    // The `New table` button stands; the click stands the form (the name
    // input, auto-focused + the check commit).
    const createNew = picker.locator("[data-slot='docblocks/slash-database-create-new']");
    await expect(createNew).toBeVisible(SETTLE);
    await createNew.click();
    const nameInput = picker.locator("[data-slot='docblocks/slash-database-name']");
    await expect(nameInput).toBeVisible(SETTLE);
    await expect(nameInput).toBeFocused(SETTLE);
    const check = picker.locator("[data-slot='docblocks/slash-database-create']");
    await expect(check).toBeVisible(SETTLE);
    // The empty name: the check stands disabled (the commit is a no-op).
    await expect(check).toBeDisabled();
    // The name types (the input is focused), the check stands enabled, and
    // the Enter commits (the table over the pane's bridge, the block over
    // the doc's wire).
    await a.keyboard.type("My Board");
    await expect(check).toBeEnabled();
    await a.keyboard.press("Enter");
    // The block with the tableId reference lands (the phrase strips) and
    // resolves in the pane's own grid (the pane's bridge stands the
    // created table).
    const wrapperA = a.locator("[data-block-type='database']");
    await expect(wrapperA).toHaveCount(1, SETTLE);
    await expect(wrapperA.locator("[data-slot='docblocks/database-name']")).toHaveText("My Board", SETTLE);
    // The block stands in the other pane over the doc's wire (its grid
    // stands the broken state — the pane's own bridge lacks the table).
    const wrapperB = b.locator("[data-block-type='database']");
    await expect(wrapperB).toHaveCount(1, SETTLE);
    // The table's state stands the shared snapshot over the other pane's
    // reload: the pane's bridge's save stands the snapshot's table, the
    // reload's restore re-creates it over the stable id, and the pane's
    // re-fetched doc stands the block's reference resolved.
    await a.waitForTimeout(750);
    await b.reload();
    await expect(b.getByTestId("status-b")).toHaveText("connected", SETTLE);
    await expect(wrapperB.locator("[data-slot='docblocks/database-name']")).toHaveText("My Board", SETTLE);
    // The doc holds the reference only (no inline schema).
    const json = await a.evaluate(() => {
      const doc = window.__paneDocs!.a!;
      const json = doc.toJSON();
      const dbId = Object.keys(json.blocks).find((id) => json.blocks[id]!.type === "database")!;
      const block = json.blocks[dbId]!;
      return { tableId: block.attrs?.tableId, columns: block.attrs?.columns };
    });
    expect(typeof json.tableId).toBe("string");
    expect(json.columns).toBeUndefined();
  } finally {
    await close();
  }
});

test("the slash Database picker's search filters the existing tables by name", async ({ browser }) => {
  const { a, close } = await twoPanes(browser, "ext04-slash-search");
  try {
    const demo = await bridgeDemoTable(a);
    // Seed a second table with a distinct name (the bridge, per page).
    const other = await a.evaluate(async () => {
      const receipt = await window.__bridge!.createTable(
        { name: "Zebra Board" },
        { operationId: crypto.randomUUID(), issuedAt: new Date().toISOString() }
      );
      return receipt.result.id;
    });
    // Open the picker over the phrase.
    const inner = a.locator('[data-testid="doc-a"] [data-slot="docblocks/block-content"]').first();
    await inner.click();
    await a.keyboard.type("/database");
    const menuItem = a.locator('[data-slot="docblocks/slash-menu"] [role="menuitem"]');
    await expect(menuItem).toHaveCount(1, SETTLE);
    await a.keyboard.press("Enter");
    const picker = a.locator("[data-slot='docblocks/slash-database-picker']");
    await expect(picker).toBeVisible(SETTLE);
    const demoItem = picker.locator(`[data-slot='docblocks/slash-database-table'][data-table-id="${demo.id}"]`);
    const otherItem = picker.locator(`[data-slot='docblocks/slash-database-table'][data-table-id="${other}"]`);
    // Both tables stand at rest.
    await expect(demoItem).toBeVisible(SETTLE);
    await expect(otherItem).toBeVisible(SETTLE);
    // The search's query filters the list (by name, case-insensitive).
    const search = picker.locator("[data-slot='docblocks/slash-database-search']");
    await search.fill("zebra");
    await expect(otherItem).toBeVisible();
    await expect(demoItem).toBeHidden();
    // A non-matching query stands the empty stand.
    await search.fill("no-such-table");
    await expect(demoItem).toBeHidden();
    await expect(otherItem).toBeHidden();
    await expect(picker.locator("[data-slot='docblocks/slash-database-empty']")).toBeVisible();
  } finally {
    await close();
  }
});

test("the row commands refuse the external form over the wire (the typed error)", async ({ browser }) => {
  const { a, close } = await twoPanes(browser, "ext04-external-error");

  const dbId = (await a.evaluate(() => window.__paneDocs!.a!.insertBlock("database", { tableId: "ext-1" })))!;
  // The block itself is the comparison unit: the room's tail guarantee may
  // still be standing its paragraph over the wire, so the whole-doc
  // snapshot is not a stable baseline here.
  const blockOf = () => a.evaluate((id) => JSON.stringify(window.__paneDocs?.a?.getBlock(id) ?? null), dbId);
  const before = await blockOf();

  const outcome = await a.evaluate((dbId) => {
    const doc = window.__paneDocs!.a!;
    try {
      doc.insertRow(dbId);
      return "no-throw";
    } catch (error) {
      return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    }
  }, dbId);
  expect(outcome.startsWith("ExternalDatabaseError")).toBe(true);
  expect(outcome).toContain("ext-1");

  // The failed command left the block untouched.
  await expect.poll(async () => (await blockOf()) === before, SETTLE).toBe(true);

  await close();
});

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

test("the bridge is live: the pane's own row mutation delivers the write's envelope over its own subscription and the grid refetches (no doc wire)", async ({
  browser,
}) => {
  const context = await editorContext(browser);
  const a = await context.newPage();
  try {
    await openPane(a, "a", "ext04-bridge-live-" + Math.random().toString(36).slice(2, 8));

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
    await openPane(a, "a", "ext04-table-name-" + Math.random().toString(36).slice(2, 8));

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

test("the header: the type stands in the menu only, the widths align with the rows, the drag reorders over the wire", async ({
  browser,
}) => {
  const { a, b, close } = await twoPanes(browser, "ext04-header");

  const demo = await bridgeDemoTable(a);
  const dbId = (await a.evaluate((tableId) => window.__paneDocs!.a!.insertBlock("database", { tableId }), demo.id))!;

  const gridA = a.locator("[data-slot='docblocks/database-grid']");
  await expect(gridA).toHaveCount(1, SETTLE);
  const gridB = b.locator("[data-slot='docblocks/database-grid']");
  await expect(gridB).toHaveCount(1, SETTLE);

  // The header cell stands the name only (the type is not in the row).
  const { Title: titleColId } = await demoColumns(a, demo.id, ["Title"]);
  const titleHeader = a.locator(`[data-slot='docblocks/database-header-cell'][data-column-id='${titleColId}']`);
  await expect(titleHeader).toHaveText("Title", SETTLE);

  // The Ellipsis's press stands the menu (the read-only type line + the
  // hide) — the header's name zone's press stands nothing (the menu-open's
  // only trigger is the Ellipsis's own press).
  await titleHeader.locator("[data-slot='docblocks/database-column-menu']").click();
  const menuType = a.locator("[data-slot='docblocks/database-column-type']");
  await expect(menuType).toBeVisible(SETTLE);
  await expect(menuType).toHaveText("text");
  // The menu's content resolves the standard tokens in the body portal:
  // the rename line stands a tinted background, not the UA border.
  const renameBg = await a
    .locator("[data-slot='docblocks/database-rename-input']")
    .evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(renameBg).not.toBe("rgba(0, 0, 0, 0)");
  await a.keyboard.press("Escape");

  // The filter popover stands opaque in the portal (the standard tokens
  // reach the body; the `--docblocks-*` editor-root tokens do not).
  await a.locator("[data-slot='docblocks/database-filter']").click();
  const popover = a.locator("[data-slot='popover-content']");
  await expect(popover).toBeVisible(SETTLE);
  const popoverBg = await popover.evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(popoverBg).not.toBe("rgba(0, 0, 0, 0)");
  await a.keyboard.press("Escape");

  // The header and the row stand the same column width (the shared grid;
  // the cell wrapper is the grid item, so its own box is the column track).
  const headerBox = await titleHeader.boundingBox();
  const cellBox = await a
    .locator(`[data-slot='docblocks/database-cell'][data-column-id='${titleColId}']`)
    .first()
    .evaluate((el) => {
      const rect = el.getBoundingClientRect();
      return { x: rect.x, width: rect.width };
    });
  expect(headerBox).not.toBeNull();
  expect(Math.abs(headerBox!.width - cellBox.width)).toBeLessThan(1);
  expect(Math.abs(headerBox!.x - cellBox.x)).toBeLessThan(1);

  // The header's press-drag reorders the columns: the columnOrder attr
  // stands over the wire, both grids resync from it (the first column is
  // no longer the title after the rightward drag). The preview parts the
  // stationary columns (the pure view state — no doc write until the
  // release: the dragged header follows the pointer, the stationary
  // columns stand shifted by one column width).
  const box = (await titleHeader.boundingBox())!;
  await a.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await a.mouse.down();
  await a.mouse.move(box.x + box.width / 2 + 400, box.y + box.height / 2, { steps: 8 });
  await a.waitForTimeout(300);
  const midStands = await a.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLElement>('[data-slot="docblocks/database-header-cell"]')).map((el) => ({
      id: el.getAttribute("data-column-id"),
      tf: el.style.transform,
    }))
  );
  const draggedMid = midStands.find((entry) => entry.id === titleColId);
  expect(draggedMid?.tf).toMatch(/translateX\((\d+(\.\d+)?px)\)/);
  const stationaryShifted = midStands.filter((entry) => entry.id !== titleColId && entry.tf !== "");
  expect(stationaryShifted.length).toBeGreaterThan(0);
  // No doc write mid-drag: the columnOrder attr stands absent.
  const midJson = await a.evaluate((id) => {
    const block = window.__paneDocs!.a!.toJSON().blocks[id];
    return block?.type === "database" ? ((block.attrs as Record<string, unknown>).columnOrder ?? null) : null;
  }, dbId);
  expect(midJson).toBeNull();
  await a.mouse.up();

  const headerOrder = (pane: Page, client: "a" | "b") =>
    pane
      .locator(`[data-testid="doc-${client}"] [data-slot='docblocks/database-header-cell']`)
      .evaluateAll((cells) => cells.map((cell) => cell.getAttribute("data-column-id")));
  let orderA: (string | null)[] = [];
  await expect
    .poll(async () => {
      orderA = await headerOrder(a, "a");
      return orderA[0] !== titleColId;
    }, SETTLE)
    .toBe(true);
  await expect.poll(() => headerOrder(b, "b"), SETTLE).toEqual(orderA);

  const json = await a.evaluate((id) => {
    const block = window.__paneDocs!.a!.toJSON().blocks[id];
    return block?.type === "database" ? ((block.attrs as Record<string, unknown>).columnOrder ?? null) : null;
  }, dbId);
  expect(json).toEqual(orderA);

  await close();
});

test("the filter menu: the single-line's condition, the connector's line, the group's card (the width's stand)", async ({
  browser,
}) => {
  const context = await editorContext(browser);
  const a = await context.newPage();
  try {
    await openPane(a, "a", `db-filter-menu-${Math.random().toString(36).slice(2, 8)}`, { light: true });
    const demo = await bridgeDemoTable(a);
    await a.evaluate((tableId) => window.__paneDocs!.a!.insertBlock("database", { tableId }), demo.id);
    await a.locator("[data-slot='docblocks/database-grid']").first().waitFor({ timeout: 30_000 });
    await a.locator("[data-slot='docblocks/database-filter']").click();
    const popover = a.locator("[data-slot='popover-content']", {
      has: a.locator("[data-slot='docblocks/filter-builder']"),
    });
    await expect(popover).toBeVisible(SETTLE);

    // The parent's container's stand (the widened stand): the popover stands
    // the `min-w`'s floor (the `w-96`'s former's stand is gone) — wide
    // enough for the condition's field + operator + value's single row.
    // The computed width (not the bounding box — the open's zoom's animation
    // scales the box under the measurement).
    const width = await popover.evaluate((el) => parseFloat(getComputedStyle(el).width));
    expect(width).toBeGreaterThanOrEqual(440);

    // The condition's row: the field's select and the value's input stand on
    // the same center line (no wrap — the value fills the row's leftover).
    await a.locator("[data-slot='docblocks/filter-add-condition']").first().click();
    const row = a.locator("[data-slot='docblocks/filter-condition']").first();
    const centers = await row
      .locator("[data-slot='docblocks/filter-column'], [data-slot='docblocks/filter-value']")
      .evaluateAll((els) =>
        els.map((el) => {
          const rect = el.getBoundingClientRect();
          return rect.top + rect.height / 2;
        })
      );
    expect(centers.length).toBe(2);
    expect(Math.abs(centers[0]! - centers[1]!)).toBeLessThan(1);

    // The connector's line: the row's gutter tick stands a visible (not
    // transparent) frame over the popover's background.
    const tickBg = await row
      .locator("span[aria-hidden]")
      .first()
      .evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(tickBg).not.toBe("rgba(0, 0, 0, 0)");

    // The logic's pill stands the prominent's fill (not the track's muted's
    // stand — the pill reads as the selection's highlight).
    const pillBg = await popover
      .locator("[data-slot='docblocks/filter-logic-pill']")
      .first()
      .evaluate((el) => getComputedStyle(el).backgroundColor);
    const trackBg = await popover
      .locator("[data-slot='docblocks/filter-logic']")
      .first()
      .evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(pillBg).not.toBe(trackBg);

    // The footer's apply/clear stand over the separator's line (not stuck to
    // the add rows).
    const footerBorder = await popover
      .locator("[data-slot='docblocks/filter-footer']")
      .evaluate((el) => getComputedStyle(el).borderTopWidth);
    expect(footerBorder).toBe("1px");

    // The nested's group stands the numbered's header + the remove's entry +
    // its own logic's selector over the card.
    await a.locator("[data-slot='docblocks/filter-add-group']").first().click();
    const card = a.locator("[data-slot='docblocks/filter-nested']").first();
    await expect(card.locator("[data-slot='docblocks/filter-group-header']")).toHaveText("Group 1", SETTLE);
    await expect(card.locator("[data-slot='docblocks/filter-remove-group']")).toBeVisible(SETTLE);
    await expect(card.locator("[data-slot='docblocks/filter-logic']")).toBeVisible(SETTLE);

    // The footer's apply stands disabled over the missing's value (the
    // draft's no-commit's stand).
    await expect(a.locator("[data-slot='docblocks/filter-apply']")).toBeDisabled(SETTLE);
    await a.keyboard.press("Escape");
  } finally {
    await context.close();
  }
});

test("a filtered-out inserted row keeps the orange outline until focus leaves", async ({ browser }) => {
  const context = await editorContext(browser);
  const a = await context.newPage();
  try {
    await openPane(a, "a", "db-filtered-insert", { light: true });
    const { tableId, titleId } = await a.evaluate(async () => {
      const bridge = window.__bridge!;
      const ctx = () => ({ operationId: crypto.randomUUID(), issuedAt: new Date().toISOString() });
      const table = await bridge.createTable({ name: "Filtered insert" }, ctx());
      const tableId = table.result.id;
      const title = await bridge.createColumn(
        tableId,
        { column: { name: "Title", type: "text", position: 0, nullable: true } },
        ctx()
      );
      const titleId = title.result.id;
      await bridge.batchRows(
        tableId,
        { ops: [{ op: "create", row: { [titleId]: "shown" }, beforeRowId: null }] },
        ctx()
      );
      window.__paneDocs!.a!.insertBlock("database", {
        tableId,
        filter: { logic: "and", conditions: [{ columnId: titleId, op: "is", value: "shown" }] },
      });
      return { tableId, titleId };
    });
    await expect(a.locator("[data-slot='docblocks/database-grid']")).toHaveCount(1, SETTLE);

    await a.locator("[data-slot='docblocks/database-add-row']").click();
    const pending = a.locator("[data-slot='docblocks/database-cell'][data-filter-pending='true']");
    await expect(pending).toHaveCount(1, SETTLE);
    const light = await pending.evaluate((el) => ({
      token: getComputedStyle(el).getPropertyValue("--docblocks-database-pending-row-border-color").trim(),
      shadow: getComputedStyle(el).boxShadow,
    }));
    expect(light.token).toBe("#d97706");
    expect(light.shadow).not.toBe("none");
    await a.evaluate(() => document.documentElement.classList.add("dark"));
    const dark = await pending.evaluate((el) => ({
      token: getComputedStyle(el).getPropertyValue("--docblocks-database-pending-row-border-color").trim(),
      shadow: getComputedStyle(el).boxShadow,
    }));
    expect(dark.token).toBe("#f59e0b");
    expect(dark.shadow).not.toBe(light.shadow);
    await a.evaluate(() => document.documentElement.classList.remove("dark"));

    const editor = a.locator("[data-slot='docblocks/database-cell-multiline']");
    await expect(editor).toBeFocused(SETTLE);
    await editor.fill("outside the filter");
    await a.locator("[data-slot='docblocks/database-columns']").click();
    await expect(pending).toHaveCount(0, SETTLE);
    await expect
      .poll(
        () =>
          a.evaluate(
            async ({ tableId, titleId }) => {
              const snapshot = await window.__bridge!.snapshotTable(tableId, {});
              return snapshot.page.rows.some((row) => row.cells[titleId] === "outside the filter");
            },
            { tableId, titleId }
          ),
        SETTLE
      )
      .toBe(true);
  } finally {
    await context.close();
  }
});

test("the columns popover restores hidden columns and reorders by keyboard and mouse", async ({ browser }) => {
  const context = await editorContext(browser);
  const a = await context.newPage();
  try {
    await openPane(a, "a", "db-column-manager");
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
    await a.mouse.move(target.x + target.width / 2, target.y + target.height + 12, { steps: 12 });
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
    await openPane(a, "a", "ext04-colorder-" + Math.random().toString(36).slice(2, 8));

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

    const gridA = a.locator("[data-testid=\"doc-a\"] [data-slot='docblocks/database-grid']");
    await expect(gridA).toHaveCount(1, SETTLE);

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

test("the header's name stands the px-2 padding (the text stands over the data's text; the rename stands)", async ({
  browser,
}) => {
  const context = await editorContext(browser);
  const a = await context.newPage();
  try {
    await openPane(a, "a", "ext04-header-pad-" + Math.random().toString(36).slice(2, 8));

    const { tableId, colId } = await a.evaluate(async () => {
      const bridge = window.__bridge!;
      const ctx = () => ({ operationId: crypto.randomUUID(), issuedAt: new Date().toISOString() });
      const table = await bridge.createTable({ name: "header-pad-" + Date.now() }, ctx());
      const id = table.result.id;
      const column = await bridge.createColumn(
        id,
        { column: { name: "Alpha Column Name", type: "text", position: 0, nullable: true } },
        ctx()
      );
      await bridge.batchRows(
        id,
        { ops: [{ op: "create", row: { [column.result.id]: "DataCellText" }, beforeRowId: null }] },
        ctx()
      );
      return { tableId: id, colId: column.result.id };
    });
    await a.evaluate((tableId) => window.__paneDocs!.a!.insertBlock("database", { tableId }), tableId);

    const grid = a.locator("[data-slot='docblocks/database-grid']");
    await expect(grid).toHaveCount(1, SETTLE);

    // The header cell's computed padding-x stands 8px (the px-2 — the
    // `4px 8px` token's no-longer-misread padding-inline).
    const headerPadding = () =>
      a.locator(`[data-slot='docblocks/database-header-cell'][data-column-id='${colId}']`).evaluate((el) => {
        const cs = getComputedStyle(el);
        return { left: cs.paddingLeft, right: cs.paddingRight };
      });
    // The type's icon stands the left (the px-2's 8px padding edge — the
    // icon is inside the padding), and the name stands to the right of it
    // (the icon is left of the name; the data-alignment's former stand is
    // the icon's now, the name's shifted by the icon's width + gap).
    const iconStands = () =>
      a.evaluate((colId) => {
        const grid = document.querySelector('[data-slot="docblocks/database-grid"]')!;
        const headerCell = grid.querySelector(
          `[data-slot="docblocks/database-header-cell"][data-column-id="${colId}"]`
        ) as HTMLElement;
        const icon = headerCell.querySelector(":scope > svg") as HTMLElement;
        const nameSpan = headerCell.querySelector(":scope > span") as HTMLElement;
        const cellRect = headerCell.getBoundingClientRect();
        const iconRect = icon.getBoundingClientRect();
        const nameRect = nameSpan.getBoundingClientRect();
        return {
          // The icon's left edge stands the cell's left padding (the px-2's
          // 8px — the icon is inside the padding, not over it).
          iconLeftOffset: iconRect.left - cellRect.left,
          // The name stands to the right of the icon (the icon's left of the
          // name — the gap is between them).
          nameRightOfIcon: nameRect.left >= iconRect.right - 1,
        };
      }, colId);

    // The dark stand (the harness's default): the padding-x = 8px, the
    // icon stands the left (the padding's edge), the name stands right of it.
    expect(await headerPadding()).toEqual({ left: "8px", right: "8px" });
    let stands = await iconStands();
    expect(Math.abs(stands.iconLeftOffset - 8)).toBeLessThan(1);
    expect(stands.nameRightOfIcon).toBe(true);

    // The light stand: the padding stands (the token is the theme-independent),
    // the icon's position stands.
    await a.evaluate(() => document.documentElement.classList.remove("dark"));
    await expect.poll(async () => (await headerPadding()).left, SETTLE).toBe("8px");
    stands = await iconStands();
    expect(Math.abs(stands.iconLeftOffset - 8)).toBeLessThan(1);
    expect(stands.nameRightOfIcon).toBe(true);

    // The rename stands (the Ellipsis's press + the rename commit — the
    // geometry / the hit stand unaffected by the padding): the column's
    // name updates over the wire.
    const headerCell = a.locator(`[data-slot='docblocks/database-header-cell'][data-column-id='${colId}']`);
    await headerCell.locator("[data-slot='docblocks/database-column-menu']").click();
    const rename = a.locator("[data-slot='docblocks/database-rename-input']");
    await expect(rename).toBeVisible(SETTLE);
    await rename.fill("Renamed Column");
    await a.keyboard.press("Enter");
    await expect.poll(async () => (await headerCell.textContent())!.includes("Renamed Column"), SETTLE).toBe(true);
  } finally {
    await context.close();
  }
});

test("the enum cell stands the package's EnumPicker (the pick commits over the pane's bridge; the doc stands); the number cell suppresses the spin buttons", async ({
  browser,
}) => {
  const context = await editorContext(browser);
  const a = await context.newPage();
  try {
    await openPane(a, "a", "ext04-cells-" + Math.random().toString(36).slice(2, 8));

    const demo = await bridgeDemoTable(a);
    const dbId = (await a.evaluate((tableId) => window.__paneDocs!.a!.insertBlock("database", { tableId }), demo.id))!;

    const gridA = a.locator("[data-slot='docblocks/database-grid']");
    await expect(gridA).toHaveCount(1, SETTLE);
    const { Status: statusColId } = await demoColumns(a, demo.id, ["Status"]);
    const doingId = await statusOptionId(a, "doing");

    // The single-enum cell stands the package's EnumPicker trigger (the chip
    // over the popover — the Radix's Select is out over the enum), not a
    // native <select> (the demo table's status column): the cell stands the
    // display, the trigger is the inner chip, and the list opens on the
    // double press (the single press is the selection).
    const enumCellA = a.locator(`[data-slot='docblocks/database-cell'][data-column-id='${statusColId}']`).first();
    const enumTriggerA = enumCellA.locator("[data-slot='docblocks/database-enum-picker-trigger']");
    await expect(enumTriggerA).toHaveCount(1, SETTLE);
    await expect(enumCellA).toHaveText("todo", SETTLE);
    await expect(enumCellA.locator("select")).toHaveCount(0);

    // The number cell stands the spin-button suppression (the structural
    // rule reaches the inner edit input: the webkit spin pseudo elements are
    // gone, the appearance is a plain text field).
    const numberCellA = a.locator("[data-slot='docblocks/database-cell'][data-kind='number']").first();
    await expect(numberCellA).toHaveCount(1, SETTLE);
    await numberCellA.dblclick();
    const numberInput = numberCellA.locator("input[type='number']");
    await expect(numberInput).toBeVisible(SETTLE);
    const numberStyle = await numberInput.evaluate((el) => {
      const style = getComputedStyle(el);
      return { appearance: style.appearance };
    });
    expect(numberStyle.appearance).toBe("textfield");
    await a.keyboard.press("Escape");

    // The pick over the real mouse: the double press opens the picker, the
    // "doing" pick commits over the pane's bridge (the row is the consumer's
    // data — the pane's bridge stands the committed row, the doc stands
    // unchanged).
    await enumCellA.dblclick();
    const option = a.locator(`[data-slot='docblocks/database-enum-picker-row'][data-option-value='${doingId}']`);
    await expect(option).toBeVisible(SETTLE);
    await option.click();
    await expect(enumCellA).toHaveText("doing", SETTLE);
    const row = await a.evaluate(
      async ({ tableId, statusColumnId }) => {
        const snapshot = await window.__bridge!.snapshotTable(tableId, {});
        return { status: snapshot.page.rows[0]?.cells[statusColumnId] ?? null };
      },
      { tableId: demo.id, statusColumnId: statusColId }
    );
    expect(row.status).toBe(doingId);
    const json = await a.evaluate((id) => {
      const block = window.__paneDocs!.a!.toJSON().blocks[id];
      return block?.type === "database"
        ? { columns: (block.attrs as Record<string, unknown>).columns, rows: block.rows }
        : null;
    }, dbId);
    // The doc holds the reference only: no inline schema, and the rows map
    // stands empty (the row data is the consumer's database, not the doc).
    expect(json).toEqual({ columns: undefined, rows: {} });
  } finally {
    await context.close();
  }
});

test("the date cell stands the DatePicker (the pick commits over the pane's bridge); the grid scroller stands the thin scrollbar", async ({
  browser,
}) => {
  const context = await editorContext(browser);
  const a = await context.newPage();
  try {
    await openPane(a, "a", "ext04-datecell-" + Math.random().toString(36).slice(2, 8));

    const projectsId = await a.evaluate(async () => {
      const tables = await window.__bridge!.listTables();
      return tables.find((table) => table.name === "Projects")?.id ?? null;
    });
    expect(projectsId).not.toBeNull();
    await a.evaluate((tableId) => window.__paneDocs!.a!.insertBlock("database", { tableId }), projectsId!);
    const gridA = a.locator("[data-slot='docblocks/database-grid']");
    await expect(gridA.first()).toBeVisible(SETTLE);
    const { Started: startedColId } = await demoColumns(a, projectsId!, ["Started"]);

    // The grid's horizontal scroller stands the ScrollArea's thin-scrollbar
    // contract (the theme's border color), not the browser's default bar.
    // The engine's stand: the firefox's getComputedStyle stands no
    // `scrollbar-width` (the computed value is `none` over every element,
    // the scrollable's included), so the pin stands the chromium's read.
    if (test.info().project.name === "chromium") {
      expect(await gridA.first().evaluate((el) => getComputedStyle(el).scrollbarWidth)).toBe("thin");
    }

    // The date cell stands the display (the compact date; the native
    // <input type="date"> and the trigger button are gone): the calendar
    // opens on the double press over the cell itself.
    const dateCellA = a.locator(`[data-slot='docblocks/database-cell'][data-column-id='${startedColId}']`).first();
    await expect(dateCellA).toBeVisible(SETTLE);
    expect(await dateCellA.evaluate((el) => el.tagName)).toBe("DIV");

    // The pick over the real mouse: the calendar stands in the portaled
    // content (the opened month is "today's" — the pick is derived from the
    // caption, so the pin stands run-date-independent), the day click
    // commits the ISO date to the bridge and the popover closes.
    await dateCellA.dblclick();
    const calendar = a.locator("[data-slot='calendar']");
    await expect(calendar).toBeVisible(SETTLE);
    const caption = await calendar.locator(".rdp-month_caption").textContent();
    expect(caption).toMatch(/^[A-Z][a-z]+ \d{4}$/);
    const months = [
      "January",
      "February",
      "March",
      "April",
      "May",
      "June",
      "July",
      "August",
      "September",
      "October",
      "November",
      "December",
    ];
    const monthName = caption!.split(" ")[0]!;
    const isoMonth = String(months.indexOf(monthName) + 1).padStart(2, "0");
    const expected = `${caption!.split(" ")[1]!}-${isoMonth}-15`;
    // The day buttons' accessible names are the full localized dates
    // ("<weekday>, <month> 15th, <year>") — match on the month + day.
    await calendar.getByRole("button", { name: new RegExp(`${monthName} 15`) }).click();
    await expect(calendar).toBeHidden(SETTLE);
    // The cell stands the compact label (the dd.MM.yyyy shape; the dots are
    // escaped).
    const label = new RegExp(`15\\.${isoMonth}\\.2026`);
    await expect(dateCellA).toHaveText(label, SETTLE);

    // The commit stands over the pane's bridge (the row's data is the
    // consumer's data — the doc stands).
    const row = await a.evaluate(
      async ({ tableId, startedColumnId }) => {
        const page = await window.__bridge!.snapshotTable(tableId, {});
        return { started: page.page.rows[0]?.cells[startedColumnId] ?? null };
      },
      { tableId: projectsId!, startedColumnId: startedColId }
    );
    expect(row.started).toBe(expected);
  } finally {
    await context.close();
  }
});

test("the header's right-edge seam resizes the column (the columnWidths attr over the wire; the no-op drag stands none)", async ({
  browser,
}) => {
  const { a, close } = await twoPanes(browser, "ext04-colwidth");

  const demo = await bridgeDemoTable(a);
  const dbId = (await a.evaluate((tableId) => window.__paneDocs!.a!.insertBlock("database", { tableId }), demo.id))!;
  const gridA = a.locator("[data-slot='docblocks/database-grid']");
  await expect(gridA).toHaveCount(1, SETTLE);

  const attrsOf = () =>
    a.evaluate(
      (id) =>
        (window.__paneDocs!.a!.toJSON().blocks[id]?.attrs as Record<string, unknown> | undefined)?.columnWidths ?? null,
      dbId
    );

  const { Title: titleColId } = await demoColumns(a, demo.id, ["Title"]);
  const titleHeader = a.locator(`[data-slot='docblocks/database-header-cell'][data-column-id='${titleColId}']`);
  await expect(titleHeader).toBeVisible(SETTLE);
  // The seam stands at the title's right edge (the first visible column's
  // index 0), invisible at rest, revealed on the header's hover.
  const seam = a.locator("[data-slot='docblocks/database-col-resize'][data-index='0']");
  await expect(seam).toHaveCount(1, SETTLE);
  await titleHeader.hover();
  await expect(seam).toBeVisible(SETTLE);

  const titleWidth0 = (await titleHeader.boundingBox())!.width;
  const seamBox = (await seam.boundingBox())!;
  await a.mouse.move(seamBox.x + seamBox.width / 2, seamBox.y + seamBox.height / 2);
  await a.mouse.down();
  await a.mouse.move(seamBox.x + seamBox.width / 2 + 48, seamBox.y + seamBox.height / 2, { steps: 6 });

  // The live preview stands view state (the doc stands until the release).
  expect(await attrsOf()).toBeNull();
  const titleWidthLive = (await titleHeader.boundingBox())!.width;
  expect(titleWidthLive - titleWidth0).toBeGreaterThanOrEqual(40);

  // The release commits: the columnWidths attr stands (one entry per
  // visible column — the resized one + the measured stand of the rest),
  // the header's width stands the committed px.
  await a.mouse.up();
  await expect.poll(async () => await attrsOf(), SETTLE).toEqual(expect.arrayContaining([expect.any(Number)]));
  const widths = (await attrsOf()) as number[];
  expect(widths.length).toBe(4);
  const titleWidthAfter = (await titleHeader.boundingBox())!.width;
  expect(Math.abs(titleWidthAfter - widths[0]!)).toBeLessThan(3);
  expect(widths[0]! - titleWidth0).toBeGreaterThanOrEqual(40);

  // The no-op drag (the 0 px release) stands no write (the attr stands).
  const seam1 = a.locator("[data-slot='docblocks/database-col-resize'][data-index='1']");
  await titleHeader.hover();
  const box1 = (await seam1.boundingBox())!;
  await a.mouse.move(box1.x + box1.width / 2, box1.y + box1.height / 2);
  await a.mouse.down();
  await a.mouse.up();
  expect(await attrsOf()).toEqual(widths);

  await close();
});

test("two grids on one page stand their own measurement (the seam's commit reads its own grid's cells)", async ({
  browser,
}) => {
  const { a, close } = await twoPanes(browser, "ext04-multigrid");

  // Two blocks over the same table: the page stands two grids at once (the
  // measurement's scope — a grid must not read the foreign grid's cells).
  const demo = await bridgeDemoTable(a);
  const dbIdA = (await a.evaluate((tableId) => window.__paneDocs!.a!.insertBlock("database", { tableId }), demo.id))!;
  const dbIdB = (await a.evaluate((tableId) => window.__paneDocs!.a!.insertBlock("database", { tableId }), demo.id))!;
  const gridOf = (id: string) => a.locator(`[data-block-id='${id}']`);
  const seamOf = (id: string, index: number) =>
    gridOf(id).locator(`[data-slot='docblocks/database-col-resize'][data-index='${index}']`);
  const headerCellOf = (id: string, index: number) =>
    gridOf(id).locator("[data-slot='docblocks/database-header-cell']").nth(index);
  const widthsOf = (id: string) =>
    a.evaluate(
      (blockId) =>
        (window.__paneDocs!.a!.toJSON().blocks[blockId]?.attrs as Record<string, unknown> | undefined)?.columnWidths ??
        null,
      id
    );

  await expect(gridOf(dbIdA).locator("[data-slot='docblocks/database-grid']")).toBeVisible(SETTLE);
  await expect(gridOf(dbIdB).locator("[data-slot='docblocks/database-grid']")).toBeVisible(SETTLE);

  // The grid A's columns 0 + 1 widen (the commit's stand over the default).
  const widen = async (id: string, index: number) => {
    await headerCellOf(id, index).hover();
    const seam = (await seamOf(id, index).boundingBox())!;
    await a.mouse.move(seam.x + 1, seam.y + 1);
    await a.mouse.down();
    await a.mouse.move(seam.x + 1 + 96, seam.y + 1, { steps: 6 });
    await a.mouse.up();
  };
  await widen(dbIdA, 0);
  await expect.poll(async () => await widthsOf(dbIdA), SETTLE).toEqual(expect.arrayContaining([expect.any(Number)]));
  await widen(dbIdA, 1);
  await expect.poll(async () => await widthsOf(dbIdA), SETTLE).not.toBeNull();
  const widthsA = (await widthsOf(dbIdA)) as number[];
  expect(widthsA[0]!).toBeGreaterThan(190);
  expect(widthsA[1]!).toBeGreaterThan(190);

  // The grid B's commit reads its own cells: the non-dragged column 1 must
  // stand its own measured width (not the grid A's widened stand — the
  // document-wide query would stand the grid A's cell over the grid B's
  // commit).
  await headerCellOf(dbIdB, 0).hover();
  const seamB = (await seamOf(dbIdB, 0).boundingBox())!;
  await a.mouse.move(seamB.x + 1, seamB.y + 1);
  await a.mouse.down();
  await a.mouse.move(seamB.x + 1 + 2, seamB.y + 1, { steps: 3 });
  await a.mouse.up();
  await expect.poll(async () => await widthsOf(dbIdB), SETTLE).toEqual(expect.arrayContaining([expect.any(Number)]));
  const widthsB = (await widthsOf(dbIdB)) as number[];
  expect(
    widthsB[1]!,
    "the grid B's column 1 must stand its own measurement (not the grid A's widened stand)"
  ).toBeLessThan(180);

  await close();
});

test("the datetime cell stands the calendar + the time box (the time/date order, the same-day toggle; the commit over the pane's bridge)", async ({
  browser,
}) => {
  const context = await editorContext(browser);
  const a = await context.newPage();
  try {
    await openPane(a, "a", "ext04-datetimecell-" + Math.random().toString(36).slice(2, 8));

    const demo = await bridgeDemoTable(a);
    await a.evaluate((tableId) => window.__paneDocs!.a!.insertBlock("database", { tableId }), demo.id);
    // The timestamptz column + the seed value: the cell stands the picker.
    const atColId = await a.evaluate(async (tableId) => {
      const bridge = window.__bridge!;
      const ctx = () => ({ operationId: crypto.randomUUID(), issuedAt: new Date().toISOString() });
      const { columns } = await bridge.describeTable(tableId);
      const atCol = await bridge.createColumn(
        tableId,
        { column: { name: "At", type: "timestamptz", position: columns.length, nullable: true } },
        ctx()
      );
      const page = await bridge.snapshotTable(tableId, {});
      const rowId = page.page.rows[0]!.id;
      await bridge.batchRows(
        tableId,
        { ops: [{ op: "update", rowId, cells: { [atCol.result.id]: "2026-03-10T18:00" } }] },
        ctx()
      );
      return atCol.result.id;
    }, demo.id);

    const cellA = a.locator(`[data-slot='docblocks/database-cell'][data-column-id='${atColId}']`).first();
    // The first row's value in the "At" column over the pane's bridge's read.
    const readAt = () =>
      a.evaluate(
        async ({ tableId, atColumnId }) => {
          const page = await window.__bridge!.snapshotTable(tableId, {});
          return page.page.rows[0]?.cells[atColumnId] ?? null;
        },
        { tableId: demo.id, atColumnId: atColId }
      );
    await expect(cellA).toBeVisible(SETTLE);
    // The cell stands the display (the compact date + time; the native
    // <input type="datetime-local"> and the trigger button are gone), and
    // the picker opens on the double press over the cell itself.
    expect(await cellA.evaluate((el) => el.tagName)).toBe("DIV");
    expect(await cellA.locator("input").count()).toBe(0);
    await expect(cellA).toHaveText("10.03.2026 18:00", SETTLE);

    // The pick over the real mouse: the calendar + the time box stand in the
    // portaled content; the day click + the minutes stand the draft; the
    // Escape commits the ISO date-time to the bridge.
    await cellA.dblclick();
    const picker = a.locator("[data-slot='popover-content']");
    await expect(picker).toBeVisible(SETTLE);
    const caption = await picker.locator(".rdp-month_caption").textContent();
    expect(caption).toMatch(/^[A-Z][a-z]+ \d{4}$/);
    const monthName = caption!.split(" ")[0]!;
    await picker.getByRole("button", { name: new RegExp(`${monthName} 15`) }).click();
    const minutes = picker.locator("[data-slot='time-segments'] [data-segment='m']");
    await expect(minutes).toBeVisible(SETTLE);
    await minutes.fill("30");
    await a.keyboard.press("Escape");
    await expect(picker).toBeHidden(SETTLE);

    // The commit stands the ISO string in the pane's bridge (the doc stands
    // — the row is the consumer's data).
    const row = await readAt();
    const isoMonth = String(monthsIndexOf(monthName) + 1).padStart(2, "0");
    expect(row).toBe(`2026-${isoMonth}-15T18:30`);
    // The trigger stands the zero-padded compact label (the dd.MM.yyyy shape;
    // the dots are escaped — the label's format is the fixed dd.MM.yyyy).
    const label = new RegExp(`15\\.${isoMonth}\\.2026 18:30`);
    await expect(cellA).toHaveText(label, SETTLE);

    // The reverse order (the flow): the time stands first, the day's
    // pick after, the real outside press closes — the deferred commit stands
    // the date + the time (the draft's time survives the day's click).
    await cellA.dblclick();
    await expect(picker).toBeVisible(SETTLE);
    const hours = picker.locator("[data-slot='time-segments'] [data-segment='h']");
    await hours.fill("07");
    await picker.locator("[data-slot='time-segments'] [data-segment='m']").fill("45");
    await picker.getByRole("button", { name: new RegExp(`${monthName} 20`) }).click();
    // The outside press (the real mouse over the editor's left padding —
    // outside the portaled popover and the grid's own toolbar): the close
    // commits the draft (the grid's session clear stands no radix close —
    // the cell's teardown stand commits the in-flight draft).
    const gridBox = await a.locator("[data-slot='docblocks/database-grid']").first().boundingBox();
    await a.mouse.click(10, gridBox!.y + 40);
    await expect(picker).toBeHidden(SETTLE);
    const rowAfterReverse = await readAt();
    expect(rowAfterReverse).toBe(`2026-${isoMonth}-20T07:45`);
    const reverseLabel = new RegExp(`20\\.${isoMonth}\\.2026 07:45`);
    await expect(cellA).toHaveText(reverseLabel, SETTLE);

    // The same-day re-pick (the day-picker's toggle) stands no reset: the
    // Escape close commits nothing (the value stands, no wire write).
    await cellA.dblclick();
    await expect(picker).toBeVisible(SETTLE);
    await picker.getByRole("button", { name: new RegExp(`${monthName} 20`) }).click();
    await a.keyboard.press("Escape");
    await expect(picker).toBeHidden(SETTLE);
    const rowAfterToggle = await readAt();
    expect(rowAfterToggle).toBe(`2026-${isoMonth}-20T07:45`);
  } finally {
    await context.close();
  }
});

test("the cell's press model: the single press selects, the double press edits, the drag stands the region, the Delete clears (the commit over the pane's bridge)", async ({
  browser,
}) => {
  const context = await editorContext(browser);
  const a = await context.newPage();
  try {
    await openPane(a, "a", "ext04-cellmodel-" + Math.random().toString(36).slice(2, 8));

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

test("the cell's mouse-blur: the typed draft commits over the other cell's / the outside press (the focus model stands)", async ({
  browser,
}) => {
  const context = await editorContext(browser);
  const a = await context.newPage();
  try {
    await openPane(a, "a", "ext04-mouseblur-" + Math.random().toString(36).slice(2, 8));

    const demo = await bridgeDemoTable(a);
    const dbId = await a.evaluate((tableId) => window.__paneDocs!.a!.insertBlock("database", { tableId }), demo.id);
    const gridA = a.locator("[data-slot='docblocks/database-grid']");
    await expect(gridA.first()).toBeVisible(SETTLE);
    const { Title: titleColId, Count: countColId } = await demoColumns(a, demo.id, ["Title", "Count"]);

    const cell = (r: number, c: number) =>
      a.locator(`[data-slot='docblocks/database-cell'][data-row='${r}'][data-col='${c}']`);
    const firstRow = () =>
      a.evaluate(async (tableId) => {
        const page = await window.__bridge!.snapshotTable(tableId, {});
        return page.page.rows[0]?.cells ?? null;
      }, demo.id);

    // Case 1 — the other cell's press: the typed title draft commits over
    // the session's swap (the draft does not die with the editor's
    // unmount). The press stands over the NEIGHBOR column's cell — the
    // floating editor covers the cell below its own column, so a press
    // over it would stand the editor's own interaction, not the session's
    // swap.
    await cell(0, 0).dblclick();
    const titleInput = a.locator("[data-slot='docblocks/database-cell-multiline']");
    await expect(titleInput).toBeVisible(SETTLE);
    await titleInput.fill("First task edited");
    await cell(1, 1).click();
    await expect(cell(0, 0)).toHaveText("First task edited", SETTLE);
    expect((await firstRow())?.[titleColId]).toBe("First task edited");

    // Case 2 — the outside press: the typed number draft commits over the
    // real mouse over the editor's left padding (outside the grid + the
    // portaled content).
    await cell(0, 1).dblclick();
    const countInput = cell(0, 1).locator("[data-slot='docblocks/database-cell-input']");
    await expect(countInput).toBeVisible(SETTLE);
    await countInput.fill("19");
    const gridBox = await gridA.first().boundingBox();
    await a.mouse.click(10, gridBox!.y + 40);
    await expect(cell(0, 1)).toHaveText("19", SETTLE);
    expect((await firstRow())?.[countColId]).toBe(19);

    // Case 3 — the focus model: the press commit parks the focus on the
    // table (the hotkeys reach the grid's undo stack) — the Control+Z
    // stands the previous value back.
    await cell(1, 1).dblclick();
    const count2Input = cell(1, 1).locator("[data-slot='docblocks/database-cell-input']");
    await expect(count2Input).toBeVisible(SETTLE);
    await count2Input.fill("21");
    await cell(0, 1).click();
    await expect(cell(1, 1)).toHaveText("21", SETTLE);
    await a.keyboard.press("Control+z");
    await expect(cell(1, 1)).toHaveText("2", SETTLE);

    // Case 4 — the header's rename (the same class): the typed name commits
    // over the cell's press (the blur); the bridge's renameTable stands in
    // the pane's grid, the block's JSON stands the reference only (no doc
    // write).
    await a.locator("[data-slot='docblocks/database-name']").click();
    const nameInput = a.locator("[data-slot='docblocks/database-name-input']");
    await expect(nameInput).toBeVisible(SETTLE);
    await nameInput.fill("Mouse-blur Board");
    await cell(0, 0).click();
    await expect(a.locator("[data-slot='docblocks/database-name']")).toHaveText("Mouse-blur Board", SETTLE);
    const dbAttrs = await a.evaluate((id) => {
      const block = window.__paneDocs!.a!.toJSON().blocks[id]!;
      return { tableId: block.attrs?.tableId, name: block.attrs?.name };
    }, dbId);
    expect(dbAttrs.tableId).toBe(demo.id);
    expect(dbAttrs.name).toBeUndefined();
  } finally {
    await context.close();
  }
});

test("the number column: the create form's attributes stand the cell's display (the prefix / the thousands over the pane's bridge; the raw number stays the data)", async ({
  browser,
}) => {
  const context = await editorContext(browser);
  const a = await context.newPage();
  try {
    await openPane(a, "a", "ext04-numbercol-" + Math.random().toString(36).slice(2, 8));

    const demo = await bridgeDemoTable(a);
    await a.evaluate((tableId) => window.__paneDocs!.a!.insertBlock("database", { tableId }), demo.id);

    // The create over the grid's form: the plus's menu → the Integer entry →
    // the attribute form (the thousands' separator + the prefix / the
    // suffix) → the Add commits the column's data to the bridge. The integer
    // stands the `decimals: 0` stand (the display keeps the raw integer), so
    // the value's frame (the prefix / the thousands / the suffix) stands as-is.
    await a.locator("[data-slot='docblocks/database-add-column-trigger']").click();
    const menu = a.locator("[data-slot='dropdown-menu-content']");
    await expect(menu).toBeVisible(SETTLE);
    await menu.locator("[data-column-entry='integer']").click();
    const form = a.locator("[data-slot='docblocks/database-add-column-form']");
    await expect(form).toBeVisible(SETTLE);
    await form.locator("[data-slot='docblocks/database-add-column-thousands']").click();
    await form.locator("[data-slot='docblocks/database-add-column-prefix']").fill("AAA");
    await form.locator("[data-slot='docblocks/database-add-column-suffix']").fill("BBB");
    await form.locator("[data-slot='docblocks/database-add-column-create']").click();
    // The demo table stands 4 columns → the created one is the fifth.
    const numberColId = await awaitedLastColumnId(a, demo.id, 5);
    await expect(
      a.locator(`[data-slot='docblocks/database-header-cell'][data-column-id='${numberColId}']`)
    ).toBeVisible(SETTLE);

    // The value over the pane's bridge (the row is the consumer's data): the
    // display stands the column's format in the pane's grid, the data keeps
    // the raw number.
    await a.evaluate(
      async ({ tableId, columnId }) => {
        const bridge = window.__bridge!;
        const page = await bridge.snapshotTable(tableId, {});
        const rowId = page.page.rows[0]!.id;
        await bridge.batchRows(
          tableId,
          { ops: [{ op: "update", rowId, cells: { [columnId]: 555222 } }] },
          { operationId: crypto.randomUUID(), issuedAt: new Date().toISOString() }
        );
      },
      { tableId: demo.id, columnId: numberColId }
    );

    const cellA = a.locator(`[data-slot='docblocks/database-cell'][data-column-id='${numberColId}']`).first();
    await expect(cellA).toHaveText("AAA 555 222 BBB", SETTLE);
    const row = await a.evaluate(
      async ({ tableId, columnId }) => {
        const page = await window.__bridge!.snapshotTable(tableId, {});
        return page.page.rows[0]?.cells[columnId] ?? null;
      },
      { tableId: demo.id, columnId: numberColId }
    );
    expect(row).toBe(555222);

    // The cell's edit stands the column's step stand (the integer's step):
    // the double press opens the number input.
    await cellA.dblclick();
    const input = cellA.locator("input[type='number']");
    await expect(input).toBeVisible(SETTLE);
    await a.keyboard.press("Escape");
  } finally {
    await context.close();
  }
});

test("the add-column form's ref stand (the enum's options editor over the hidden system table; the row-link's table pick — the existing + the new-table flows)", async ({
  browser,
}) => {
  const context = await editorContext(browser);
  const a = await context.newPage();
  try {
    await openPane(a, "a", "ext04-refpick-" + Math.random().toString(36).slice(2, 8));

    const demo = await bridgeDemoTable(a);
    const blockId = await a.evaluate((tableId) => window.__paneDocs!.a!.insertBlock("database", { tableId }), demo.id);
    const gridA = a.locator(`[data-block-id='${blockId}'] [data-slot='docblocks/database-grid']`);
    await expect(gridA).toBeVisible(SETTLE);
    const trigger = a.locator("[data-slot='docblocks/database-add-column-trigger']");
    const menu = a.locator("[data-slot='dropdown-menu-content']");
    const form = a.locator("[data-slot='docblocks/database-add-column-form']");
    const openForm = async (entry: string) => {
      await trigger.click();
      await expect(menu).toBeVisible(SETTLE);
      await menu.locator(`[data-column-entry='${entry}']`).click();
      await expect(form).toBeVisible(SETTLE);
    };
    const columnOf = async (id: string) =>
      a.evaluate(
        async (args) => {
          const { tableId, colId } = args as { tableId: string; colId: string };
          const schema = await window.__bridge!.describeTable(tableId);
          return schema.columns.find((column) => column.id === colId);
        },
        { tableId: demo.id, colId: id }
      );

    // Flow 1 — the enum's options' editor (the ref table's pick stands
    // none — the options' rows stand the column's own system table, the
    // hidden stand over the `listTables`).
    await openForm("enum");
    expect(await form.locator("[data-slot='docblocks/database-add-column-ref']").count()).toBe(0);
    await expect(form.locator("[data-slot='docblocks/database-enum-options']")).toBeVisible(SETTLE);
    const addOption = async (name: string) => {
      await form.locator("[data-slot='docblocks/database-enum-option-add']").click();
      const inputs = form.locator("[data-slot='docblocks/database-enum-option-name']");
      await inputs.last().fill(name);
    };
    await addOption("good");
    await addOption("bad");
    await form.locator("[data-slot='docblocks/database-add-column-name']").fill("Mood");
    await form.locator("[data-slot='docblocks/database-add-column-create']").click();
    await expect(form).toBeHidden(SETTLE);
    const moodColId = await awaitedLastColumnId(a, demo.id, 5);
    const header1 = gridA.locator(`[data-slot='docblocks/database-header-cell'][data-column-id='${moodColId}']`);
    await expect(header1).toBeVisible(SETTLE);
    const created1 = await columnOf(moodColId);
    expect(created1).toMatchObject({ reference: { kind: "enum" } });
    const moodTableId = created1?.reference?.tableId ?? "";
    const tableNames = await a.evaluate(async () => (await window.__bridge!.listTables()).map((t) => t.name));
    expect(tableNames.map((name) => name.toLowerCase())).not.toContain(moodTableId.toLowerCase());
    const moodRows = await a.evaluate(async (id) => {
      const snapshot = await window.__bridge!.snapshotTable(id, {});
      const nameColumnId = snapshot.columns.find((column) => column.name === "name")?.id ?? null;
      if (nameColumnId === null) return null;
      return snapshot.page.rows.map((row) => row.cells[nameColumnId]);
    }, moodTableId);
    expect(moodRows).toEqual(["good", "bad"]);

    // Flow 2 — the row-link's existing table's pick (the package's Select —
    // the native select is gone; the demo's Projects table stands the
    // pick): the pick commits the column over the pane's bridge.
    await openForm("row-link");
    const refTrigger = form.locator("[data-slot='docblocks/database-add-column-ref']");
    await expect(refTrigger).toBeVisible(SETTLE);
    expect(await form.locator("select").count()).toBe(0);
    await expect(refTrigger).toContainText("— Select a table —");
    await expect(form.locator("[data-slot='docblocks/database-add-column-create']")).toBeDisabled();
    await refTrigger.click();
    const listbox = a.locator("[role='listbox']");
    await expect(listbox).toBeVisible(SETTLE);
    await listbox.locator("[role='option']", { hasText: "Projects" }).click();
    await expect(refTrigger).toHaveText("Projects", SETTLE);
    await form.locator("[data-slot='docblocks/database-add-column-create']").click();
    await expect(form).toBeHidden(SETTLE);
    const rowLinkColId = await awaitedLastColumnId(a, demo.id, 6);
    await expect(
      gridA.locator(`[data-slot='docblocks/database-header-cell'][data-column-id='${rowLinkColId}']`)
    ).toBeVisible(SETTLE);
    expect(await columnOf(rowLinkColId)).toMatchObject({
      reference: { kind: "row", tableId: "table-projects" },
    });

    // Flow 3 — the "New table…" pick (the row-link's): the name's input
    // stands over the form, the create commits the table + the column
    // (the pane's bridge).
    await openForm("row-link");
    const refTrigger2 = form.locator("[data-slot='docblocks/database-add-column-ref']");
    await refTrigger2.click();
    const listbox2 = a.locator("[role='listbox']");
    await expect(listbox2).toBeVisible(SETTLE);
    await listbox2.locator("[role='option']", { hasText: "New table…" }).click();
    await expect(listbox2).toBeHidden(SETTLE);
    const newName = form.locator("[data-slot='docblocks/database-add-column-ref-new']");
    await expect(newName).toBeVisible(SETTLE);
    await newName.fill("People");
    await form.locator("[data-slot='docblocks/database-add-column-create']").click();
    await expect(form).toBeHidden(SETTLE);
    const peopleColId = await awaitedLastColumnId(a, demo.id, 7);
    await expect(
      gridA.locator(`[data-slot='docblocks/database-header-cell'][data-column-id='${peopleColId}']`)
    ).toBeVisible(SETTLE);
    expect(await columnOf(peopleColId)).toMatchObject({
      reference: { kind: "row", tableId: "table-people" },
    });
    const tableNames2 = await a.evaluate(async () => (await window.__bridge!.listTables()).map((t) => t.name));
    expect(tableNames2).toContain("People");
  } finally {
    await context.close();
  }
});

test("the add-column form stands for every type (the name over the create; the Escape closes without the create)", async ({
  browser,
}) => {
  const context = await editorContext(browser);
  const a = await context.newPage();
  try {
    await openPane(a, "a", "ext04-addcolumnform-" + Math.random().toString(36).slice(2, 8));

    const demo = await bridgeDemoTable(a);
    await a.evaluate((tableId) => window.__paneDocs!.a!.insertBlock("database", { tableId }), demo.id);
    const gridA = a.locator("[data-slot='docblocks/database-grid']");
    await expect(gridA.first()).toBeVisible(SETTLE);

    // The Date & time entry stands the create form (the name input; the
    // number's attribute fields stand none — the type-specific block stands
    // for the number only): the name from the input + the create button
    // commit the column over the pane's bridge.
    const trigger = a.locator("[data-slot='docblocks/database-add-column-trigger']");
    await trigger.click();
    const menu = a.locator("[data-slot='dropdown-menu-content']");
    await expect(menu).toBeVisible(SETTLE);
    await menu.locator("[data-column-entry='datetime']").click();
    // The menu's exit stand the close (the exiting popper's wrapper is
    // transparent to pointers only after the unmount — the press over the
    // chip stands no swallow on the second open).
    await expect(menu).toBeHidden(SETTLE);
    const form = a.locator("[data-slot='docblocks/database-add-column-form']");
    await expect(form).toBeVisible(SETTLE);
    const nameInput = form.locator("[data-slot='docblocks/database-add-column-name']");
    expect(await nameInput.inputValue()).toBe("Date & time");
    expect(await form.locator("[data-slot='docblocks/database-add-column-decimals']").count()).toBe(0);
    await nameInput.fill("Launch");
    await form.locator("[data-slot='docblocks/database-add-column-create']").click();
    await expect(form).toBeHidden(SETTLE);
    // The demo table stands 4 columns → the created one is the fifth.
    const launchColId = await awaitedLastColumnId(a, demo.id, 5);
    const headerA = a.locator(`[data-slot='docblocks/database-header-cell'][data-column-id='${launchColId}']`).first();
    await expect(headerA).toHaveText("Launch", SETTLE);

    // The Escape over the form closes without the create (the column count
    // stands — the commit stands the form's button only).
    await trigger.click();
    await menu.locator("[data-column-entry='text']").click();
    await expect(menu).toBeHidden(SETTLE);
    await expect(form).toBeVisible(SETTLE);
    await a.keyboard.press("Escape");
    await expect(form).toBeHidden(SETTLE);
    expect(await columnIds(a, demo.id)).toHaveLength(5);
  } finally {
    await context.close();
  }
});

/** The month name's 0-based index (the caption's month → the ISO part). */
function monthsIndexOf(name: string): number {
  return [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ].indexOf(name);
}

test("the cell's pickers stand the unified row height (the enum / the multi-enum / the row-link's lines; the pick's contract stands)", async ({
  browser,
}) => {
  // A single pane: the heights are the computed styles (no sync needed);
  // a unique room (the relay keeps the room's doc for the dev server's
  // lifetime).
  const context = await editorContext(browser);
  const a = await context.newPage();
  try {
    await openPane(a, "a", `ext04-pickheight-${Math.random().toString(36).slice(2, 8)}`);
    const demo = await bridgeDemoTable(a);
    // The multi-enum + the row-link's columns (over the pane's own bridge:
    // the demo's Statuses dict + the linked People table).
    const colIds = await a.evaluate(async (tableId) => {
      const bridge = window.__bridge!;
      const ctx = () => ({ operationId: crypto.randomUUID(), issuedAt: new Date().toISOString() });
      const { columns } = await bridge.describeTable(tableId);
      const statusColId = columns.find((column) => column.name === "Status")?.id ?? null;
      if (statusColId === null) throw new Error("the demo's Status column stands absent");
      const tagsCol = await bridge.createColumn(
        tableId,
        {
          column: {
            name: "Tags",
            type: "text",
            position: columns.length,
            nullable: true,
            reference: { kind: "enum", tableId: "table-statuses-enum", many: true },
          },
        },
        ctx()
      );
      const people = await bridge.createTable({ name: "People" }, ctx());
      const peopleId = people.result.id;
      const peopleNameCol = await bridge.createColumn(
        peopleId,
        { column: { name: "Name", type: "text", position: 0, nullable: true } },
        ctx()
      );
      const peopleRows = await bridge.batchRows(
        peopleId,
        {
          ops: [
            { op: "create", row: { [peopleNameCol.result.id]: "Ann" }, beforeRowId: null },
            { op: "create", row: { [peopleNameCol.result.id]: "Bo" }, beforeRowId: null },
          ],
        },
        ctx()
      );
      const ownerCol = await bridge.createColumn(
        tableId,
        {
          column: {
            name: "Owner",
            type: "text",
            position: columns.length + 1,
            nullable: true,
            reference: { kind: "row", tableId: peopleId, many: false },
          },
        },
        ctx()
      );
      const enumSnapshot = await bridge.snapshotTable("table-statuses-enum", {});
      const nameColumnId = enumSnapshot.columns.find((column) => column.name === "name")?.id ?? null;
      const todoOption =
        nameColumnId === null ? undefined : enumSnapshot.page.rows.find((row) => row.cells[nameColumnId] === "todo");
      if (todoOption === undefined) throw new Error("the todo option stands absent");
      const page = await bridge.snapshotTable(tableId, {});
      const rowId = page.page.rows[0]!.id;
      await bridge.batchRows(
        tableId,
        {
          ops: [
            {
              op: "update",
              rowId,
              cells: {
                [tagsCol.result.id]: [todoOption.id],
                [ownerCol.result.id]: peopleRows.result.rows[0]!.id,
              },
            },
          ],
        },
        ctx()
      );
      return { tags: tagsCol.result.id, owner: ownerCol.result.id, status: statusColId };
    }, demo.id);
    await a.evaluate((tableId) => window.__paneDocs!.a!.insertBlock("database", { tableId }), demo.id);
    const gridA = a.locator("[data-slot='docblocks/database-grid']");
    await expect(gridA.first()).toBeVisible(SETTLE);
    const cell = (colId: string) =>
      a.locator(`[data-slot='docblocks/database-cell'][data-column-id='${colId}']`).first();

    // The single-enum's list — the grid's main picker (the height's
    // stand: the option's line over the theme's tokens). The picker is
    // the custom popover (the Radix's Select is out over the enum).
    await cell(colIds.status).dblclick();
    await a.waitForTimeout(150);
    const enumRow = a.locator("[data-slot='docblocks/database-enum-picker-row']").first();
    await expect(enumRow).toBeVisible(SETTLE);
    const enumHeight = await enumRow.evaluate((el) => getComputedStyle(el).height);
    await a.keyboard.press("Escape");

    // The multi-enum's list (the checkbox rows — the row's line stands the
    // checkbox's visual; the press stands the row's toggle).
    await cell(colIds.tags).dblclick();
    const multiRow = a.locator("[data-slot='docblocks/database-ref-multi-option']");
    await expect(multiRow.first()).toBeVisible(SETTLE);
    const multiHeight = await multiRow.first().evaluate((el) => getComputedStyle(el).height);
    await a.keyboard.press("Escape");

    // The row-link's picker (the search + the row lines).
    await cell(colIds.owner).dblclick();
    const rowLinkRow = a.locator("[data-slot='docblocks/database-row-picker-row']");
    await expect(rowLinkRow.first()).toBeVisible(SETTLE);
    const rowLinkHeight = await rowLinkRow.first().evaluate((el) => getComputedStyle(el).height);

    // The unified stand: every picker's row stands the main picker's
    // height (the padding + the font-size + the line-height over the
    // theme's tokens).
    expect(multiHeight).toBe(enumHeight);
    expect(rowLinkHeight).toBe(enumHeight);

    // The pick's contract stands (the regression): the enum's pick commits
    // over the bridge (the cell stands the value). The row's option-value
    // stands the option's row id (the pk's stand = the dict's value).
    const doneId = await statusOptionId(a, "done");
    await cell(colIds.status).dblclick();
    await a.waitForTimeout(150);
    const doneRow = a.locator(`[data-slot='docblocks/database-enum-picker-row'][data-option-value='${doneId}']`);
    await expect(doneRow).toBeVisible(SETTLE);
    await doneRow.click();
    await expect(cell(colIds.status)).toHaveText("done", SETTLE);
    const status = await a.evaluate(
      async ({ tableId, columnId }) => {
        const page = await window.__bridge!.snapshotTable(tableId, {});
        return page.page.rows[0]?.cells[columnId] ?? null;
      },
      { tableId: demo.id, columnId: colIds.status }
    );
    expect(status).toBe(doneId);
  } finally {
    await context.close();
  }
});

test("the grid's rows stand the constant height (every column type fits the standard row; the enum's add grows none; the theme flip stands none)", async ({
  browser,
}) => {
  // A single pane: the heights are the bounding boxes (no sync needed);
  // a unique room (the relay keeps the room's doc for the dev server's
  // lifetime).
  const context = await editorContext(browser);
  const a = await context.newPage();
  try {
    await openPane(a, "a", `ext04-rowheight-${Math.random().toString(36).slice(2, 8)}`);
    // A fresh table over the pane's own bridge: the text column only.
    const tableId = await a.evaluate(async () => {
      const bridge = window.__bridge!;
      const ctx = () => ({ operationId: crypto.randomUUID(), issuedAt: new Date().toISOString() });
      const table = await bridge.createTable({ name: "All types" }, ctx());
      const id = table.result.id;
      const aCol = await bridge.createColumn(
        id,
        { column: { name: "A", type: "text", position: 0, nullable: true } },
        ctx()
      );
      await bridge.batchRows(
        id,
        {
          ops: [
            { op: "create", row: { [aCol.result.id]: "Task one" }, beforeRowId: null },
            { op: "create", row: { [aCol.result.id]: "Task two" }, beforeRowId: null },
          ],
        },
        ctx()
      );
      return id;
    });
    await a.evaluate((id) => window.__paneDocs!.a!.insertBlock("database", { tableId: id }), tableId);
    const gridA = a.locator("[data-slot='docblocks/database-grid']");
    await expect(gridA.first()).toBeVisible(SETTLE);
    const rowHeight = (row: number) =>
      a
        .locator(`[data-slot='docblocks/database-cell'][data-row='${row}']`)
        .all()
        .then(async (cells) => Promise.all(cells.map((cell) => cell.evaluate((el) => getComputedStyle(el).height))));

    // The text-only stand: every row stands the standard height (the
    // empty / the text's cells alike).
    const base = await rowHeight(0);
    expect(new Set(base).size).toBe(1);
    expect(await rowHeight(1)).toEqual(base);

    // The enum's column's add: the grid stands live (the bridge's event),
    // and the row's height stands — the trigger fits the standard row
    // (no grow; the new column's cells stand the stand's height).
    const e1ColId = await a.evaluate(async (id) => {
      const bridge = window.__bridge!;
      const ctx = () => ({ operationId: crypto.randomUUID(), issuedAt: new Date().toISOString() });
      const { columns } = await bridge.describeTable(id);
      const e1Col = await bridge.createColumn(
        id,
        {
          column: {
            name: "E1",
            type: "text",
            position: columns.length,
            nullable: true,
            reference: { kind: "enum", tableId: "table-statuses-enum", many: false },
          },
        },
        ctx()
      );
      const enumSnapshot = await bridge.snapshotTable("table-statuses-enum", {});
      const nameColumnId = enumSnapshot.columns.find((column) => column.name === "name")?.id ?? null;
      const todoOption =
        nameColumnId === null ? undefined : enumSnapshot.page.rows.find((row) => row.cells[nameColumnId] === "todo");
      if (todoOption === undefined) throw new Error("the todo option stands absent");
      const page = await bridge.snapshotTable(id, {});
      const rowId = page.page.rows[0]!.id;
      await bridge.batchRows(
        id,
        { ops: [{ op: "update", rowId, cells: { [e1Col.result.id]: todoOption.id } }] },
        ctx()
      );
      return e1Col.result.id;
    }, tableId);
    await expect(a.locator(`[data-slot='docblocks/database-header-cell'][data-column-id='${e1ColId}']`)).toBeVisible(
      SETTLE
    );
    const afterEnum = await rowHeight(0);
    expect(new Set(afterEnum).size).toBe(1);
    expect(afterEnum.every((h) => h === base[0])).toBe(true);
    const afterEnumRow1 = await rowHeight(1);
    expect(afterEnumRow1.every((h) => h === base[0])).toBe(true);

    // Every column type over the same table (the multi-enum / the
    // row-link / the date / the datetime / the number / the boolean):
    // the row's height stands over all of them.
    const b1ColId = await a.evaluate(async (id) => {
      const bridge = window.__bridge!;
      const ctx = () => ({ operationId: crypto.randomUUID(), issuedAt: new Date().toISOString() });
      const { columns } = await bridge.describeTable(id);
      const e2Col = await bridge.createColumn(
        id,
        {
          column: {
            name: "E2",
            type: "text",
            position: columns.length,
            nullable: true,
            reference: { kind: "enum", tableId: "table-statuses-enum", many: true },
          },
        },
        ctx()
      );
      const people = await bridge.createTable({ name: "People" }, ctx());
      const peopleId = people.result.id;
      const peopleNameCol = await bridge.createColumn(
        peopleId,
        { column: { name: "Name", type: "text", position: 0, nullable: true } },
        ctx()
      );
      const peopleRows = await bridge.batchRows(
        peopleId,
        { ops: [{ op: "create", row: { [peopleNameCol.result.id]: "Ann" }, beforeRowId: null }] },
        ctx()
      );
      const r1Col = await bridge.createColumn(
        id,
        {
          column: {
            name: "R1",
            type: "text",
            position: columns.length + 1,
            nullable: true,
            reference: { kind: "row", tableId: peopleId, many: false },
          },
        },
        ctx()
      );
      const d1Col = await bridge.createColumn(
        id,
        { column: { name: "D1", type: "date", position: columns.length + 2, nullable: true } },
        ctx()
      );
      const dt1Col = await bridge.createColumn(
        id,
        { column: { name: "DT1", type: "timestamptz", position: columns.length + 3, nullable: true } },
        ctx()
      );
      const n1Col = await bridge.createColumn(
        id,
        { column: { name: "N1", type: "integer", position: columns.length + 4, nullable: true } },
        ctx()
      );
      const b1Col = await bridge.createColumn(
        id,
        { column: { name: "B1", type: "boolean", position: columns.length + 5, nullable: true } },
        ctx()
      );
      const enumSnapshot = await bridge.snapshotTable("table-statuses-enum", {});
      const nameColumnId = enumSnapshot.columns.find((column) => column.name === "name")?.id ?? null;
      const todoOption =
        nameColumnId === null ? undefined : enumSnapshot.page.rows.find((row) => row.cells[nameColumnId] === "todo");
      if (todoOption === undefined) throw new Error("the todo option stands absent");
      const page = await bridge.snapshotTable(id, {});
      const rowId = page.page.rows[0]!.id;
      await bridge.batchRows(
        id,
        {
          ops: [
            {
              op: "update",
              rowId,
              cells: {
                [e2Col.result.id]: [todoOption.id],
                [r1Col.result.id]: peopleRows.result.rows[0]!.id,
                [d1Col.result.id]: "2026-09-01",
                [dt1Col.result.id]: "2026-12-15T18:00",
                [n1Col.result.id]: 7,
                [b1Col.result.id]: true,
              },
            },
          ],
        },
        ctx()
      );
      return b1Col.result.id;
    }, tableId);
    await expect(a.locator(`[data-slot='docblocks/database-header-cell'][data-column-id='${b1ColId}']`)).toBeVisible(
      SETTLE
    );
    const all = await rowHeight(0);
    expect(new Set(all).size).toBe(1);
    expect(all.every((h) => h === base[0])).toBe(true);

    // The theme flip (the harness stands dark by default): the height
    // stands (the token is the theme-independent stand).
    await a.evaluate(() => document.documentElement.classList.remove("dark"));
    await expect
      .poll(async () => {
        const heights = await rowHeight(0);
        return new Set(heights).size === 1 && heights.every((h) => h === base[0]);
      }, SETTLE)
      .toBe(true);
  } finally {
    await context.close();
  }
});

test("the bridge's state survives the tab's reload (the harness's persistent bridge: the tables / the rows / the row-link ids stand over the restore)", async ({
  browser,
}) => {
  const context = await editorContext(browser);
  const a = await context.newPage();
  try {
    await openPane(a, "a", `ext04-persist-${Math.random().toString(36).slice(2, 8)}`);
    // The table + the rows (the generated row ids: the restore's pk stand)
    // + the row-link's reference over the other table's row.
    const { tableId, nameColId, ownerColId, rowIds, annId } = await a.evaluate(async () => {
      const bridge = window.__bridge!;
      const ctx = () => ({ operationId: crypto.randomUUID(), issuedAt: new Date().toISOString() });
      const table = await bridge.createTable({ name: "Persist" }, ctx());
      const id = table.result.id;
      const nameCol = await bridge.createColumn(
        id,
        { column: { name: "Name", type: "text", position: 0, nullable: true } },
        ctx()
      );
      const people = await bridge.createTable({ name: "Persist People" }, ctx());
      const peopleId = people.result.id;
      // The display column (the row-link's display resolution stands the
      // first text column — its absence stands the raw id's stand).
      const peopleNameCol = await bridge.createColumn(
        peopleId,
        { column: { name: "Name", type: "text", position: 0, nullable: true } },
        ctx()
      );
      const peopleRows = await bridge.batchRows(
        peopleId,
        { ops: [{ op: "create", row: { [peopleNameCol.result.id]: "Ann" }, beforeRowId: null }] },
        ctx()
      );
      const ownerCol = await bridge.createColumn(
        id,
        {
          column: {
            name: "Owner",
            type: "text",
            position: 1,
            nullable: true,
            reference: { kind: "row", tableId: peopleId, many: false },
          },
        },
        ctx()
      );
      const rows = await bridge.batchRows(
        id,
        {
          ops: [
            {
              op: "create",
              row: {
                [nameCol.result.id]: "Row one",
                [ownerCol.result.id]: peopleRows.result.rows[0]!.id,
              },
              beforeRowId: null,
            },
            { op: "create", row: { [nameCol.result.id]: "Row two" }, beforeRowId: null },
          ],
        },
        ctx()
      );
      return {
        tableId: id,
        nameColId: nameCol.result.id,
        ownerColId: ownerCol.result.id,
        rowIds: rows.result.rows.map((row) => row.id),
        annId: peopleRows.result.rows[0]!.id,
      };
    });
    // The snapshot's save (the debounce's window + the re-read's pass).
    await a.waitForTimeout(750);
    await a.reload();
    await expect(a.getByTestId("status-a")).toHaveText("connected");

    // The restore: the table's id / the rows' ids / the cells / the
    // row-link's reference stand (the doc's references survive too).
    const after = await a.evaluate(
      async ({ id, nameColId, ownerColId }) => {
        const page = await window.__bridge!.snapshotTable(id, {});
        return {
          ids: page.page.rows.map((row) => row.id),
          owner: page.page.rows[0]?.cells[ownerColId] ?? null,
          name: page.page.rows[0]?.cells[nameColId] ?? null,
        };
      },
      { id: tableId, nameColId, ownerColId }
    );
    expect(after.ids).toEqual(rowIds);
    expect(after.owner).toBe(annId);
    expect(after.name).toBe("Row one");

    // The grid renders the restored rows (the restore stands before the
    // grid's first read; the row-link's display stands the restored
    // reference).
    await a.evaluate((id) => window.__paneDocs!.a!.insertBlock("database", { tableId: id }), tableId);
    const gridA = a.locator("[data-slot='docblocks/database-grid']");
    await expect(gridA).toBeVisible(SETTLE);
    await expect(gridA.getByText("Row one")).toBeVisible(SETTLE);
    await expect(gridA.getByText("Row two")).toBeVisible(SETTLE);
    // The row-link's display (the joined name over the restored id).
    const ownerCell = gridA.locator(`[data-slot='docblocks/database-cell'][data-column-id='${ownerColId}']`).first();
    await expect(ownerCell).toContainText("Ann", SETTLE);
  } finally {
    await context.close();
  }
});

test("the long text's cell: the double press stands the floating 6-row editor (the Baserow's stand: the box over the cell's top edge, the width = the cell's, the rows stand no shift, the covered rows' stand opaque; the Enter's break; the outside press's commit; the Escape's cancel)", async ({
  browser,
}) => {
  const context = await editorContext(browser);
  const a = await context.newPage();
  try {
    await openPane(a, "a", "ext04-multiline-" + Math.random().toString(36).slice(2, 8));

    // A text table over the pane's own bridge.
    const { tableId, bodyColId, numColId } = await a.evaluate(async () => {
      const bridge = window.__bridge!;
      const ctx = () => ({ operationId: crypto.randomUUID(), issuedAt: new Date().toISOString() });
      const table = await bridge.createTable({ name: "MultiLine" }, ctx());
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
      await bridge.batchRows(
        id,
        {
          ops: [
            {
              op: "create",
              row: {
                [bodyCol.result.id]: "Line one\nline two\nline three\nline four\nline five\nline six\nline seven",
                [numCol.result.id]: 1,
              },
              beforeRowId: null,
            },
            { op: "create", row: { [bodyCol.result.id]: "Short", [numCol.result.id]: 2 }, beforeRowId: null },
          ],
        },
        ctx()
      );
      return { tableId: id, bodyColId: bodyCol.result.id, numColId: numCol.result.id };
    });
    await a.evaluate((id) => window.__paneDocs!.a!.insertBlock("database", { tableId: id }), tableId);
    // The pane's grid (the single database block).
    const gridA = a.locator("[data-slot='docblocks/database-grid']").first();
    await expect(gridA).toBeVisible(SETTLE);

    // The double press stands the editor OVER THE CELL (the Baserow's
    // stand — the portaled layer): the display drops (the duplication is
    // out), the box's top edge stands over the row's top edge, the box
    // stands the 6 rows' height over the next row (the row stands no
    // shift).
    const cell = gridA.locator(`[data-slot='docblocks/database-cell'][data-column-id='${bodyColId}'][data-row='0']`);
    const restBox = (await cell.boundingBox())!;
    const nextRowBox = (await gridA
      .locator(`[data-slot='docblocks/database-cell'][data-column-id='${bodyColId}'][data-row='1']`)
      .boundingBox())!;
    // The text's seat over the open (the no-jump's stand): the display's
    // text start (the box's left + the display's px-1) — measured before
    // the open (the display drops over the edit).
    const displaySeatLeft = await cell
      .locator("[data-slot='docblocks/database-cell-display']")
      .evaluate((el) => el.getBoundingClientRect().left + 4);
    await cell.dblclick();
    const textarea = a.locator("[data-slot='docblocks/database-cell-multiline']");
    await expect(textarea).toBeVisible(SETTLE);
    expect(await cell.locator("[data-slot='docblocks/database-cell-display']").count()).toBe(0);
    // The enter animation's zoom scales the box during the settle window:
    // the seat's and geometry's measures wait for the transform to settle.
    const editorContent = a.locator(
      "[data-slot='popover-content']:has([data-slot='docblocks/database-cell-multiline'])"
    );
    await expect(editorContent).toHaveCSS("transform", "none");
    const metrics = await textarea.evaluate((el) => {
      const ta = el as HTMLTextAreaElement;
      const lineHeight = parseFloat(getComputedStyle(ta).lineHeight);
      return {
        width: ta.offsetWidth,
        rows: ta.rows,
        height: ta.clientHeight,
        lineHeight,
        value: ta.value,
        scrollable: ta.scrollHeight > ta.clientHeight,
        focused: document.activeElement === ta,
        caretAtEnd: ta.selectionStart === ta.value.length && ta.selectionEnd === ta.value.length,
        textStartLeft: ta.getBoundingClientRect().left + parseFloat(getComputedStyle(ta).paddingLeft),
      };
    });
    expect(metrics.rows).toBe(6);
    expect(metrics.height).toBeGreaterThanOrEqual(6 * metrics.lineHeight);
    expect(metrics.height).toBeLessThanOrEqual(6 * metrics.lineHeight + 24);
    expect(metrics.scrollable).toBe(true);
    // The caret stands the value's END (the autoFocus's start seat is out),
    // the editor holds the focus.
    expect(metrics.focused).toBe(true);
    expect(metrics.caretAtEnd).toBe(true);
    // The text's seat stands the display's (the padding compensates the
    // border's 1px over the cell's seat — the open's jump is out).
    expect(Math.abs(metrics.textStartLeft - displaySeatLeft)).toBeLessThanOrEqual(1);
    // The Baserow's geometry: the floating box's top edge stands a few px
    // OVER the cell's top edge (the box opens over the row's top), the
    // box's width stands the cell's (the box = the column's width), the
    // box's stand is opaque (the popover's background — the covered rows
    // stand none through it).
    const editorBox = (await editorContent.boundingBox())!;
    expect(editorBox.y).toBeLessThan(restBox.y);
    expect(restBox.y - editorBox.y).toBeLessThanOrEqual(14);
    expect(Math.abs(editorBox.x - restBox.x)).toBeLessThanOrEqual(2);
    expect(Math.abs(editorBox.width - restBox.width)).toBeLessThanOrEqual(4);
    const editorBg = await editorContent.evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(editorBg).not.toBe("rgba(0, 0, 0, 0)");
    // The rows stand no shift (the fixed track — the box stands the
    // portaled layer over the grid, the layout never moves), and the box
    // COVERS the row below (the point over the next row hits the portaled
    // editor).
    const stillNextRowBox = (await gridA
      .locator(`[data-slot='docblocks/database-cell'][data-column-id='${bodyColId}'][data-row='1']`)
      .boundingBox())!;
    expect(stillNextRowBox.y).toBe(nextRowBox.y);
    const covered = await a.evaluate(
      ({ x, y }) => {
        const el = document.elementFromPoint(x, y);
        return el instanceof Element && el.closest("[data-radix-popper-content-wrapper]") !== null;
      },
      { x: editorBox.x + editorBox.width / 2, y: nextRowBox.y + nextRowBox.height / 2 }
    );
    expect(covered).toBe(true);

    // The character's own editing (the grid's cell-clear gesture stands no
    // stand over the focused textarea — the guard's contract): the typed
    // character stands, the Backspace deletes the character only (the
    // cell's clear is out), the session stands.
    await a.keyboard.type("Z");
    let draftValue = await textarea.evaluate((el) => (el as HTMLTextAreaElement).value);
    expect(draftValue.endsWith("line sevenZ")).toBe(true);
    await a.keyboard.press("Backspace");
    draftValue = await textarea.evaluate((el) => (el as HTMLTextAreaElement).value);
    expect(draftValue.endsWith("line sevenZ")).toBe(false);
    expect(draftValue.endsWith("line seven")).toBe(true);
    await expect(textarea).toBeVisible(SETTLE);

    // The Enter stands the soft break (the raw \n — the session stands
    // open, no commit).
    await a.keyboard.press("Enter");
    await a.keyboard.type("Appended");
    await expect(textarea).toBeVisible(SETTLE);
    const draftLines = await textarea.evaluate((el) => (el as HTMLTextAreaElement).value.split("\n").length);
    expect(draftLines).toBe(8);

    // The outside press (the real mouse): the session's teardown commits
    // the draft in one updateRow (the commit stands over the pane's
    // bridge).
    const box = await gridA.boundingBox();
    await a.mouse.click(box!.x - 40, box!.y + 10);
    await expect(textarea).toBeHidden(SETTLE);
    const committed = await a.evaluate(
      async ({ id, columnId }) => {
        const page = await window.__bridge!.snapshotTable(id, {});
        return page.page.rows[0]?.cells[columnId] as string | undefined;
      },
      { id: tableId, columnId: bodyColId }
    );
    expect(committed).toBe("Line one\nline two\nline three\nline four\nline five\nline six\nline seven\nAppended");

    // The Escape's cancel (the short cell): the typed draft stands no
    // write.
    const shortCell = gridA.locator(
      `[data-slot='docblocks/database-cell'][data-column-id='${bodyColId}'][data-row='1']`
    );
    const shortEditor = a.locator("[data-slot='docblocks/database-cell-multiline']");
    await shortCell.dblclick();
    await expect(shortEditor).toBeVisible(SETTLE);
    await a.keyboard.type("X");
    await a.keyboard.press("Escape");
    await expect(shortEditor).toBeHidden(SETTLE);
    const afterCancel = await a.evaluate(
      async ({ id, columnId }) => {
        const page = await window.__bridge!.snapshotTable(id, {});
        return page.page.rows[1]?.cells[columnId] as string | undefined;
      },
      { id: tableId, columnId: bodyColId }
    );
    expect(afterCancel).toBe("Short");

    // The short cell's commit stands the same session (the outside
    // press's teardown commits the draft; the caret stands the end — the
    // autoFocus's start seat is out).
    await shortCell.dblclick();
    await expect(shortEditor).toBeVisible(SETTLE);
    await shortEditor.evaluate((el) => {
      const ta = el as HTMLTextAreaElement;
      ta.setSelectionRange(ta.value.length, ta.value.length);
    });
    await a.keyboard.type(" X");
    await a.mouse.click(box!.x - 40, box!.y + 10);
    await expect(shortEditor).toBeHidden(SETTLE);
    const afterCommit = await a.evaluate(
      async ({ id, columnId }) => {
        const page = await window.__bridge!.snapshotTable(id, {});
        return page.page.rows[1]?.cells[columnId] as string | undefined;
      },
      { id: tableId, columnId: bodyColId }
    );
    expect(afterCommit).toBe("Short X");

    // The regression: the number's cell stands the input (the textarea's
    // stand is the text's only).
    const numCell = gridA.locator(`[data-slot='docblocks/database-cell'][data-column-id='${numColId}'][data-row='0']`);
    await numCell.dblclick();
    const numInput = gridA.locator(
      `[data-slot='docblocks/database-cell'][data-column-id='${numColId}'][data-row='0'] input`
    );
    await expect(numInput).toBeVisible(SETTLE);
    expect(await a.locator("[data-slot='docblocks/database-cell-multiline']").count()).toBe(0);
  } finally {
    await context.close();
  }
});

test("the multi-enum / the multi row-links: the empty cell stands the multi editor (the first pick's array; the two picks' stand over the pane's bridge; the single's pick stands the scalar; the undo's per toggle)", async ({
  browser,
}) => {
  const context = await editorContext(browser);
  const a = await context.newPage();
  try {
    await openPane(a, "a", "ext04-multiselect-" + Math.random().toString(36).slice(2, 8));

    // A fresh table over the pane's own bridge: the multi-enum (the demo's
    // statuses' dict), the multi row-links (the linked's people), the
    // single-enum + the single row-link (the regression's stand).
    const { tableId, linkPeopleIds, tagsColId, ownersColId, statusColId, ownerColId } = await a.evaluate(async () => {
      const bridge = window.__bridge!;
      const ctx = () => ({ operationId: crypto.randomUUID(), issuedAt: new Date().toISOString() });
      const table = await bridge.createTable({ name: "MultiSelect" }, ctx());
      const id = table.result.id;
      const people = await bridge.createTable({ name: "LinkPeople" }, ctx());
      const peopleId = people.result.id;
      const peopleNameCol = await bridge.createColumn(
        peopleId,
        { column: { name: "Name", type: "text", position: 0, nullable: true } },
        ctx()
      );
      const peopleRows = await bridge.batchRows(
        peopleId,
        {
          ops: [
            { op: "create", row: { [peopleNameCol.result.id]: "Ann" }, beforeRowId: null },
            { op: "create", row: { [peopleNameCol.result.id]: "Bob" }, beforeRowId: null },
          ],
        },
        ctx()
      );
      const tagsCol = await bridge.createColumn(
        id,
        {
          column: {
            name: "Tags",
            type: "text",
            position: 0,
            nullable: true,
            reference: { kind: "enum", tableId: "table-statuses-enum", many: true },
          },
        },
        ctx()
      );
      const ownersCol = await bridge.createColumn(
        id,
        {
          column: {
            name: "Owners",
            type: "text",
            position: 1,
            nullable: true,
            reference: { kind: "row", tableId: peopleId, many: true },
          },
        },
        ctx()
      );
      const statusCol = await bridge.createColumn(
        id,
        {
          column: {
            name: "Status",
            type: "text",
            position: 2,
            nullable: true,
            reference: { kind: "enum", tableId: "table-statuses-enum", many: false },
          },
        },
        ctx()
      );
      const ownerCol = await bridge.createColumn(
        id,
        {
          column: {
            name: "Owner",
            type: "text",
            position: 3,
            nullable: true,
            reference: { kind: "row", tableId: peopleId, many: false },
          },
        },
        ctx()
      );
      await bridge.batchRows(id, { ops: [{ op: "create", row: {}, beforeRowId: null }] }, ctx());
      return {
        tableId: id,
        linkPeopleIds: peopleRows.result.rows.map((row) => row.id),
        tagsColId: tagsCol.result.id,
        ownersColId: ownersCol.result.id,
        statusColId: statusCol.result.id,
        ownerColId: ownerCol.result.id,
      };
    });
    // The block's id scopes the grid (the doc's seed blocks stand the
    // other grids — the `first`'s stand is out).
    const blockA = await a.evaluate((id) => window.__paneDocs!.a!.insertBlock("database", { tableId: id }), tableId);
    const gridA = a.locator(`[data-block-id='${blockA}'] [data-slot='docblocks/database-grid']`);
    await expect(gridA).toBeVisible(SETTLE);

    const cell = (column: string) =>
      gridA.locator(`[data-slot='docblocks/database-cell'][data-column-id='${column}'][data-row='0']`);
    const chipsOf = (column: string) =>
      cell(column).locator("[data-slot='docblocks/database-ref-chip']").allTextContents();
    const todoId = await statusOptionId(a, "todo");
    const doneId = await statusOptionId(a, "done");
    const doingId = await statusOptionId(a, "doing");
    const option = (value: string) =>
      a.locator(`[data-slot='docblocks/database-ref-multi-option'][data-option-value='${value}']`);
    const bridgeCells = () =>
      a.evaluate(async (id) => {
        const page = await window.__bridge!.snapshotTable(id, {});
        return page.page.rows[0]?.cells ?? null;
      }, tableId);

    // ---- The multi-enum: the EMPTY cell stands the multi editor (the
    // single-pick's stand is out) — the first pick commits the ARRAY.
    await cell(tagsColId).dblclick();
    await expect(option(todoId)).toBeVisible(SETTLE);
    await expect(option(todoId)).not.toHaveAttribute("data-state", "checked");
    await option(todoId).click();
    await a.waitForTimeout(50);
    await option(doneId).click();
    await a.waitForTimeout(50);
    // The two picks' stand: the chips' train (the joined text is out) +
    // the array over the pane's bridge.
    await expect(async () => {
      expect(await chipsOf(tagsColId)).toEqual(["todo", "done"]);
    }).toPass({ timeout: 5_000 });
    const cellsA = await bridgeCells();
    expect(cellsA?.[tagsColId]).toEqual([todoId, doneId]);

    // The uncheck's stand: the chips' update + the array's stand.
    await cell(tagsColId).dblclick();
    await expect(option(doneId)).toBeVisible(SETTLE);
    await option(todoId).click();
    await a.waitForTimeout(50);
    await expect(async () => {
      expect(await chipsOf(tagsColId)).toEqual(["done"]);
    }).toPass({ timeout: 5_000 });
    expect((await bridgeCells())?.[tagsColId]).toEqual([doneId]);

    // ---- The undo's per toggle (the existing's contract): the two
    // toggles' stand the two entries (the uncheck's + the add's). The
    // outside press stands the popover's close (the modal layer's
    // one-click stand); the grid's hotkey stands the undo over the
    // table's focus (the cell's press stands the focus stand).
    const chipsWait = (values: string[]) =>
      expect(async () => {
        expect(await chipsOf(tagsColId)).toEqual(values);
      }).toPass({ timeout: 5_000 });
    // The cell's raw press: the popover's close (the outside press) + the
    // table's focus stand (the cell's pointerdown stands it — the hotkey's
    // reach; the popover's close stands the focus over the trigger's row,
    // so the press stands the stand back).
    const statusBox = await a.evaluate(
      ({ id, statusColumnId }) => {
        const scope = document.querySelector(`[data-block-id='${id}']`);
        const el = scope?.querySelector<HTMLElement>(
          `[data-slot='docblocks/database-cell'][data-column-id='${statusColumnId}']`
        );
        const r = el?.getBoundingClientRect();
        return r ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null;
      },
      { id: blockA, statusColumnId: statusColId }
    );
    expect(statusBox).not.toBeNull();
    await a.mouse.move(statusBox!.x, statusBox!.y);
    await a.mouse.down();
    await a.mouse.up();
    await a.keyboard.press("Control+Z");
    await chipsWait(["todo", "done"]);
    await a.keyboard.press("Control+Z");
    await chipsWait(["todo"]);

    // ---- The multi row-links: the same scenario over the linked's rows
    // (the chips stand the resolved displays).
    await cell(ownersColId).dblclick();
    const ownerOption = (rowId: string) =>
      a.locator(`[data-slot='docblocks/database-ref-multi-option'][data-option-value='${rowId}']`);
    await expect(ownerOption(linkPeopleIds[0]!)).toBeVisible(SETTLE);
    await ownerOption(linkPeopleIds[0]!).click();
    await a.waitForTimeout(50);
    await ownerOption(linkPeopleIds[1]!).click();
    await a.waitForTimeout(50);
    await expect(async () => {
      expect(await chipsOf(ownersColId)).toEqual(["Ann", "Bob"]);
    }).toPass({ timeout: 5_000 });
    expect((await bridgeCells())?.[ownersColId]).toEqual([linkPeopleIds[0]!, linkPeopleIds[1]!]);

    // ---- The single's pick stands the SCALAR (the regression): the
    // single-enum's cell opens the picker (the multi's stand is out), the
    // pick commits the string (not the array). The row's option-value
    // stands the option's row id (the pk's stand = the dict's value).
    await cell(statusColId).dblclick();
    await a.waitForTimeout(150);
    const enumPickerRow = a.locator("[data-slot='docblocks/database-enum-picker-row']");
    await expect(enumPickerRow.first()).toBeVisible(SETTLE);
    expect(await a.locator("[data-slot='docblocks/database-ref-multi-option']").count()).toBe(0);
    await a.locator(`[data-slot='docblocks/database-enum-picker-row'][data-option-value='${doingId}']`).click();
    await a.waitForTimeout(50);
    const singleEnum = (await bridgeCells())?.[statusColId];
    expect(singleEnum).toBe(doingId);

    // The single row-link's cell opens the picker (the multi's stand is
    // out), the pick commits the row id's scalar.
    await cell(ownerColId).dblclick();
    // The picker's rows stand in the portaled content (the block's scope
    // is out — the pane's locator stands the pick, like the multi's).
    const rowPick = a.locator("[data-slot='docblocks/database-row-picker-row']");
    await expect(rowPick.first()).toBeVisible(SETTLE);
    expect(await a.locator("[data-slot='docblocks/database-ref-multi-option']").count()).toBe(0);
    await rowPick.first().click();
    await a.waitForTimeout(50);
    const singleLink = (await bridgeCells())?.[ownerColId];
    expect(singleLink).toBe(linkPeopleIds[0]!);
  } finally {
    await context.close();
  }
});

test("the enum's create form (the options' editor: the reorder / the color / the delete; the system table stands hidden; the chip's stand; the picker's contract; the undo)", async ({
  browser,
}) => {
  const context = await editorContext(browser);
  const a = await context.newPage();
  try {
    await openPane(a, "a", "ext04-enumform-" + Math.random().toString(36).slice(2, 8));

    const demo = await bridgeDemoTable(a);
    const blockId = await a.evaluate((tableId) => window.__paneDocs!.a!.insertBlock("database", { tableId }), demo.id);
    const gridA = a.locator(`[data-block-id='${blockId}'] [data-slot='docblocks/database-grid']`);
    await expect(gridA).toBeVisible(SETTLE);
    const { Status: statusColId } = await demoColumns(a, demo.id, ["Status"]);

    // The demo's status enum stands the system table (the hidden stand):
    // the `listTables` stands it out, the chip stands the option's color
    // (the data's inline stand over the pastel palette).
    const tables = await a.evaluate(async () => (await window.__bridge!.listTables()).map((t) => t.name));
    expect(tables).not.toContain("Statuses-enum");
    const chip = gridA.locator(
      `[data-column-id='${statusColId}'][data-row='0'] [data-slot='docblocks/database-ref-chip']`
    );
    await expect(chip).toHaveText("todo", SETTLE);
    expect(await chip.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe("rgb(244, 224, 125)");

    // The enum's create form: the options' editor stands (the ref table's
    // pick is out), the options' draft over the editor's rows.
    const form = a.locator("[data-slot='docblocks/database-add-column-form']");
    const trigger = a.locator("[data-slot='docblocks/database-add-column-trigger']");
    await trigger.click();
    const menu = a.locator("[data-slot='dropdown-menu-content']");
    await menu.locator("[data-column-entry='enum']").click();
    await expect(form).toBeVisible(SETTLE);
    await expect(form.locator("[data-slot='docblocks/database-enum-options']")).toBeVisible(SETTLE);
    expect(await form.locator("[data-slot='docblocks/database-add-column-ref']").count()).toBe(0);

    const addOption = async (name: string) => {
      await form.locator("[data-slot='docblocks/database-enum-option-add']").click();
      const inputs = form.locator("[data-slot='docblocks/database-enum-option-name']");
      await inputs.last().fill(name);
    };
    await addOption("low");
    await addOption("high");
    // The grip's drag stands the live reorder (the high stands first). The
    // crossing stands decisive over the engine (the webkit's frame's
    // schedule): a full pitch over the first grip's edge, slow steps.
    const grips = form.locator("[data-slot='docblocks/database-enum-option-grip']");
    const first = await grips.nth(0).boundingBox();
    const last = await grips.nth(1).boundingBox();
    if (first === null || last === null) throw new Error("the grip's box is null");
    await a.mouse.move(last.x + last.width / 2, last.y + last.height / 2);
    await a.mouse.down();
    await a.mouse.move(first.x + first.width / 2, first.y - 4, { steps: 24 });
    await a.mouse.up();
    await a.waitForTimeout(400); // the back-out's settle (the sibling's parity)
    const namesAfter = await form
      .locator("[data-slot='docblocks/database-enum-option-name']")
      .evaluateAll((elements) => elements.map((element) => (element as HTMLInputElement).value));
    expect(namesAfter).toEqual(["high", "low"]);
    // The color's palette (the popover pick over the swatch — the palette's
    // red stands the first option's chip).
    await form.locator("[data-slot='docblocks/database-enum-option-color']").first().click();
    const paletteRed = a.locator("button[style*='rgb(247, 168, 168)']").first();
    await paletteRed.click();
    await a.waitForTimeout(100);
    await form.locator("[data-slot='docblocks/database-add-column-name']").fill("Priority");
    await form.locator("[data-slot='docblocks/database-add-column-create']").click();
    await expect(form).toBeHidden(SETTLE);

    // The column stands in the pane's grid; the system table stands
    // the hidden catalog out.
    const priorityColId = await awaitedLastColumnId(a, demo.id, 5);
    const headerA = a.locator(
      `[data-block-id='${blockId}'] [data-slot='docblocks/database-header-cell'][data-column-id='${priorityColId}']`
    );
    await expect(headerA).toHaveText("Priority", SETTLE);
    const schema = await a.evaluate(
      async (tableId) => (await window.__bridge!.describeTable(tableId)).columns,
      demo.id
    );
    const created = schema.find((column) => column.id === priorityColId);
    expect(created).not.toBeNull();
    const enumTableId = created?.reference?.tableId ?? "";
    expect(tables).not.toContain(enumTableId);
    const optionRows = await a.evaluate(async (id) => {
      const snapshot = await window.__bridge!.snapshotTable(id, {});
      const nameColumnId = snapshot.columns.find((column) => column.name === "name")?.id ?? null;
      const colorColumnId = snapshot.columns.find((column) => column.name === "color")?.id ?? null;
      if (nameColumnId === null || colorColumnId === null) return null;
      return {
        names: snapshot.page.rows.map((row) => row.cells[nameColumnId]),
        colors: snapshot.page.rows.map((row) => row.cells[colorColumnId]),
      };
    }, enumTableId);
    expect(optionRows?.names).toEqual(["high", "low"]);
    expect(optionRows?.colors?.[0]).toBe("#f7a8a8");

    // The empty cell's stand: the background only (the chip stands none —
    // the trigger's box is out). The one press stands the selection, the
    // double press stands the picker.
    const cell = gridA.locator(`[data-column-id='${priorityColId}'][data-row='0']`);
    expect(await cell.locator("[data-slot='docblocks/database-ref-chip']").count()).toBe(0);
    expect(await cell.getAttribute("data-empty")).toBe("true");
    await cell.click();
    await a.waitForTimeout(100);
    // The selected's stand (the outline's class over the sole selection).
    expect(await cell.getAttribute("class")).toContain("outline");
    await cell.dblclick();
    await a.waitForTimeout(150);
    // The picker's stand: the width = the cell's width (the trigger's
    // stand), the search stands the autofocus, the options' order, the
    // clear's option.
    const triggerBox = await a
      .locator(`[data-block-id='${blockId}'] [data-slot='docblocks/database-enum-picker-trigger']`)
      .first()
      .boundingBox();
    const contentBox = await a
      .locator("[data-slot='popover-content']", {
        has: a.locator("[data-slot='docblocks/database-enum-picker-search']"),
      })
      .last()
      .boundingBox();
    if (triggerBox === null || contentBox === null) throw new Error("the picker's box stands none");
    expect(Math.abs(contentBox.width - triggerBox.width)).toBeLessThanOrEqual(2);
    const focused = await a.evaluate(() => (document.activeElement as HTMLElement | null)?.getAttribute("data-slot"));
    expect(focused).toBe("docblocks/database-enum-picker-search");
    const optionRow = (label: string) =>
      a.locator(`[data-slot='docblocks/database-enum-picker-row'][data-option-value]`, { hasText: label }).last();
    await expect(optionRow("high")).toBeVisible(SETTLE);
    await expect(optionRow("low")).toBeVisible(SETTLE);
    const rows = a.locator("[data-slot='docblocks/database-enum-picker-row']");
    expect(await rows.count()).toBe(2);
    expect(await rows.nth(0).textContent()).toContain("high");
    await expect(a.locator("[data-slot='docblocks/database-enum-picker-clear']")).toBeVisible(SETTLE);

    // The pick commits the option's id (the chip stands in the pane's
    // grid), the undo reverts (the focus stands over the cell's press).
    await optionRow("high").click();
    await a.waitForTimeout(100);
    const chipA = cell.locator("[data-slot='docblocks/database-ref-chip']");
    await expect(chipA).toHaveText("high", SETTLE);
    expect(await chipA.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe("rgb(247, 168, 168)");
    await cell.click();
    await a.keyboard.press("Control+Z");
    await a.waitForTimeout(150);
    expect(await cell.locator("[data-slot='docblocks/database-ref-chip']").count()).toBe(0);

    // The multi-enum: the multi's editor over the empty cell (the check's
    // toggle stands the array; the chips' train over the picks).
    const trigger2 = a.locator("[data-slot='docblocks/database-add-column-trigger']");
    await trigger2.click();
    await a.locator("[data-slot='dropdown-menu-content'] [data-column-entry='multi-enum']").click();
    await expect(form).toBeVisible(SETTLE);
    const addOption2 = async (name: string) => {
      await form.locator("[data-slot='docblocks/database-enum-option-add']").click();
      const inputs = form.locator("[data-slot='docblocks/database-enum-option-name']");
      await inputs.last().fill(name);
    };
    await addOption2("red");
    await addOption2("blue");
    await form.locator("[data-slot='docblocks/database-add-column-name']").fill("Tints");
    await form.locator("[data-slot='docblocks/database-add-column-create']").click();
    await expect(form).toBeHidden(SETTLE);
    const tintsColId = await awaitedLastColumnId(a, demo.id, 6);
    const multiCell = gridA.locator(`[data-column-id='${tintsColId}'][data-row='0']`);
    await multiCell.dblclick();
    await a.waitForTimeout(150);
    const multiOption = (value: string) =>
      a.locator(`[data-slot='docblocks/database-ref-multi-option'][data-option-value='${value}']`);
    // The option values stand the system table's row ids (the pk's stand).
    const tintsTableId = (await a.evaluate(
      async ({ tableId, colId }) => {
        const { columns } = await window.__bridge!.describeTable(tableId);
        return columns.find((column) => column.id === colId)?.reference?.tableId ?? null;
      },
      { tableId: demo.id, colId: tintsColId }
    ))!;
    const tintsIds = await a.evaluate(async (id) => {
      const page = await window.__bridge!.snapshotTable(id, {});
      return page.page.rows.map((row) => row.id);
    }, tintsTableId);
    await multiOption(tintsIds[0]!).click();
    await a.waitForTimeout(100);
    await multiOption(tintsIds[1]!).click();
    await a.waitForTimeout(100);
    // The chips' train (the two picks' stand; the order over the toggle's
    // sequence).
    const multiChips = multiCell.locator("[data-slot='docblocks/database-ref-chip']");
    expect(await multiChips.count()).toBe(2);
    expect(await multiChips.nth(0).textContent()).toBe("red");
    expect(await multiChips.nth(1).textContent()).toBe("blue");
    // The check's toggle over the list (the uncheck stands the array's
    // drop).
    await multiCell.dblclick();
    await a.waitForTimeout(150);
    await multiOption(tintsIds[0]!).click();
    await a.waitForTimeout(100);
    expect(await multiChips.count()).toBe(1);
    expect(await multiChips.first().textContent()).toBe("blue");
  } finally {
    await context.close();
  }
});

test("the enum's edit form (the options' diff: the values stand; the names / the order / the colors update)", async ({
  browser,
}) => {
  const context = await editorContext(browser);
  const a = await context.newPage();
  try {
    await openPane(a, "a", "ext04-enumedit-" + Math.random().toString(36).slice(2, 8));

    const demo = await bridgeDemoTable(a);
    const blockId = await a.evaluate((tableId) => window.__paneDocs!.a!.insertBlock("database", { tableId }), demo.id);
    const gridA = a.locator(`[data-block-id='${blockId}'] [data-slot='docblocks/database-grid']`);
    await expect(gridA).toBeVisible(SETTLE);
    const { Status: statusColId } = await demoColumns(a, demo.id, ["Status"]);

    // The demo's status column stands the system table (the options'
    // diff's target). The cell's value stands the option's row id (the
    // pk's stand — the identity over the rename).
    const statusChip = gridA.locator(
      `[data-column-id='${statusColId}'][data-row='0'] [data-slot='docblocks/database-ref-chip']`
    );
    await expect(statusChip).toHaveText("todo", SETTLE);

    // The edit's open (the column menu's "Edit options" entry — the
    // Ellipsis's press opens the menu): the draft prefills from the system
    // table (the order's stand, the names, the colors).
    const header = gridA.locator(`[data-slot='docblocks/database-header-cell'][data-column-id='${statusColId}']`);
    await header.locator("[data-slot='docblocks/database-column-menu']").click();
    const menu = a.locator("[data-slot='dropdown-menu-content']");
    await expect(menu).toBeVisible(SETTLE);
    await menu.locator("[data-slot='docblocks/database-column-edit-options']").click();
    const form = a.locator("[data-slot='docblocks/database-add-column-form']");
    await expect(form).toBeVisible(SETTLE);
    const optionNames = form.locator("[data-slot='docblocks/database-enum-option-name']");
    expect(
      await optionNames.evaluateAll((elements) => elements.map((element) => (element as HTMLInputElement).value))
    ).toEqual(["todo", "doing", "done"]);
    const nameInput = form.locator("[data-slot='docblocks/database-add-column-name']");
    expect(await nameInput.inputValue()).toBe("Status");

    // The diff: the rename (todo → planned), the option's add (stalled),
    // the reorder (stalled stands last).
    await optionNames.nth(0).fill("planned");
    await form.locator("[data-slot='docblocks/database-enum-option-add']").click();
    const inputs = form.locator("[data-slot='docblocks/database-enum-option-name']");
    await inputs.nth(3).fill("stalled");
    // The save's commit (the "Save" stand over the edit's mode).
    await form.locator("[data-slot='docblocks/database-add-column-create']").click();
    await expect(form).toBeHidden(SETTLE);
    await a.waitForTimeout(200);

    // The value stands (the identity's resolution: the todo's row id now
    // stands the planned's label over the pane's grid).
    await expect(statusChip).toHaveText("planned", SETTLE);

    // The picker's list stands the new stand (the planned's rename,
    // the stalled's stand at the end; the old name is gone). The order
    // stands the table's row order (the rename keeps the row in place —
    // the draft's order stands no reorder in this diff).
    await gridA.locator(`[data-column-id='${statusColId}'][data-row='1']`).dblclick();
    await a.waitForTimeout(150);
    const rows = a.locator("[data-slot='docblocks/database-enum-picker-row']");
    expect(await rows.count()).toBe(4);
    expect(await rows.nth(0).textContent()).toContain("planned");
    expect(await rows.nth(1).textContent()).toContain("doing");
    expect(await rows.nth(2).textContent()).toContain("done");
    expect(await rows.nth(3).textContent()).toContain("stalled");
  } finally {
    await context.close();
  }
});

// The enum-cell double-click regression: a double-click over an enum cell could land a
// DOM word selection on the grid's chrome (the "+ Add row" button's text) —
// the button lives OUTSIDE the `database-grid` scroller, so the old grid-only
// guard missed it, and the mapping stood a selection + the format toolbar.
// The fix: the guard stands the WHOLE database block (cells AND chrome) →
// none, and the chrome's buttons carry `select-none`.
test("a double-click over the enum cell stands the picker, no format toolbar / no chrome selection", async ({
  browser,
}) => {
  const { a, close } = await twoPanes(browser, "ext04-chrome-noselect");
  try {
    const demo = await bridgeDemoTable(a);
    await a.evaluate((tableId) => window.__paneDocs!.a!.insertBlock("database", { tableId }), demo.id);

    const gridA = a.locator("[data-slot='docblocks/database-grid']");
    await expect(gridA).toHaveCount(1, SETTLE);

    // The enum cell's double press opens the picker (the edit session
    // stands).
    const { Status: statusColId, Title: titleColId } = await demoColumns(a, demo.id, ["Status", "Title"]);
    const doingId = await statusOptionId(a, "doing");
    const enumCellA = a.locator(`[data-slot='docblocks/database-cell'][data-column-id='${statusColId}']`).first();
    await enumCellA.dblclick();
    const option = a.locator(`[data-slot='docblocks/database-enum-picker-row'][data-option-value='${doingId}']`);
    await expect(option).toBeVisible(SETTLE);
    await a.keyboard.press("Escape");
    await expect(option).toHaveCount(0, SETTLE);

    // THE BUG'S CONTRACT: no format toolbar anywhere (the chrome's word
    // selection must not stand a doc text selection), and the DOM's
    // selection is empty (the button's text is not selected).
    await expect(a.locator('[data-slot="docblocks/format-toolbar"]')).toHaveCount(0);
    expect(await a.evaluate(() => window.getSelection()?.toString() ?? "")).toBe("");

    // The Add row button: `user-select: none` (the native word selection is
    // impossible), and a press adds a row with no toolbar over it.
    const addRow = a.locator("[data-slot='docblocks/database-add-row']");
    await expect(addRow).toHaveCount(1);
    expect(await addRow.evaluate((el) => getComputedStyle(el).userSelect)).toBe("none");
    const titleCells = () => a.locator(`[data-slot='docblocks/database-cell'][data-column-id='${titleColId}']`).count();
    const countBefore = await titleCells();
    await addRow.click();
    await expect.poll(titleCells, SETTLE).toBe(countBefore + 1);
    await expect(a.locator('[data-slot="docblocks/format-toolbar"]')).toHaveCount(0);

    // Regression: the format toolbar stands over a REAL document text
    // selection (a word double-click in a paragraph).
    const paraId = await a.evaluate(() => {
      const doc = window.__paneDocs!.a!;
      const p = doc.insertBlock("paragraph");
      doc.insertText(p, 0, "hello");
      return p;
    });
    const paraInner = a.locator(`[data-block-id="${paraId}"] [data-slot="docblocks/block-content"]`);
    // Double-click over the word itself (the element's center is past the
    // short text — the click position lands on the first character).
    await paraInner.dblclick({ position: { x: 5, y: 10 } });
    await expect(a.locator('[data-slot="docblocks/format-toolbar"]')).toHaveCount(1, SETTLE);
  } finally {
    await close();
  }
});

test("the cell's display stands the single line (the text's ellipsis; the multi's right fade; the number / the date's single-line regression; the single's chip ellipsis)", async ({
  browser,
}) => {
  const { a, b, close } = await twoPanesSharedContext(browser, "db-display-stand");
  try {
    // A fresh table over the shared snapshot: the long text (the ellipsis's
    // stand), the number + the datetime (the single-line regression), the
    // multi-enum + the multi row-links (the right fade over the overflow),
    // and the single enum (the chip's ellipsis — the text's stand, not the
    // fade). The enum's dict's long labels + the row-link's long names force
    // the chips' train over the column's width (the overflow's stand).
    const { tableId, colIds } = await a.evaluate(async () => {
      const bridge = window.__bridge!;
      const ctx = () => ({ operationId: crypto.randomUUID(), issuedAt: new Date().toISOString() });
      const dict = await bridge.createTable({ name: "DisplayOpts", system: true }, ctx());
      const dictId = dict.result.id;
      const dictNameCol = await bridge.createColumn(
        dictId,
        { column: { name: "name", type: "text", position: 0, nullable: true } },
        ctx()
      );
      const dictRows = await bridge.batchRows(
        dictId,
        {
          ops: [
            { op: "create", row: { [dictNameCol.result.id]: "Alpha very long option label" }, beforeRowId: null },
            { op: "create", row: { [dictNameCol.result.id]: "Beta very long option label" }, beforeRowId: null },
            { op: "create", row: { [dictNameCol.result.id]: "Gamma very long option label" }, beforeRowId: null },
          ],
        },
        ctx()
      );
      const optionIds = dictRows.result.rows.map((row) => row.id);
      const people = await bridge.createTable({ name: "DisplayPeople" }, ctx());
      const peopleId = people.result.id;
      const peopleNameCol = await bridge.createColumn(
        peopleId,
        { column: { name: "Name", type: "text", position: 0, nullable: true } },
        ctx()
      );
      const peopleRows = await bridge.batchRows(
        peopleId,
        {
          ops: [
            { op: "create", row: { [peopleNameCol.result.id]: "Ann Longworth-Whitfield" }, beforeRowId: null },
            { op: "create", row: { [peopleNameCol.result.id]: "Bo Longworth-Whitfield" }, beforeRowId: null },
            { op: "create", row: { [peopleNameCol.result.id]: "Cy Longworth-Whitfield" }, beforeRowId: null },
          ],
        },
        ctx()
      );
      const personIds = peopleRows.result.rows.map((row) => row.id);
      const table = await bridge.createTable({ name: "DisplayCell" }, ctx());
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
      const dtCol = await bridge.createColumn(
        id,
        { column: { name: "DT", type: "timestamptz", position: 2, nullable: true } },
        ctx()
      );
      const tagsCol = await bridge.createColumn(
        id,
        {
          column: {
            name: "Tags",
            type: "text",
            position: 3,
            nullable: true,
            reference: { kind: "enum", tableId: dictId, many: true },
          },
        },
        ctx()
      );
      const ownersCol = await bridge.createColumn(
        id,
        {
          column: {
            name: "Owners",
            type: "text",
            position: 4,
            nullable: true,
            reference: { kind: "row", tableId: peopleId, many: true },
          },
        },
        ctx()
      );
      const statusCol = await bridge.createColumn(
        id,
        {
          column: {
            name: "Status",
            type: "text",
            position: 5,
            nullable: true,
            reference: { kind: "enum", tableId: dictId, many: false },
          },
        },
        ctx()
      );
      await bridge.batchRows(
        id,
        {
          ops: [
            {
              op: "create",
              row: {
                [bodyCol.result.id]:
                  "A very long piece of text that will not fit inside the cell's width and must stand one line with the trailing ellipsis instead of wrapping onto a new line of the row",
                [numCol.result.id]: 123456789,
                [dtCol.result.id]: "2026-10-26T09:15:00",
                [tagsCol.result.id]: optionIds,
                [ownersCol.result.id]: personIds,
                [statusCol.result.id]: optionIds[0]!,
              },
              beforeRowId: null,
            },
          ],
        },
        ctx()
      );
      return {
        tableId: id,
        colIds: {
          body: bodyCol.result.id,
          num: numCol.result.id,
          dt: dtCol.result.id,
          tags: tagsCol.result.id,
          owners: ownersCol.result.id,
          status: statusCol.result.id,
        },
        optionIds,
        personIds,
      };
    });
    const blockA = await a.evaluate((id) => window.__paneDocs!.a!.insertBlock("database", { tableId: id }), tableId);
    // The narrow widths force the multi's chips + the long text over the
    // cell (the fade / the ellipsis stand over the clip).
    await a.evaluate(
      (id) => window.__paneDocs!.a!.updateBlock(id, { columnWidths: [150, 80, 120, 110, 110, 110] }),
      blockA
    );
    await b.evaluate((id) => window.__paneDocs!.b!.insertBlock("database", { tableId: id }), tableId);

    const gridA = a.locator(`[data-block-id='${blockA}'] [data-slot='docblocks/database-grid']`);
    await expect(gridA).toBeVisible(SETTLE);

    // The display styles stand from one read (the grid's own DOM — no
    // locator's auto-wait / the strict-mode's stand over the grid's rows).
    const readStyles = () =>
      a.evaluate(
        ({ blockId, cols }) => {
          const grid = document.querySelector(
            `[data-block-id="${blockId}"] [data-slot="docblocks/database-grid"]`
          ) as HTMLElement | null;
          if (grid === null) return null;
          const cellOf = (col: string) =>
            grid.querySelector(
              `[data-slot="docblocks/database-cell"][data-column-id="${col}"][data-row="0"]`
            ) as HTMLElement | null;
          const displayOf = (col: string) =>
            cellOf(col)?.querySelector('[data-slot="docblocks/database-cell-display"]') as HTMLElement | null;
          // The number / the datetime's display: the `database-cell-display`
          // span (the number) or the popover's trigger (the datetime — the
          // radix's clone stands the `popover-trigger` slot). Both carry the
          // `truncate`'s one line's stand.
          const contentOf = (col: string) =>
            cellOf(col)?.querySelector(
              '[data-slot="docblocks/database-cell-display"], [data-slot="popover-trigger"]'
            ) as HTMLElement | null;
          const chipsOf = (col: string) =>
            cellOf(col)?.querySelector('[data-slot="docblocks/database-ref-chips"]') as HTMLElement | null;
          const chipOf = (col: string) =>
            cellOf(col)?.querySelector('[data-slot="docblocks/database-ref-chip"]') as HTMLElement | null;
          const body = displayOf(cols.body);
          const tags = chipsOf(cols.tags);
          const owners = chipsOf(cols.owners);
          const status = chipsOf(cols.status);
          const num = contentOf(cols.num);
          const dt = contentOf(cols.dt);
          if (body === null || tags === null || owners === null || status === null || num === null || dt === null) {
            return null;
          }
          const cs = (el: Element) => getComputedStyle(el);
          const mask = (el: Element) =>
            cs(el).getPropertyValue("mask-image") || cs(el).getPropertyValue("-webkit-mask-image");
          return {
            bodyWhiteSpace: cs(body).whiteSpace,
            bodyTextOverflow: cs(body).textOverflow,
            bodyHeight: body.getBoundingClientRect().height,
            numWhiteSpace: cs(num).whiteSpace,
            dtWhiteSpace: cs(dt).whiteSpace,
            tagsFade: tags.getAttribute("data-fade"),
            tagsMask: mask(tags),
            tagsChipOverflow: cs(chipOf(cols.tags)!).getPropertyValue("text-overflow"),
            ownersFade: owners.getAttribute("data-fade"),
            ownersMask: mask(owners),
            statusFade: status.getAttribute("data-fade"),
            statusMask: mask(status),
            statusChipOverflow: cs(chipOf(cols.status)!).getPropertyValue("text-overflow"),
          };
        },
        { blockId: blockA, cols: colIds }
      );
    // The readiness: the grid's cells + the displays / the chips stand.
    await expect.poll(async () => (await readStyles()) !== null, SETTLE).toBe(true);
    const styles = await readStyles();

    // ---- The text's display: one line + the ellipsis (the wrap is out).
    expect(styles?.bodyWhiteSpace).toBe("nowrap");
    expect(styles?.bodyTextOverflow).toBe("ellipsis");
    expect(styles?.bodyHeight).toBeLessThan(28);

    // ---- The number / the datetime: one line (the regression — no wrap).
    expect(styles?.numWhiteSpace).toBe("nowrap");
    expect(styles?.dtWhiteSpace).toBe("nowrap");

    // ---- The multi-enum / the multi row-links: the right fade (the mask
    // over the overflow's train; the chips' clip stands none — no ellipsis).
    expect(styles?.tagsFade).toBe("true");
    expect(styles?.tagsMask).toContain("linear-gradient");
    expect(styles?.tagsChipOverflow).toBe("clip");
    expect(styles?.ownersFade).toBe("true");
    expect(styles?.ownersMask).toContain("linear-gradient");

    // ---- The single enum: the chip's ellipsis (the text's stand — the
    // fade stands none, no mask).
    expect(styles?.statusFade).toBe(null);
    expect(styles?.statusMask).toBe("none");
    expect(styles?.statusChipOverflow).toBe("ellipsis");

    // ---- Dark / light: the fade stands the same mask (theme-agnostic —
    // the chip's ink fades to the cell's own background over the theme).
    await a.evaluate(() => document.documentElement.classList.remove("dark"));
    await a.waitForTimeout(50);
    const lightMask = await a.evaluate(
      ({ blockId, tagsColId }) => {
        const grid = document.querySelector(
          `[data-block-id="${blockId}"] [data-slot="docblocks/database-grid"]`
        ) as HTMLElement | null;
        const chips = grid?.querySelector(
          `[data-slot="docblocks/database-cell"][data-column-id="${tagsColId}"][data-row="0"] [data-slot="docblocks/database-ref-chips"]`
        ) as HTMLElement | null;
        return chips !== null ? getComputedStyle(chips).getPropertyValue("mask-image") : null;
      },
      { blockId: blockA, tagsColId: colIds.tags }
    );
    expect(lightMask).toContain("linear-gradient");
    await a.evaluate(() => document.documentElement.classList.add("dark"));
  } finally {
    await close();
  }
});

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

test("the header's type icon stands left of the name (the 10 types' icon set; the muted token's color; the px-2 stands)", async ({
  browser,
}) => {
  const context = await editorContext(browser);
  const a = await context.newPage();
  try {
    await openPane(a, "a", "db-typeicon-" + Math.random().toString(36).slice(2, 8));

    // The main table: one column per type (the 10). The ref columns' ref
    // tables stand (the enum's dict / the row's linked table).
    const { mainId, expected, colIds } = await a.evaluate(async () => {
      const bridge = window.__bridge!;
      const ctx = () => ({ operationId: crypto.randomUUID(), issuedAt: new Date().toISOString() });
      const dict = await bridge.createTable({ name: "TypeIcon-enum", system: true }, ctx());
      const dictId = dict.result.id;
      await bridge.createColumn(dictId, { column: { name: "name", type: "text", position: 0, nullable: true } }, ctx());
      await bridge.createColumn(
        dictId,
        { column: { name: "color", type: "text", position: 1, nullable: true } },
        ctx()
      );
      const link = await bridge.createTable({ name: "TypeIcon-link" }, ctx());
      const linkId = link.result.id;
      await bridge.createColumn(
        linkId,
        { column: { name: "Label", type: "text", position: 0, nullable: true } },
        ctx()
      );
      const main = await bridge.createTable({ name: "TypeIcons" }, ctx());
      const mainId = main.result.id;
      const spec: {
        key: string;
        name: string;
        type: string;
        reference?: { kind: "enum" | "row"; tableId: string; many: boolean };
      }[] = [
        { key: "c_text", name: "Text", type: "text" },
        { key: "c_int", name: "Int", type: "integer" },
        { key: "c_dec", name: "Dec", type: "numeric" },
        { key: "c_bool", name: "Bool", type: "boolean" },
        { key: "c_date", name: "Date", type: "date" },
        { key: "c_dt", name: "DT", type: "timestamptz" },
        { key: "c_enum", name: "Enum", type: "text", reference: { kind: "enum", tableId: dictId, many: false } },
        { key: "c_multi", name: "Multi", type: "text", reference: { kind: "enum", tableId: dictId, many: true } },
        { key: "c_rowlink", name: "RL", type: "text", reference: { kind: "row", tableId: linkId, many: false } },
        {
          key: "c_rowlinks",
          name: "RLs",
          type: "text",
          reference: { kind: "row", tableId: linkId, many: true },
        },
      ];
      const colIds: Record<string, string> = {};
      for (let index = 0; index < spec.length; index++) {
        const s = spec[index]!;
        const receipt = await bridge.createColumn(
          mainId,
          {
            column: {
              name: s.name,
              type: s.type,
              position: index,
              nullable: true,
              ...(s.reference !== undefined ? { reference: s.reference } : {}),
            },
          },
          ctx()
        );
        colIds[s.key] = receipt.result.id;
      }
      return {
        mainId,
        colIds,
        expected: {
          c_text: "type",
          c_int: "hash",
          c_dec: "hash",
          c_bool: "circle-check",
          c_date: "calendar",
          c_dt: "calendar-clock",
          c_enum: "circle-chevron-down",
          c_multi: "list-checks",
          c_rowlink: "cable",
          c_rowlinks: "cable",
        },
      };
    });
    const blockA = await a.evaluate((id) => window.__paneDocs!.a!.insertBlock("database", { tableId: id }), mainId);

    // The header's icon stand from one read (the grid's own DOM — no locator's
    // auto-wait / the strict-mode's stand over the grid's rows): per column,
    // the direct-child svg's shape signature (the svg's path data +
    // the line/rect/circle counts) + the icon's left of the name.
    const readIcons = (pane: Page) =>
      pane.evaluate((id) => {
        const grid = document.querySelector(
          `[data-block-id="${id}"] [data-slot="docblocks/database-grid"]`
        ) as HTMLElement | null;
        if (grid === null) return null;
        const out: Record<string, { sig: string; iconLeftOfName: boolean }> = {};
        for (const cell of Array.from(
          grid.querySelectorAll<HTMLElement>('[data-slot="docblocks/database-header-cell"]')
        )) {
          const colId = cell.getAttribute("data-column-id")!;
          const icon = cell.querySelector<SVGElement>(":scope > svg");
          const nameSpan = cell.querySelector<HTMLElement>(":scope > span");
          if (icon === null || nameSpan === null) return null;
          const paths = Array.from(icon.querySelectorAll("path")).map((p) => p.getAttribute("d") ?? "");
          const sig = [
            `lines=${icon.querySelectorAll("line").length}`,
            `rects=${icon.querySelectorAll("rect").length}`,
            `circles=${icon.querySelectorAll("circle").length}`,
            `paths=${paths.join(",")}`,
          ].join(";");
          out[colId] = {
            sig,
            iconLeftOfName: icon.getBoundingClientRect().left < nameSpan.getBoundingClientRect().left,
          };
        }
        return out;
      }, blockA);

    // The markers the default SVG set stands (the mapping's parity over the
    // former icon's class read): per type, the distinctive element's count
    // + the path datum (the contains' stand over the full signature — the
    // shape's identity, not the byte's).
    const MARKERS: Record<string, string[]> = {
      type: ["circles=0;paths=", "M12 4v16", "M4 7V5a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v2"],
      hash: ["lines=4"],
      "circle-check": ["circles=1", "m16 9-5.5 5.5L8 12"],
      calendar: ["rects=1", "M3 9h18"],
      "calendar-clock": ["circles=1", "M16 14v2.2l1.6 1"],
      "circle-chevron-down": ["circles=1", "m16 10-4 4-4-4"],
      "list-checks": ["M13 5h8", "m3 17 2 2 4-4"],
      cable: ["M19 14V6.5a1 1 0 0 0-7 0v11a1 1 0 0 1-7 0V10"],
    };
    // The pane's icons stand the type's markers (the mapping) + the icon's
    // left of the name.
    await expect.poll(async () => (await readIcons(a)) !== null, SETTLE).toBe(true);
    const icons = (await readIcons(a))!;
    for (const [col, type] of Object.entries(expected)) {
      const columnId = colIds[col]!;
      for (const marker of MARKERS[type]!) {
        expect(icons[columnId]?.sig, `the ${col}'s icon's signature`).toContain(marker);
      }
      expect(icons[columnId]?.iconLeftOfName, `the ${col}'s icon's left of the name`).toBe(true);
    }

    // The icon's color resolves the muted-foreground token (the theme-
    // independent stand — the probe stands the token's resolved value).
    const iconColor = (pane: Page) =>
      pane.evaluate(
        ({ id, textColId }) => {
          const grid = document.querySelector(`[data-block-id="${id}"] [data-slot="docblocks/database-grid"]`)!;
          const icon = grid.querySelector<SVGElement>(
            `[data-slot="docblocks/database-header-cell"][data-column-id="${textColId}"] > svg`
          )!;
          const probe = document.createElement("div");
          probe.style.color = "var(--muted-foreground)";
          probe.style.position = "absolute";
          document.body.appendChild(probe);
          const token = getComputedStyle(probe).color;
          probe.remove();
          return { icon: getComputedStyle(icon).color, token };
        },
        { id: blockA, textColId: colIds.c_text }
      );
    // The dark stand (the explicit dark): the color resolves the token.
    await a.evaluate(() => document.documentElement.classList.add("dark"));
    const dark = await iconColor(a);
    expect(dark.icon).toBe(dark.token);
    // The light stand (the flip stands the resolution).
    await a.evaluate(() => document.documentElement.classList.remove("dark"));
    const light = await iconColor(a);
    expect(light.icon).toBe(light.token);
  } finally {
    await context.close();
  }
});

test("the header's name stands the uniform gap chain over all the column's types (the cell's edge → the icon → the name — the per-type's pins)", async ({
  browser,
}) => {
  const { a, close } = await twoPanesSharedContext(browser, "db-header-gap");
  try {
    // The main table: one column per type (the 10) — the name's length
    // stands different (the gap's parity is over the name's width, not the
    // name's).
    const { mainId, cols } = await a.evaluate(async () => {
      const bridge = window.__bridge!;
      const ctx = () => ({ operationId: crypto.randomUUID(), issuedAt: new Date().toISOString() });
      const dict = await bridge.createTable({ name: "Gap-enum", system: true }, ctx());
      const dictId = dict.result.id;
      await bridge.createColumn(dictId, { column: { name: "name", type: "text", position: 0, nullable: true } }, ctx());
      const link = await bridge.createTable({ name: "Gap-link" }, ctx());
      const linkId = link.result.id;
      await bridge.createColumn(
        linkId,
        { column: { name: "Label", type: "text", position: 0, nullable: true } },
        ctx()
      );
      const main = await bridge.createTable({ name: "GapTable" }, ctx());
      const mainId = main.result.id;
      const spec: {
        name: string;
        type: string;
        reference?: { kind: "enum" | "row"; tableId: string; many: boolean };
      }[] = [
        { name: "Text", type: "text" },
        { name: "Int", type: "integer" },
        { name: "Decimal", type: "numeric" },
        { name: "Bool", type: "boolean" },
        { name: "Date", type: "date" },
        { name: "DateTime", type: "timestamptz" },
        { name: "Enum", type: "text", reference: { kind: "enum", tableId: dictId, many: false } },
        { name: "Multi", type: "text", reference: { kind: "enum", tableId: dictId, many: true } },
        { name: "RowLink", type: "text", reference: { kind: "row", tableId: linkId, many: false } },
        { name: "RLs", type: "text", reference: { kind: "row", tableId: linkId, many: true } },
      ];
      const cols: string[] = [];
      for (let index = 0; index < spec.length; index++) {
        const s = spec[index]!;
        const receipt = await bridge.createColumn(
          mainId,
          {
            column: {
              name: s.name,
              type: s.type,
              position: index,
              nullable: true,
              ...(s.reference !== undefined ? { reference: s.reference } : {}),
            },
          },
          ctx()
        );
        cols.push(receipt.result.id);
      }
      return { mainId, cols };
    });
    const blockA = await a.evaluate((id) => window.__paneDocs!.a!.insertBlock("database", { tableId: id }), mainId);

    // The gap chain's read (the grid's own DOM): per column, the gap the
    // icon's left edge stands off the cell's content edge (the cell's
    // border-left over the non-first stand) + the gap the name's text left
    // edge stands off the icon's right edge (the text's bbox — the name's
    // stand over the icon, not the value's edge).
    const readGaps = () =>
      a.evaluate((id) => {
        const grid = document.querySelector(
          `[data-block-id="${id}"] [data-slot="docblocks/database-grid"]`
        ) as HTMLElement | null;
        if (grid === null) return null;
        const out: Record<string, { cellToIcon: number; iconToText: number }> = {};
        for (const cell of Array.from(
          grid.querySelectorAll<HTMLElement>("[data-slot='docblocks/database-header-cell']")
        )) {
          const colId = cell.getAttribute("data-column-id")!;
          const icon = cell.querySelector<SVGElement>(":scope > svg");
          const span = cell.querySelector<HTMLElement>(":scope > span");
          if (icon === null || span === null) return null;
          const cellR = cell.getBoundingClientRect();
          const borderLeft = parseFloat(getComputedStyle(cell).borderLeftWidth) || 0;
          const iconR = icon.getBoundingClientRect();
          const range = document.createRange();
          range.selectNodeContents(span);
          const textR = range.getBoundingClientRect();
          if (textR.width === 0) return null;
          out[colId] = {
            cellToIcon: iconR.left - (cellR.left + borderLeft),
            iconToText: textR.left - iconR.right,
          };
        }
        return out;
      }, blockA);
    await expect.poll(async () => (await readGaps()) !== null, SETTLE).toBe(true);
    const gaps = (await readGaps())!;
    // Every type's chain stands the same (the cell's edge → the icon's 8
    // px, the icon's → the name's 8 px — the gap-1 + the px-1's parity; the
    // former align's stand pushed the number/boolean's names off the
    // icon's over the name's width).
    for (const col of cols) {
      expect(gaps[col]?.cellToIcon, `the ${col}'s cell → icon's gap`).toBeCloseTo(8, 1);
      expect(gaps[col]?.iconToText, `the ${col}'s icon → name's gap`).toBeCloseTo(8, 1);
    }
  } finally {
    await close();
  }
});

test("the header's Ellipsis stands the cell's vertical center (the border's half's stand; the right zone's stand; the menu's open regression)", async ({
  browser,
}) => {
  const { a, close } = await twoPanesSharedContext(browser, "db-ellipsis-center");
  try {
    const { blockA, colIds } = await a.evaluate(async () => {
      const bridge = window.__bridge!;
      const ctx = () => ({ operationId: crypto.randomUUID(), issuedAt: new Date().toISOString() });
      const table = await bridge.createTable({ name: "EllipsisCenter" }, ctx());
      const id = table.result.id;
      const spec: [string, string][] = [
        ["Alpha", "text"],
        ["Beta", "integer"],
        ["Gamma", "boolean"],
      ];
      const colIds: string[] = [];
      for (let index = 0; index < spec.length; index++) {
        const [name, type] = spec[index]!;
        const receipt = await bridge.createColumn(
          id,
          { column: { name, type, position: index, nullable: true } },
          ctx()
        );
        colIds.push(receipt.result.id);
      }
      return {
        blockA: window.__paneDocs!.a!.insertBlock("database", { tableId: id }),
        colIds,
      };
    });
    const gridA = a.locator(`[data-block-id='${blockA}'] [data-slot='docblocks/database-grid']`);
    await expect(gridA).toBeVisible(SETTLE);

    // The vertical center's stand (the grid's own DOM's read): per column,
    // the Ellipsis's icon center vs the cell's center (the border-box — the
    // 1 px bottom border stands over the content's center's read).
    const readCenter = () =>
      a.evaluate((id) => {
        const grid = document.querySelector(
          `[data-block-id="${id}"] [data-slot="docblocks/database-grid"]`
        ) as HTMLElement | null;
        if (grid === null) return null;
        const out: Record<string, { deltaY: number; rightOffset: number }> = {};
        for (const cell of Array.from(
          grid.querySelectorAll<HTMLElement>("[data-slot='docblocks/database-header-cell']")
        )) {
          const colId = cell.getAttribute("data-column-id")!;
          const btn = cell.querySelector<HTMLElement>("[data-slot='docblocks/database-column-menu']");
          const svg = btn?.querySelector("svg") ?? null;
          if (btn === null || svg === null) return null;
          const cellR = cell.getBoundingClientRect();
          const svgR = svg.getBoundingClientRect();
          out[colId] = {
            deltaY: svgR.top + svgR.height / 2 - (cellR.top + cellR.height / 2),
            rightOffset: cellR.right - btn.getBoundingClientRect().right,
          };
        }
        return out;
      }, blockA);
    await expect.poll(async () => (await readCenter()) !== null, SETTLE).toBe(true);
    const center = (await readCenter())!;
    for (const col of colIds) {
      // The icon's center stands the cell's center (the border's half's
      // stand — the 1 px bottom border over the content's center).
      expect(Math.abs(center[col]?.deltaY ?? 1), `the ${col}'s vertical's delta`).toBeLessThanOrEqual(0.5);
      // The button's right edge stands the cell's right padding (the px-2's
      // stand — the right zone's regression: the Ellipsis stands right).
      expect(center[col]?.rightOffset, `the ${col}'s right's offset`).toBeCloseTo(8, 1);
    }

    // The menu's open stands the Ellipsis's press (the center's stand did
    // not break the trigger — the rename's input stands over the open).
    const btnA = a.locator(
      `[data-block-id='${blockA}'] [data-slot='docblocks/database-header-cell'][data-column-id='${colIds[0]}'] [data-slot='docblocks/database-column-menu']`
    );
    await btnA.click();
    expect(await a.locator("[data-slot='docblocks/database-rename-input']").count()).toBe(1);
  } finally {
    await close();
  }
});

test("the header's cursor stands the grab zone (the Ellipsis's pointer; the seam's col-resize centered on the border)", async ({
  browser,
}) => {
  const { a, close } = await twoPanes(browser, "db-header-cursor");
  const demo = await bridgeDemoTable(a);
  await a.evaluate((tableId) => window.__paneDocs!.a!.insertBlock("database", { tableId }), demo.id);
  const gridA = a.locator("[data-slot='docblocks/database-grid']");
  await expect(gridA).toHaveCount(1, SETTLE);
  const { Title: titleColId } = await demoColumns(a, demo.id, ["Title"]);
  const titleHeader = a.locator(`[data-slot='docblocks/database-header-cell'][data-column-id='${titleColId}']`);
  await expect(titleHeader).toBeVisible(SETTLE);

  // The cell's grab (the drag's affordance) and the Ellipsis's button's
  // pointer (the menu's affordance) stand the header's cursor's zones.
  const cellCursor = await titleHeader.evaluate((el) => getComputedStyle(el).cursor);
  const btnCursor = await titleHeader
    .locator("[data-slot='docblocks/database-column-menu']")
    .evaluate((el) => getComputedStyle(el).cursor);
  expect(cellCursor).toBe("grab");
  expect(btnCursor).toBe("pointer");

  // The seam stands centered on the cell's right edge (the 3 px over each
  // side): the strip's center + the line's center stand the border (the
  // pointer over the line stands the stable col-resize).
  const seam = a.locator("[data-slot='docblocks/database-col-resize'][data-index='0']");
  const line = seam.locator("[data-slot='docblocks/database-col-resize-line']");
  const headerBox = (await titleHeader.boundingBox())!;
  const seamBox = (await seam.boundingBox())!;
  const lineBox = (await line.boundingBox())!;
  const borderX = headerBox.x + headerBox.width;
  expect(Math.abs(seamBox.x + seamBox.width / 2 - borderX)).toBeLessThanOrEqual(0.5);
  expect(Math.abs(lineBox.x + lineBox.width / 2 - borderX)).toBeLessThanOrEqual(0.5);
  expect(await seam.evaluate((el) => getComputedStyle(el).cursor)).toBe("col-resize");

  // The header's sweep stands the grab over the cells + the Ellipsis's
  // pointer + the col-resize's stand over the seams only (the auto stands
  // off the header's zone — the block's edge + the add-column's column
  // keep their own).
  const sweep = await a.evaluate(() => {
    const grid = document.querySelector("[data-slot='docblocks/database-grid']") as HTMLElement;
    const cells = Array.from(grid.querySelectorAll<HTMLElement>("[data-slot='docblocks/database-header-cell']"));
    const first = cells[0]!.getBoundingClientRect();
    const last = cells[cells.length - 1]!.getBoundingClientRect();
    const set = new Set<string>();
    for (let x = first.left + 1; x <= last.right - 1; x += 2) {
      const el = document.elementFromPoint(x, first.top + first.height / 2);
      if (el !== null) set.add(getComputedStyle(el).cursor);
    }
    return Array.from(set);
  });
  expect(sweep).toEqual(expect.arrayContaining(["grab", "col-resize"]));
  expect(sweep.every((value) => ["grab", "pointer", "col-resize"].includes(value))).toBeTruthy();

  await close();
});

test("the header's menu opens only over the Ellipsis (the name's press stands nothing; the drag reorders; the cursor stands grab)", async ({
  browser,
}) => {
  const { a, b, close } = await twoPanesSharedContext(browser, "db-header-menu");
  try {
    const { tableId, blockA, colIds } = await a.evaluate(async () => {
      const bridge = window.__bridge!;
      const ctx = () => ({ operationId: crypto.randomUUID(), issuedAt: new Date().toISOString() });
      const table = await bridge.createTable({ name: "HeaderMenu" }, ctx());
      const id = table.result.id;
      const names = ["Alpha", "Beta", "Gamma"];
      const colIds: string[] = [];
      for (let index = 0; index < names.length; index++) {
        const receipt = await bridge.createColumn(
          id,
          { column: { name: names[index]!, type: "text", position: index, nullable: true } },
          ctx()
        );
        colIds.push(receipt.result.id);
      }
      const blockA = window.__paneDocs!.a!.insertBlock("database", { tableId: id });
      return { tableId: id, blockA, colIds };
    });
    await b.evaluate((id) => window.__paneDocs!.b!.insertBlock("database", { tableId: id }), tableId);

    const headerA = a.locator(
      `[data-block-id='${blockA}'] [data-slot='docblocks/database-header-cell'][data-column-id='${colIds[0]}']`
    );
    await expect(headerA).toBeVisible(SETTLE);

    // The cursor stands grab over the header (the drag's affordance — the
    // hand; the active's grabing over the press's stand).
    expect(await headerA.evaluate((el) => getComputedStyle(el).cursor)).toBe("grab");

    // A click on the name's zone (the header's left part — the Ellipsis
    // stands right) stands nothing: the column menu's popover stands absent
    // (the Ellipsis's own press is the only menu-open's trigger).
    const nameSpan = headerA.locator(":scope > span").first();
    const nameBox = (await nameSpan.boundingBox())!;
    await a.mouse.click(nameBox.x + nameBox.width / 2, nameBox.y + nameBox.height / 2);
    await a.waitForTimeout(250);
    // The menu's rename input (the column menu's content) stands absent.
    expect(await a.locator("[data-slot='docblocks/database-rename-input']").count()).toBe(0);

    // The Ellipsis's press stands the menu (the rename's input + the items
    // — the existing's content's regression: the type's line stands).
    await a
      .locator(
        `[data-block-id='${blockA}'] [data-slot='docblocks/database-header-cell'][data-column-id='${colIds[0]}'] [data-slot='docblocks/database-column-menu']`
      )
      .click();
    const rename = a.locator("[data-slot='docblocks/database-rename-input']");
    await expect(rename).toBeVisible(SETTLE);
    await expect(a.locator("[data-slot='docblocks/database-column-type']")).toHaveText("text", SETTLE);
    await a.keyboard.press("Escape");
    await expect(rename).toHaveCount(0, SETTLE);

    const headerOrder = (pane: Page) =>
      pane
        .locator(`[data-block-id='${blockA}'] [data-slot='docblocks/database-header-cell']`)
        .evaluateAll((cells) => cells.map((cell) => cell.getAttribute("data-column-id")));
    // Before the drag: the first column stands first (the creation's order).
    expect((await headerOrder(a))[0]).toBe(colIds[0]);

    // The drag's reorder stands from the header's name's zone (the past-
    // threshold's press: the columnOrder's commit, both panes' resync). The
    // name's stand is the same zone (the click's point) — the drag is a
    // past-threshold press, not the click's no-op. The target stands past
    // the last column's live midpoint (the parting's shift) — the first
    // column lands at the sequence's end.
    const dragBox = (await headerA.boundingBox())!;
    const lastColBox = (await a
      .locator(
        `[data-block-id='${blockA}'] [data-slot='docblocks/database-header-cell'][data-column-id='${colIds[2]}']`
      )
      .boundingBox())!;
    await a.mouse.move(dragBox.x + 12, dragBox.y + dragBox.height / 2);
    await a.mouse.down();
    await a.mouse.move(lastColBox.x + lastColBox.width + 50, dragBox.y + dragBox.height / 2, { steps: 12 });
    await a.waitForTimeout(250);
    await a.mouse.up();

    // After the drag: the first column stands no longer first (the
    // reorder's commit).
    await expect.poll(async () => (await headerOrder(a))[0], SETTLE).not.toBe(colIds[0]);
    // Pane B's grid resyncs from the columnOrder's attr (the wire's commit).
    await expect.poll(async () => (await headerOrder(b))[0], SETTLE).not.toBe(colIds[0]);
  } finally {
    await close();
  }
});
