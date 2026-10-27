import { type Browser, type Page, expect, test } from "@playwright/test";

import { insertBlockType } from "./helpers";

// Each test gets its own room via ?syncUrl= — the relay keeps rooms for
// the dev server's lifetime, so a shared room would be polluted by other
// spec files (and by manually opened tabs).
const RELAY = "ws://localhost:5199";
const SETTLE = { timeout: 15_000 };

async function openPane(page: Page, client: "a" | "b", room: string): Promise<void> {
  await page.goto(`/?client=${client}&syncUrl=${RELAY}/${room}`);
  await expect(page.getByTestId(`status-${client}`)).toHaveText("connected");
}

/** Insert one v1 type at the root through the pane's harness control. */
async function insertType(page: Page, client: "a" | "b", type: string): Promise<void> {
  await insertBlockType(page, client, type);
}

async function twoPanes(browser: Browser, room: string): Promise<{ a: Page; b: Page; close: () => Promise<void> }> {
  const contextA = await browser.newContext();
  const contextB = await browser.newContext();
  const a = await contextA.newPage();
  const b = await contextB.newPage();
  const uniqueRoom = `${room}-${Math.random().toString(36).slice(2, 8)}`;
  await openPane(a, "a", uniqueRoom);
  await openPane(b, "b", uniqueRoom);
  return {
    a,
    b,
    close: async () => {
      await contextA.close();
      await contextB.close();
    },
  };
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
 * table's ref. Both panes (separate pages) seed the identical
 * deterministic table, so the id matches across them and a `tableId`
 * reference inserted in A resolves in B.
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

test("the slash Database picker's create-new: the auto-focused form, the Enter commit over the wire", async ({
  browser,
}) => {
  // The shared context (the same origin): the default bridges share the
  // `BroadcastChannel` echo, so the created table stands in both panes.
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
    // the Enter commits (over the wire to pane B).
    await a.keyboard.type("My Board");
    await expect(check).toBeEnabled();
    await a.keyboard.press("Enter");
    // The block with the tableId reference lands (the phrase strips), and
    // the new table resolves in both panes (the shared default bridge).
    const wrapperA = a.locator("[data-block-type='database']");
    await expect(wrapperA).toHaveCount(1, SETTLE);
    await expect(wrapperA.locator("[data-slot='docblocks/database-name']")).toHaveText("My Board", SETTLE);
    const wrapperB = b.locator("[data-block-type='database']");
    await expect(wrapperB).toHaveCount(1, SETTLE);
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
    const other = await a.evaluate(() => window.__bridge!.createTable("Zebra Board"));
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
 * Two panes in ONE browser context (the same origin): the default in-memory
 * bridges share the `BroadcastChannel` echo, so a row mutation driven on
 * pane B's bridge is delivered to pane A's bridge (and the grid refetches)
 * without any HTTP and without a doc update. The existing `twoPanes` helper
 * uses separate contexts (isolated origins) — the bridge echo does not cross
 * them, so this test needs the shared-context variant.
 */
async function twoPanesSharedContext(
  browser: Browser,
  room: string
): Promise<{ a: Page; b: Page; close: () => Promise<void> }> {
  const context = await browser.newContext();
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

test("the bridge is live: a row mutation in pane B's bridge reaches pane A's grid (no doc wire)", async ({
  browser,
}) => {
  const { a, b, close } = await twoPanesSharedContext(browser, "ext04-bridge-live");

  // Both panes' default bridges converge on the seeded demo table (the
  // shared-channel echo); poll until each bridge reports it with rows.
  const demoA = await bridgeDemoTable(a);
  const demoB = await bridgeDemoTable(b);
  expect(demoA.id).toBe(demoB.id);

  await a.evaluate((tableId) => {
    window.__paneDocs!.a!.insertBlock("database", { tableId });
  }, demoA.id);
  const gridA = a.locator("[data-block-type='database']");
  await expect(gridA.locator("[data-slot='docblocks/database-count']")).toHaveText("3 rows", SETTLE);

  // A row id from pane B's bridge + the doc-wire baseline on A (the row
  // data is not in the doc, so the mutation must not move it).
  const rowId = await b.evaluate(async (tableId) => {
    const page = await window.__bridge!.queryRows(tableId, {});
    const [first] = Object.keys(page.rows);
    return first ?? null;
  }, demoB.id);
  expect(rowId).not.toBeNull();
  const outBefore = await a.locator("[data-testid='wire-a'] li", { hasText: " out " }).count();

  // Drive the mutation on pane B's bridge (the consumer's table write).
  await b.evaluate(({ tableId, rowId }) => window.__bridge!.updateRow(tableId, rowId!, { title: "SYNCED" }), {
    tableId: demoB.id,
    rowId,
  });

  // Pane A's grid refetches from its bridge (the shared-echo event) and
  // shows the updated title — no HTTP, no doc update. The cell stands the
  // display (the stand until the double press), so assert on the text.
  const titleCells = gridA.locator("[data-slot='docblocks/database-cell'][data-column-id='title']");
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

  await close();
});

test("the display name: the rename renames the table (the bridge's attribute) — every block over the tableId stands it", async ({
  browser,
}) => {
  // The panes share one context (the same origin): the default bridges
  // echo the table events over the BroadcastChannel, so the rename stands
  // in both panes over the bridge (no doc update).
  const { a, b, close } = await twoPanesSharedContext(browser, "ext04-table-name");

  const demo = await bridgeDemoTable(a);
  const dbId = (await a.evaluate((tableId) => window.__paneDocs!.a!.insertBlock("database", { tableId }), demo.id))!;
  // The second block over the same table (pane B's doc, synced over): its
  // name stand is the table's attribute too.
  await b.evaluate((tableId) => window.__paneDocs!.b!.insertBlock("database", { tableId }), demo.id);

  const nameA = a.locator("[data-slot='docblocks/database-name']");
  const nameB = b.locator("[data-slot='docblocks/database-name']");
  // The bridge's table name stands by default (both blocks, both panes).
  await expect(nameA.first()).toHaveText("Demo", SETTLE);
  await expect(nameB.first()).toHaveText("Demo", SETTLE);

  // The rename (the header's line): the commit is the blur.
  await nameA.first().click();
  const input = a.locator("[data-slot='docblocks/database-name-input']").first();
  await expect(input).toBeVisible(SETTLE);
  await input.fill("My Board");
  await input.blur();
  await expect(nameA.first()).toHaveText("My Board", SETTLE);
  // The table's attribute stands in every block over the tableId — both
  // panes' both blocks (the echo over the shared context).
  await expect(nameA.nth(1)).toHaveText("My Board", SETTLE);
  await expect(nameB.first()).toHaveText("My Board", SETTLE);
  await expect(nameB.nth(1)).toHaveText("My Board", SETTLE);
  // No doc write: the blocks' JSON stands untouched (no `name` attr).
  const names = await a.evaluate(
    (ids) => ids.map((id) => window.__paneDocs!.a!.getBlock(id)?.attrs?.name ?? null),
    [dbId]
  );
  expect(names).toEqual([null]);

  // The grid's undo reverts the rename (the bridge's undo stack: the table
  // name stands back over the echo, both panes).
  await a.locator("[data-slot='docblocks/database-cell'][data-column-id='title']").first().click();
  await a.keyboard.press("Control+z");
  await expect(nameA.first()).toHaveText("Demo", SETTLE);
  await expect(nameB.nth(1)).toHaveText("Demo", SETTLE);

  await close();
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
  const titleHeader = a.locator("[data-slot='docblocks/database-header-cell'][data-column-id='title']");
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
    .locator("[data-slot='docblocks/database-cell'][data-column-id='title']")
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
  const draggedMid = midStands.find((entry) => entry.id === "title");
  expect(draggedMid?.tf).toMatch(/translateX\((\d+(\.\d+)?px)\)/);
  const stationaryShifted = midStands.filter((entry) => entry.id !== "title" && entry.tf !== "");
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
      return orderA[0] !== "title";
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

test("the create's column order stands the creation order (the new stands last); the create commit keeps the columnOrder complete", async ({
  browser,
}) => {
  // The shared-context panes: the default bridges share the BroadcastChannel
  // echo, so the columns pane A creates stand over the wire in pane B.
  const { a, b, close } = await twoPanesSharedContext(browser, "ext04-colorder");

  // A fresh (empty) table: the create's order is the append's stand.
  const tableId = await a.evaluate(async () => {
    const bridge = window.__bridge!;
    await bridge.listTables();
    return bridge.createTable("colorder-" + Date.now());
  });
  const dbId = (await a.evaluate((tableId) => window.__paneDocs!.a!.insertBlock("database", { tableId }), tableId))!;

  const gridA = a.locator("[data-testid=\"doc-a\"] [data-slot='docblocks/database-grid']");
  await expect(gridA).toHaveCount(1, SETTLE);
  const gridB = b.locator("[data-testid=\"doc-b\"] [data-slot='docblocks/database-grid']");
  await expect(gridB).toHaveCount(1, SETTLE);

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
        return block?.type === "database" ? (block.attrs?.columnOrder ?? null) : null;
      },
      { c: client, id: dbId }
    );

  // Create: decimal -> text -> enum (the create form's sequence).
  await addColumn(a, "decimal", "Dec");
  await addColumn(a, "text", "Txt");
  await addColumn(a, "enum", "Status");

  // The header's DOM order stands the creation order (the new stands last);
  // both panes stand the same order over the bridge's echo.
  await expect.poll(async () => headerIds(a, "a"), SETTLE).toEqual(["col1", "col2", "col3"]);
  await expect.poll(() => headerIds(b, "b"), SETTLE).toEqual(["col1", "col2", "col3"]);
  // No explicit columnOrder yet (the bridge's schema order stands).
  expect(await columnOrderOf(a, "a")).toBeNull();

  // The create commit's columnOrder consistency: the block's explicit
  // columnOrder (a drag's stand — the visible order) keeps the new column
  // appended to its end (the one updateBlock). Simulate the drag's stand.
  await a.evaluate((id) => window.__paneDocs!.a!.updateBlock(id, { columnOrder: ["col2", "col1", "col3"] }), dbId);
  await addColumn(a, "text", "Link"); // col4
  await expect.poll(async () => headerIds(a, "a"), SETTLE).toEqual(["col2", "col1", "col3", "col4"]);
  await expect.poll(() => headerIds(b, "b"), SETTLE).toEqual(["col2", "col1", "col3", "col4"]);
  expect(await columnOrderOf(a, "a")).toEqual(["col2", "col1", "col3", "col4"]);
  expect(await columnOrderOf(b, "b")).toEqual(["col2", "col1", "col3", "col4"]);

  // The create's undo stands the order back: the grid's Undo (the bridge's
  // stack — the column's removal) drops the new column; the visible order
  // stands the previous one (the columnOrder's stale tail stands ignored —
  // the next drag re-commits it).
  await a.locator("[data-slot='docblocks/database-undo']").click();
  await expect.poll(async () => (await headerIds(a, "a")).length, SETTLE).toBe(3);
  await expect.poll(() => headerIds(a, "a"), SETTLE).toEqual(["col2", "col1", "col3"]);
  await expect.poll(() => headerIds(b, "b"), SETTLE).toEqual(["col2", "col1", "col3"]);

  await close();
});

test("the header's name stands the px-2 padding (the text stands over the data's text; the rename stands)", async ({
  browser,
}) => {
  const context = await browser.newContext();
  const a = await context.newPage();
  try {
    await openPane(a, "a", "ext04-header-pad-" + Math.random().toString(36).slice(2, 8));

    const tableId = await a.evaluate(async () => {
      const bridge = window.__bridge!;
      await bridge.listTables();
      const id = await bridge.createTable("header-pad-" + Date.now());
      await bridge.createColumn(id, { id: "c1", name: "Alpha Column Name", type: "text" });
      const row = { id: "r1" };
      await bridge.insertRow(id, row);
      await bridge.updateRow(id, "r1", { c1: "DataCellText" });
      return id;
    });
    await a.evaluate((tableId) => window.__paneDocs!.a!.insertBlock("database", { tableId }), tableId);

    const grid = a.locator("[data-slot='docblocks/database-grid']");
    await expect(grid).toHaveCount(1, SETTLE);

    // The header cell's computed padding-x stands 8px (the px-2 — the
    // `4px 8px` token's no-longer-misread padding-inline).
    const headerPadding = () =>
      a.locator("[data-slot='docblocks/database-header-cell'][data-column-id='c1']").evaluate((el) => {
        const cs = getComputedStyle(el);
        return { left: cs.paddingLeft, right: cs.paddingRight };
      });
    // The type's icon stands the left (the px-2's 8px padding edge — the
    // icon is inside the padding), and the name stands to the right of it
    // (the icon is left of the name; the data-alignment's former stand is
    // the icon's now, the name's shifted by the icon's width + gap).
    const iconStands = () =>
      a.evaluate(() => {
        const grid = document.querySelector('[data-slot="docblocks/database-grid"]')!;
        const headerCell = grid.querySelector(
          '[data-slot="docblocks/database-header-cell"][data-column-id="c1"]'
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
      });

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
    const headerCell = a.locator("[data-slot='docblocks/database-header-cell'][data-column-id='c1']");
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

test("the enum cell stands the package's EnumPicker (the pick stands over the wire); the number cell suppresses the spin buttons", async ({
  browser,
}) => {
  // The shared-context panes (the same origin): the default bridges share
  // the BroadcastChannel echo, so the pick's row commit reaches pane B.
  const { a, b, close } = await twoPanesSharedContext(browser, "ext04-cells");

  const demo = await bridgeDemoTable(a);
  const dbId = (await a.evaluate((tableId) => window.__paneDocs!.a!.insertBlock("database", { tableId }), demo.id))!;

  const gridA = a.locator("[data-slot='docblocks/database-grid']");
  await expect(gridA).toHaveCount(1, SETTLE);
  const gridB = b.locator("[data-slot='docblocks/database-grid']");
  await expect(gridB).toHaveCount(1, SETTLE);

  // The single-enum cell stands the package's EnumPicker trigger (the chip
  // over the popover — the Radix's Select is out over the enum), not a
  // native <select> (the demo table's status column): the cell stands the
  // display, the trigger is the inner chip, and the list opens on the
  // double press (the single press is the selection).
  const enumCellA = a.locator("[data-slot='docblocks/database-cell'][data-column-id='status']").first();
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
  // "doing" pick commits over the wire (the row is the consumer's data —
  // pane B's bridge and grid resync from the bridge's echo, the doc stands
  // unchanged).
  await enumCellA.dblclick();
  const option = a.locator("[data-slot='docblocks/database-enum-picker-row'][data-option-value='doing']");
  await expect(option).toBeVisible(SETTLE);
  await option.click();
  await expect(enumCellA).toHaveText("doing", SETTLE);
  const enumCellB = b.locator("[data-slot='docblocks/database-cell'][data-column-id='status']").first();
  await expect(enumCellB).toHaveText("doing", SETTLE);
  const rowB = await b.evaluate(async () => {
    const table = (await window.__bridge!.listTables()).find((item) => item.name === "Demo")!;
    const page = await window.__bridge!.queryRows(table!.id, {});
    const [first] = Object.values(page.rows);
    return first;
  });
  expect(rowB?.status).toBe("doing");
  const json = await a.evaluate((id) => {
    const block = window.__paneDocs!.a!.toJSON().blocks[id];
    return block?.type === "database"
      ? { columns: (block.attrs as Record<string, unknown>).columns, rows: block.rows }
      : null;
  }, dbId);
  // The doc holds the reference only: no inline schema, and the rows map
  // stands empty (the row data is the consumer's database, not the doc).
  expect(json).toEqual({ columns: undefined, rows: {} });

  await close();
});

test("the date cell stands the DatePicker (the pick commits over the bridge echo); the grid scroller stands the thin scrollbar", async ({
  browser,
}) => {
  // The shared-context panes (the same origin): the bridge echo carries the
  // pick's row commit to pane B (the isolated contexts stand no echo).
  const { a, b, close } = await twoPanesSharedContext(browser, "ext04-datecell");

  const projectsId = await a.evaluate(async () => {
    const tables = await window.__bridge!.listTables();
    return tables.find((table) => table.name === "Projects")?.id ?? null;
  });
  expect(projectsId).not.toBeNull();
  await a.evaluate((tableId) => window.__paneDocs!.a!.insertBlock("database", { tableId }), projectsId!);
  const gridA = a.locator("[data-slot='docblocks/database-grid']");
  await expect(gridA.first()).toBeVisible(SETTLE);
  await b.locator("[data-slot='docblocks/database-grid']").first().waitFor({ timeout: 15000 });

  // The grid's horizontal scroller stands the ScrollArea's thin-scrollbar
  // contract (the theme's border color), not the browser's default bar.
  expect(await gridA.first().evaluate((el) => getComputedStyle(el).scrollbarWidth)).toBe("thin");

  // The date cell stands the display (the compact date; the native
  // <input type="date"> and the trigger button are gone): the calendar
  // opens on the double press over the cell itself.
  const dateCellA = a.locator("[data-slot='docblocks/database-cell'][data-column-id='started']").first();
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

  // The commit stands over the bridge's echo: pane B's grid resyncs from
  // its bridge (the row data is the consumer's data — the doc stands).
  const dateCellB = b.locator("[data-slot='docblocks/database-cell'][data-column-id='started']").first();
  await expect(dateCellB).toHaveText(label, SETTLE);
  const row = await a.evaluate(async () => {
    const tables = await window.__bridge!.listTables();
    const tableId = tables.find((table) => table.name === "Projects")!.id;
    const page = await window.__bridge!.queryRows(tableId, {});
    const [first] = Object.values(page.rows);
    return first;
  });
  expect(row?.started).toBe(expected);

  await close();
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

  const titleHeader = a.locator("[data-slot='docblocks/database-header-cell'][data-column-id='title']");
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

test("the datetime cell stands the calendar + the time box (the time/date order, the same-day toggle; the commit over the wire)", async ({
  browser,
}) => {
  // The shared-context panes (the same origin): the bridge echo carries the
  // pick's row commit to pane B (the isolated contexts stand no echo).
  const { a, b, close } = await twoPanesSharedContext(browser, "ext04-datetimecell");

  const demo = await bridgeDemoTable(a);
  await a.evaluate((tableId) => window.__paneDocs!.a!.insertBlock("database", { tableId }), demo.id);
  // The timestamptz column + the seed value: the cell stands the picker.
  await a.evaluate(async (tableId) => {
    await window.__bridge!.createColumn(tableId, { id: "at", name: "At", type: "timestamptz" });
    const page = await window.__bridge!.queryRows(tableId, {});
    const rowId = Object.keys(page.rows)[0]!;
    await window.__bridge!.updateRow(tableId, rowId, { at: "2026-03-10T18:00" });
  }, demo.id);

  const cellA = a.locator("[data-slot='docblocks/database-cell'][data-column-id='at']").first();
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

  // The commit stands the ISO string in the bridge (the doc stands — the
  // row is the consumer's data), pane B's grid resyncs from its bridge.
  const row = await a.evaluate(async () => {
    const table = (await window.__bridge!.listTables()).find((item) => item.name === "Demo")!;
    const page = await window.__bridge!.queryRows(table!.id, {});
    const [first] = Object.values(page.rows);
    return first;
  });
  const isoMonth = String(monthsIndexOf(monthName) + 1).padStart(2, "0");
  expect(row?.at).toBe(`2026-${isoMonth}-15T18:30`);
  // The trigger stands the zero-padded compact label (the dd.MM.yyyy shape;
  // the dots are escaped — the label's format is the fixed dd.MM.yyyy).
  const label = new RegExp(`15\\.${isoMonth}\\.2026 18:30`);
  await expect(cellA).toHaveText(label, SETTLE);
  await expect(b.locator("[data-slot='docblocks/database-cell'][data-column-id='at']").first()).toHaveText(
    label,
    SETTLE
  );

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
  const rowAfterReverse = await a.evaluate(async () => {
    const table = (await window.__bridge!.listTables()).find((item) => item.name === "Demo")!;
    const page = await window.__bridge!.queryRows(table!.id, {});
    const [first] = Object.values(page.rows);
    return first;
  });
  expect(rowAfterReverse?.at).toBe(`2026-${isoMonth}-20T07:45`);
  const reverseLabel = new RegExp(`20\\.${isoMonth}\\.2026 07:45`);
  await expect(cellA).toHaveText(reverseLabel, SETTLE);
  await expect(b.locator("[data-slot='docblocks/database-cell'][data-column-id='at']").first()).toHaveText(
    reverseLabel,
    SETTLE
  );

  // The same-day re-pick (the day-picker's toggle) stands no reset: the
  // Escape close commits nothing (the value stands, no wire write).
  await cellA.dblclick();
  await expect(picker).toBeVisible(SETTLE);
  await picker.getByRole("button", { name: new RegExp(`${monthName} 20`) }).click();
  await a.keyboard.press("Escape");
  await expect(picker).toBeHidden(SETTLE);
  const rowAfterToggle = await a.evaluate(async () => {
    const table = (await window.__bridge!.listTables()).find((item) => item.name === "Demo")!;
    const page = await window.__bridge!.queryRows(table!.id, {});
    const [first] = Object.values(page.rows);
    return first;
  });
  expect(rowAfterToggle?.at).toBe(`2026-${isoMonth}-20T07:45`);

  await close();
});

test("the cell's press model: the single press selects, the double press edits, the drag stands the region, the Delete clears (the echo over the bridge)", async ({
  browser,
}) => {
  // The shared-context panes (the same origin): the bridge echo carries the
  // clear / the toggle to pane B (the isolated contexts stand no echo).
  const { a, b, close } = await twoPanesSharedContext(browser, "ext04-cellmodel");

  const demo = await bridgeDemoTable(a);
  await a.evaluate((tableId) => window.__paneDocs!.a!.insertBlock("database", { tableId }), demo.id);
  const gridA = a.locator("[data-slot='docblocks/database-grid']");
  await expect(gridA.first()).toBeVisible(SETTLE);
  await b.locator("[data-slot='docblocks/database-grid']").first().waitFor({ timeout: 15000 });

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
  // updateRows call, the cells are null; the bridge echo reaches pane B,
  // the doc stands).
  await a.keyboard.press("Delete");
  for (const [r, c] of region) {
    await expect(cell(r, c)).toHaveAttribute("data-empty", "true", SETTLE);
    await expect(cell(r, c)).toHaveText("", SETTLE);
  }
  const rowsB = await b.evaluate(async (tableId) => {
    const page = await window.__bridge!.queryRows(tableId, {});
    return Object.values(page.rows) as Record<string, unknown>[];
  }, demo.id);
  for (const row of rowsB.slice(0, 2)) {
    expect(row.title).toBeUndefined();
    expect(row.count).toBeUndefined();
  }
  expect(rowsB[2]!.title).toBe("Third task"); // the region stands the first two rows only

  // The clear stands ONE commit: the grid's Undo stands the WHOLE clear
  // back (every cleared row) over the single press (the two-commits bug:
  // the undo used to stand one row per press).
  const undoBtn = a.locator("[data-slot='docblocks/database-undo']");
  await expect(undoBtn).toBeEnabled(SETTLE);
  await undoBtn.click();
  await expect(cell(0, 0)).toHaveText("First task", SETTLE);
  await expect(cell(1, 0)).toHaveText("Second task", SETTLE);
  const rowsB2 = await b.evaluate(async (tableId) => {
    const page = await window.__bridge!.queryRows(tableId, {});
    return Object.values(page.rows) as Record<string, unknown>[];
  }, demo.id);
  expect(rowsB2[0]!.title).toBe("First task");
  expect(rowsB2[0]!.count).toBe(1);
  expect(rowsB2[1]!.title).toBe("Second task");
  expect(rowsB2[1]!.count).toBe(2);

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

  // The boolean's double press stands the toggle (over the wire; pane B's
  // box follows).
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
  await expect(
    b
      .locator(
        "[data-slot='docblocks/database-grid'] [data-slot='docblocks/database-cell'][data-column-id='done'] [data-slot='docblocks/database-cell-checkbox']"
      )
      .last()
  ).toHaveAttribute("aria-checked", "true", SETTLE);
  const rowB = await b.evaluate(async (tableId) => {
    const page = await window.__bridge!.queryRows(tableId, {});
    const rows = Object.values(page.rows) as Record<string, unknown>[];
    return rows[rows.length - 1];
  }, demo.id);
  expect(rowB?.done).toBe(true);

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
  const rowB2 = await b.evaluate(async (tableId) => {
    const page = await window.__bridge!.queryRows(tableId, {});
    const rows = Object.values(page.rows) as Record<string, unknown>[];
    return rows[0];
  }, demo.id);
  expect(rowB2?.done).toBe(true);

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
  const rowB3 = await b.evaluate(async (tableId) => {
    const page = await window.__bridge!.queryRows(tableId, {});
    const rows = Object.values(page.rows) as Record<string, unknown>[];
    return rows[0];
  }, demo.id);
  expect(rowB3?.done).toBe(false);

  await close();
});

test("the cell's mouse-blur: the typed draft commits over the other cell's / the outside press (the focus model stands)", async ({
  browser,
}) => {
  // The shared-context panes (the same origin): the bridge echo carries the
  // commits / the rename to pane B.
  const { a, b, close } = await twoPanesSharedContext(browser, "ext04-mouseblur");
  try {
    const demo = await bridgeDemoTable(a);
    const dbId = await a.evaluate((tableId) => window.__paneDocs!.a!.insertBlock("database", { tableId }), demo.id);
    const gridA = a.locator("[data-slot='docblocks/database-grid']");
    await expect(gridA.first()).toBeVisible(SETTLE);
    await b.locator("[data-slot='docblocks/database-grid']").first().waitFor({ timeout: 15000 });

    const cell = (pane: Page, r: number, c: number) =>
      pane.locator(`[data-slot='docblocks/database-cell'][data-row='${r}'][data-col='${c}']`);
    const firstRow = (pane: Page) =>
      pane.evaluate(async (tableId) => {
        const page = await window.__bridge!.queryRows(tableId, {});
        const rows = Object.values(page.rows) as Record<string, unknown>[];
        return rows[0];
      }, demo.id);

    // Case 1 — the other cell's press: the typed title draft commits over
    // the session's swap (the draft does not die with the editor's
    // unmount). The press stands over the NEIGHBOR column's cell — the
    // floating editor covers the cell below its own column, so a press
    // over it would stand the editor's own interaction, not the session's
    // swap.
    await cell(a, 0, 0).dblclick();
    const titleInput = a.locator("[data-slot='docblocks/database-cell-multiline']");
    await expect(titleInput).toBeVisible(SETTLE);
    await titleInput.fill("First task edited");
    await cell(a, 1, 1).click();
    await expect(cell(a, 0, 0)).toHaveText("First task edited", SETTLE);
    expect((await firstRow(a))?.title).toBe("First task edited");
    await expect(cell(b, 0, 0)).toHaveText("First task edited", SETTLE);

    // Case 2 — the outside press: the typed number draft commits over the
    // real mouse over the editor's left padding (outside the grid + the
    // portaled content).
    await cell(a, 0, 1).dblclick();
    const countInput = cell(a, 0, 1).locator("[data-slot='docblocks/database-cell-input']");
    await expect(countInput).toBeVisible(SETTLE);
    await countInput.fill("19");
    const gridBox = await gridA.first().boundingBox();
    await a.mouse.click(10, gridBox!.y + 40);
    await expect(cell(a, 0, 1)).toHaveText("19", SETTLE);
    expect((await firstRow(a))?.count).toBe(19);
    await expect(cell(b, 0, 1)).toHaveText("19", SETTLE);

    // Case 3 — the focus model: the press commit parks the focus on the
    // table (the hotkeys reach the grid's undo stack) — the Control+Z
    // stands the previous value back.
    await cell(a, 1, 1).dblclick();
    const count2Input = cell(a, 1, 1).locator("[data-slot='docblocks/database-cell-input']");
    await expect(count2Input).toBeVisible(SETTLE);
    await count2Input.fill("21");
    await cell(a, 0, 1).click();
    await expect(cell(a, 1, 1)).toHaveText("21", SETTLE);
    await a.keyboard.press("Control+z");
    await expect(cell(a, 1, 1)).toHaveText("2", SETTLE);

    // Case 4 — the header's rename (the same class): the typed name commits
    // over the cell's press (the blur); the bridge's renameTable stands in
    // both panes, the block's JSON stands the reference only (no doc write).
    await a.locator("[data-slot='docblocks/database-name']").click();
    const nameInput = a.locator("[data-slot='docblocks/database-name-input']");
    await expect(nameInput).toBeVisible(SETTLE);
    await nameInput.fill("Mouse-blur Board");
    await cell(a, 0, 0).click();
    await expect(a.locator("[data-slot='docblocks/database-name']")).toHaveText("Mouse-blur Board", SETTLE);
    await expect(b.locator("[data-slot='docblocks/database-name']").first()).toHaveText("Mouse-blur Board", SETTLE);
    const dbAttrs = await a.evaluate((id) => {
      const block = window.__paneDocs!.a!.toJSON().blocks[id]!;
      return { tableId: block.attrs?.tableId, name: block.attrs?.name };
    }, dbId);
    expect(dbAttrs.tableId).toBe(demo.id);
    expect(dbAttrs.name).toBeUndefined();
  } finally {
    await close();
  }
});

test("the number column: the create form's attributes stand the cell's display (the prefix / the thousands over the bridge echo; the raw number stays the data)", async ({
  browser,
}) => {
  // The shared-context panes (the same origin): the bridge echo carries the
  // column's create + the value to pane B's grid.
  const { a, b, close } = await twoPanesSharedContext(browser, "ext04-numbercol");

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
  // The demo table stands 4 columns → the created one is the col5.
  await expect(a.locator("[data-slot='docblocks/database-header-cell'][data-column-id='col5']")).toBeVisible(SETTLE);

  // The value over the bridge (the row is the consumer's data): the display
  // stands the column's format in BOTH panes, the data keeps the raw number.
  await a.evaluate(async (tableId) => {
    const page = await window.__bridge!.queryRows(tableId, {});
    const rowId = Object.keys(page.rows)[0]!;
    await window.__bridge!.updateRow(tableId, rowId, { col5: 555222 });
  }, demo.id);

  const cell = (pane: typeof a) => pane.locator("[data-slot='docblocks/database-cell'][data-column-id='col5']").first();
  await expect(cell(a)).toHaveText("AAA 555 222 BBB", SETTLE);
  await expect(cell(b)).toHaveText("AAA 555 222 BBB", SETTLE);
  const row = await a.evaluate(async (tableId) => {
    const page = await window.__bridge!.queryRows(tableId, {});
    const [first] = Object.values(page.rows);
    return first;
  }, demo.id);
  expect(row?.col5).toBe(555222);

  // The cell's edit stands the column's step stand (the integer's step):
  // the double press opens the number input.
  await cell(a).dblclick();
  const input = cell(a).locator("input[type='number']");
  await expect(input).toBeVisible(SETTLE);
  await a.keyboard.press("Escape");

  await close();
});

test("the add-column form's ref stand (the enum's options editor over the hidden system table; the row-link's table pick — the existing + the new-table flows)", async ({
  browser,
}) => {
  // The shared-context panes (the same origin): the bridge echo carries the
  // column's create to pane B's grid.
  const { a, b, close } = await twoPanesSharedContext(browser, "ext04-refpick");
  try {
    const demo = await bridgeDemoTable(a);
    const blockId = await a.evaluate((tableId) => window.__paneDocs!.a!.insertBlock("database", { tableId }), demo.id);
    const gridA = a.locator(`[data-block-id='${blockId}'] [data-slot='docblocks/database-grid']`);
    await expect(gridA).toBeVisible(SETTLE);
    await b.locator("[data-slot='docblocks/database-grid']").last().waitFor({ timeout: 15000 });

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
    const header1 = gridA.locator("[data-slot='docblocks/database-header-cell'][data-column-id='col5']");
    await expect(header1).toBeVisible(SETTLE);
    const created1 = await columnOf("col5");
    expect(created1).toMatchObject({ refKind: "enum" });
    const moodTableId = (created1 as unknown as { refTableId: string }).refTableId;
    const tableNames = await a.evaluate(async () => (await window.__bridge!.listTables()).map((t) => t.name));
    expect(tableNames.map((name) => name.toLowerCase())).not.toContain(moodTableId.toLowerCase());
    const moodRows = await a.evaluate(async (id) => {
      const page = await window.__bridge!.queryRows(id, {});
      return Object.values(page.rows).map((cells) => cells.name);
    }, moodTableId);
    expect(moodRows).toEqual(["good", "bad"]);
    await expect(b.locator("[data-slot='docblocks/database-header-cell'][data-column-id='col5']")).toBeVisible(SETTLE);

    // Flow 2 — the row-link's existing table's pick (the package's Select —
    // the native select is gone; the demo's Projects table stands the
    // pick): the pick commits the column over the bridge echo (both panes).
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
    await expect(gridA.locator("[data-slot='docblocks/database-header-cell'][data-column-id='col6']")).toBeVisible(
      SETTLE
    );
    expect(await columnOf("col6")).toMatchObject({ refKind: "row", refTableId: "table-projects" });
    await expect(b.locator("[data-slot='docblocks/database-header-cell'][data-column-id='col6']")).toBeVisible(SETTLE);

    // Flow 3 — the "New table…" pick (the row-link's): the name's input
    // stands over the form, the create commits the table + the column
    // (the bridge's echo).
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
    await expect(gridA.locator("[data-slot='docblocks/database-header-cell'][data-column-id='col7']")).toBeVisible(
      SETTLE
    );
    expect(await columnOf("col7")).toMatchObject({ refKind: "row", refTableId: "table-people" });
    const tableNames2 = await a.evaluate(async () => (await window.__bridge!.listTables()).map((t) => t.name));
    expect(tableNames2).toContain("People");
    await expect(b.locator("[data-slot='docblocks/database-header-cell'][data-column-id='col7']")).toBeVisible(SETTLE);
  } finally {
    await close();
  }
});

test("the add-column form stands for every type (the name over the create; the Escape closes without the create)", async ({
  browser,
}) => {
  // The shared-context panes (the same origin): the bridge echo carries the
  // column's create to pane B's grid.
  const { a, b, close } = await twoPanesSharedContext(browser, "ext04-addcolumnform");

  const demo = await bridgeDemoTable(a);
  await a.evaluate((tableId) => window.__paneDocs!.a!.insertBlock("database", { tableId }), demo.id);
  const gridA = a.locator("[data-slot='docblocks/database-grid']");
  await expect(gridA.first()).toBeVisible(SETTLE);
  await b.locator("[data-slot='docblocks/database-grid']").first().waitFor({ timeout: 15000 });

  // The Date & time entry stands the create form (the name input; the
  // number's attribute fields stand none — the type-specific block stands
  // for the number only): the name from the input + the create button
  // commit the column over the bridge echo (both panes stand it).
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
  // The demo table stands 4 columns → the created one is the col5.
  const header = (pane: typeof a) =>
    pane.locator("[data-slot='docblocks/database-header-cell'][data-column-id='col5']").first();
  await expect(header(a)).toHaveText("Launch", SETTLE);
  await expect(header(b)).toHaveText("Launch", SETTLE);

  // The Escape over the form closes without the create (the column count
  // stands — the commit stands the form's button only).
  await trigger.click();
  await menu.locator("[data-column-entry='text']").click();
  await expect(menu).toBeHidden(SETTLE);
  await expect(form).toBeVisible(SETTLE);
  await a.keyboard.press("Escape");
  await expect(form).toBeHidden(SETTLE);
  expect(await a.locator("[data-slot='docblocks/database-header-cell'][data-column-id='col6']").count()).toBe(0);

  await close();
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
  const context = await browser.newContext();
  const a = await context.newPage();
  try {
    await openPane(a, "a", `ext04-pickheight-${Math.random().toString(36).slice(2, 8)}`);
    const demo = await bridgeDemoTable(a);
    // The multi-enum + the row-link's columns (over the pane's own bridge:
    // the demo's Statuses dict + the linked People table).
    await a.evaluate(async (tableId) => {
      const bridge = window.__bridge!;
      await bridge.createColumn(tableId, {
        id: "tags",
        name: "Tags",
        type: "text",
        refKind: "enum",
        refMany: true,
        refTableId: "table-statuses-enum",
      });
      await bridge.createTable("People");
      await bridge.createColumn("table-people", { id: "name", name: "Name", type: "text" });
      const peopleIds = await bridge.insertRows("table-people", [{ name: "Ann" }, { name: "Bo" }]);
      await bridge.createColumn(tableId, {
        id: "owner",
        name: "Owner",
        type: "text",
        refKind: "row",
        refTableId: "table-people",
      });
      const page = await bridge.queryRows(tableId, {});
      const rowId = Object.keys(page.rows)[0]!;
      await bridge.updateRow(tableId, rowId, { tags: ["todo"], owner: peopleIds[0] });
    }, demo.id);
    await a.evaluate((tableId) => window.__paneDocs!.a!.insertBlock("database", { tableId }), demo.id);
    const gridA = a.locator("[data-slot='docblocks/database-grid']");
    await expect(gridA.first()).toBeVisible(SETTLE);
    const cell = (colId: string) =>
      a.locator(`[data-slot='docblocks/database-cell'][data-column-id='${colId}']`).first();

    // The single-enum's list — the grid's main picker (the height's
    // stand: the option's line over the theme's tokens). The picker is
    // the custom popover (the Radix's Select is out over the enum).
    await cell("status").dblclick();
    await a.waitForTimeout(150);
    const enumRow = a.locator("[data-slot='docblocks/database-enum-picker-row']").first();
    await expect(enumRow).toBeVisible(SETTLE);
    const enumHeight = await enumRow.evaluate((el) => getComputedStyle(el).height);
    await a.keyboard.press("Escape");

    // The multi-enum's list (the checkbox rows — the row's line stands the
    // checkbox's visual; the press stands the row's toggle).
    await cell("tags").dblclick();
    const multiRow = a.locator("[data-slot='docblocks/database-ref-multi-option']");
    await expect(multiRow.first()).toBeVisible(SETTLE);
    const multiHeight = await multiRow.first().evaluate((el) => getComputedStyle(el).height);
    await a.keyboard.press("Escape");

    // The row-link's picker (the search + the row lines).
    await cell("owner").dblclick();
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
    await cell("status").dblclick();
    await a.waitForTimeout(150);
    const doneRow = a.locator("[data-slot='docblocks/database-enum-picker-row'][data-option-value='done']");
    await expect(doneRow).toBeVisible(SETTLE);
    await doneRow.click();
    await expect(cell("status")).toHaveText("done", SETTLE);
    const status = await a.evaluate(async (tableId) => {
      const page = await window.__bridge!.queryRows(tableId, {});
      const row = Object.values(page.rows)[0] as Record<string, unknown>;
      return row.status;
    }, demo.id);
    expect(status).toBe("done");
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
  const context = await browser.newContext();
  const a = await context.newPage();
  try {
    await openPane(a, "a", `ext04-rowheight-${Math.random().toString(36).slice(2, 8)}`);
    // A fresh table over the pane's own bridge: the text column only.
    const tableId = await a.evaluate(async () => {
      const bridge = window.__bridge!;
      const id = await bridge.createTable("All types");
      await bridge.createColumn(id, { id: "a", name: "A", type: "text" });
      const rowIds = await bridge.insertRows(id, [{ a: "Task one" }, { a: "Task two" }]);
      await bridge.updateRow(id, rowIds[0]!, { a: "Task one" });
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
    await a.evaluate(async (id) => {
      const bridge = window.__bridge!;
      await bridge.createColumn(id, {
        id: "e1",
        name: "E1",
        type: "text",
        refKind: "enum",
        refTableId: "table-statuses-enum",
      });
      const page = await bridge.queryRows(id, {});
      const rowId = Object.keys(page.rows)[0]!;
      await bridge.updateRow(id, rowId, { e1: "todo" });
    }, tableId);
    await expect(a.locator("[data-slot='docblocks/database-header-cell'][data-column-id='e1']")).toBeVisible(SETTLE);
    const afterEnum = await rowHeight(0);
    expect(new Set(afterEnum).size).toBe(1);
    expect(afterEnum.every((h) => h === base[0])).toBe(true);
    const afterEnumRow1 = await rowHeight(1);
    expect(afterEnumRow1.every((h) => h === base[0])).toBe(true);

    // Every column type over the same table (the multi-enum / the
    // row-link / the date / the datetime / the number / the boolean):
    // the row's height stands over all of them.
    await a.evaluate(async (id) => {
      const bridge = window.__bridge!;
      await bridge.createColumn(id, {
        id: "e2",
        name: "E2",
        type: "text",
        refKind: "enum",
        refMany: true,
        refTableId: "table-statuses-enum",
      });
      await bridge.createTable("People");
      const peopleId = await bridge.insertRows("table-people", [{ name: "Ann" }]);
      await bridge.createColumn(id, { id: "r1", name: "R1", type: "text", refKind: "row", refTableId: "table-people" });
      await bridge.createColumn(id, { id: "d1", name: "D1", type: "date" });
      await bridge.createColumn(id, { id: "dt1", name: "DT1", type: "timestamptz" });
      await bridge.createColumn(id, { id: "n1", name: "N1", type: "integer" });
      await bridge.createColumn(id, { id: "b1", name: "B1", type: "boolean" });
      const page = await bridge.queryRows(id, {});
      const rowId = Object.keys(page.rows)[0]!;
      await bridge.updateRow(id, rowId, {
        e2: ["todo"],
        r1: peopleId[0],
        d1: "2026-09-01",
        dt1: "2026-12-15T18:00",
        n1: 7,
        b1: true,
      });
    }, tableId);
    await expect(a.locator("[data-slot='docblocks/database-header-cell'][data-column-id='b1']")).toBeVisible(SETTLE);
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
  const context = await browser.newContext();
  const a = await context.newPage();
  try {
    await openPane(a, "a", `ext04-persist-${Math.random().toString(36).slice(2, 8)}`);
    // The table + the rows (the explicit row ids: the restore's pk stand) +
    // the row-link's reference over the other table's row.
    const tableId = await a.evaluate(async () => {
      const bridge = window.__bridge!;
      const id = await bridge.createTable("Persist");
      await bridge.createColumn(id, { id: "name", name: "Name", type: "text" });
      await bridge.createTable("Persist People");
      // The display column (the row-link's display resolution stands the
      // first text column — its absence stands the raw id's stand).
      await bridge.createColumn("table-persist-people", { id: "name", name: "Name", type: "text" });
      const [ann] = await bridge.insertRows("table-persist-people", [{ id: "p-ann", name: "Ann" }]);
      await bridge.createColumn(id, {
        id: "owner",
        name: "Owner",
        type: "text",
        refKind: "row",
        refTableId: "table-persist-people",
      });
      await bridge.insertRows(id, [
        { id: "p-1", name: "Row one", owner: ann },
        { id: "p-2", name: "Row two" },
      ]);
      return id;
    });
    // The snapshot's save (the debounce's window + the re-read's pass).
    await a.waitForTimeout(750);
    await a.reload();
    await expect(a.getByTestId("status-a")).toHaveText("connected");

    // The restore: the table's id / the rows' ids / the cells / the
    // row-link's reference stand (the doc's references survive too).
    const after = await a.evaluate(async (id) => {
      const bridge = window.__bridge!;
      const page = await bridge.queryRows(id, {});
      return {
        ids: Object.keys(page.rows),
        owner: page.rows["p-1"]?.owner as string | undefined,
        name: page.rows["p-1"]?.name as string | undefined,
      };
    }, tableId);
    expect(after.ids).toEqual(["p-1", "p-2"]);
    expect(after.owner).toBe("p-ann");
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
    const ownerCell = gridA.locator("[data-slot='docblocks/database-cell'][data-column-id='owner']").first();
    await expect(ownerCell).toContainText("Ann", SETTLE);
  } finally {
    await context.close();
  }
});

test("the long text's cell: the double press stands the floating 6-row editor (the Baserow's stand: the box over the cell's top edge, the width = the cell's, the rows stand no shift, the covered rows' stand opaque; the Enter's break; the outside press's commit; the Escape's cancel)", async ({
  browser,
}) => {
  const { a, b, close } = await twoPanesSharedContext(browser, "ext04-multiline");
  try {
    // A text table over the shared bridge (both panes' bridges echo).
    const tableId = await a.evaluate(async () => {
      const bridge = window.__bridge!;
      const id = await bridge.createTable("MultiLine");
      await bridge.createColumn(id, { id: "body", name: "Body", type: "text" });
      await bridge.createColumn(id, { id: "num", name: "Num", type: "integer" });
      await bridge.insertRows(id, [
        {
          body: "Line one\nline two\nline three\nline four\nline five\nline six\nline seven",
          num: 1,
        },
        { body: "Short", num: 2 },
      ]);
      return id;
    });
    await a.evaluate((id) => window.__paneDocs!.a!.insertBlock("database", { tableId: id }), tableId);
    await b.evaluate((id) => window.__paneDocs!.b!.insertBlock("database", { tableId: id }), tableId);
    // The page stands both panes (A over B) — the first grid is pane A's.
    const gridA = a.locator("[data-slot='docblocks/database-grid']").first();
    await expect(gridA).toBeVisible(SETTLE);

    // The double press stands the editor OVER THE CELL (the Baserow's
    // stand — the portaled layer): the display drops (the duplication is
    // out), the box's top edge stands over the row's top edge, the box
    // stands the 6 rows' height over the next row (the row stands no
    // shift).
    const cell = gridA.locator("[data-slot='docblocks/database-cell'][data-column-id='body'][data-row='0']");
    const restBox = (await cell.boundingBox())!;
    const nextRowBox = (await gridA
      .locator("[data-slot='docblocks/database-cell'][data-column-id='body'][data-row='1']")
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
    const editorContent = a.locator(
      "[data-slot='popover-content']:has([data-slot='docblocks/database-cell-multiline'])"
    );
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
      .locator("[data-slot='docblocks/database-cell'][data-column-id='body'][data-row='1']")
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
    // the draft in one updateRow (the bridge's echo over both panes).
    const box = await gridA.boundingBox();
    await a.mouse.click(box!.x - 40, box!.y + 10);
    await expect(textarea).toBeHidden(SETTLE);
    const committed = await a.evaluate(async (id) => {
      const page = await window.__bridge!.queryRows(id, {});
      return Object.values(page.rows)[0]?.body as string | undefined;
    }, tableId);
    expect(committed).toBe("Line one\nline two\nline three\nline four\nline five\nline six\nline seven\nAppended");
    // The other pane's bridge stands the same value (the echo).
    const paneB = await b.evaluate(async (id) => {
      const page = await window.__bridge!.queryRows(id, {});
      return Object.values(page.rows)[0]?.body as string | undefined;
    }, tableId);
    expect(paneB).toBe(committed);

    // The Escape's cancel (the short cell): the typed draft stands no
    // write.
    const shortCell = gridA.locator("[data-slot='docblocks/database-cell'][data-column-id='body'][data-row='1']");
    const shortEditor = a.locator("[data-slot='docblocks/database-cell-multiline']");
    await shortCell.dblclick();
    await expect(shortEditor).toBeVisible(SETTLE);
    await a.keyboard.type("X");
    await a.keyboard.press("Escape");
    await expect(shortEditor).toBeHidden(SETTLE);
    const afterCancel = await a.evaluate(async (id) => {
      const page = await window.__bridge!.queryRows(id, {});
      const rows = page.rows as Record<string, { body?: string }>;
      return Object.values(rows)[1]?.body;
    }, tableId);
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
    const afterCommit = await a.evaluate(async (id) => {
      const page = await window.__bridge!.queryRows(id, {});
      const rows = page.rows as Record<string, { body?: string }>;
      return Object.values(rows)[1]?.body;
    }, tableId);
    expect(afterCommit).toBe("Short X");

    // The regression: the number's cell stands the input (the textarea's
    // stand is the text's only).
    const numCell = gridA.locator("[data-slot='docblocks/database-cell'][data-column-id='num'][data-row='0']");
    await numCell.dblclick();
    const numInput = gridA.locator("[data-slot='docblocks/database-cell'][data-column-id='num'][data-row='0'] input");
    await expect(numInput).toBeVisible(SETTLE);
    expect(await a.locator("[data-slot='docblocks/database-cell-multiline']").count()).toBe(0);
  } finally {
    await close();
  }
});

test("the multi-enum / the multi row-links: the empty cell stands the multi editor (the first pick's array; the two picks' stand over the echo; the single's pick stands the scalar; the undo's per toggle)", async ({
  browser,
}) => {
  const { a, b, close } = await twoPanesSharedContext(browser, "ext04-multiselect");
  try {
    // A fresh table over the shared bridge: the multi-enum (the demo's
    // statuses' dict), the multi row-links (the linked's people), the
    // single-enum + the single row-link (the regression's stand).
    const tableId = await a.evaluate(async () => {
      const bridge = window.__bridge!;
      const id = await bridge.createTable("MultiSelect");
      await bridge.createTable("LinkPeople");
      await bridge.createColumn("table-linkpeople", { id: "name", name: "Name", type: "text" });
      await bridge.insertRows("table-linkpeople", [{ name: "Ann" }, { name: "Bob" }]);
      await bridge.createColumn(id, {
        id: "tags",
        name: "Tags",
        type: "text",
        refKind: "enum",
        refTableId: "table-statuses-enum",
        refMany: true,
      });
      await bridge.createColumn(id, {
        id: "owners",
        name: "Owners",
        type: "text",
        refKind: "row",
        refTableId: "table-linkpeople",
        refMany: true,
      });
      await bridge.createColumn(id, {
        id: "status",
        name: "Status",
        type: "text",
        refKind: "enum",
        refTableId: "table-statuses-enum",
      });
      await bridge.createColumn(id, {
        id: "owner",
        name: "Owner",
        type: "text",
        refKind: "row",
        refTableId: "table-linkpeople",
      });
      await bridge.insertRows(id, [{}]);
      return id;
    });
    // The block's id scopes the grid (the doc's seed blocks stand the
    // other grids — the `first`'s stand is out).
    const blockA = await a.evaluate((id) => window.__paneDocs!.a!.insertBlock("database", { tableId: id }), tableId);
    await b.evaluate((id) => window.__paneDocs!.b!.insertBlock("database", { tableId: id }), tableId);
    const gridA = a.locator(`[data-block-id='${blockA}'] [data-slot='docblocks/database-grid']`);
    await expect(gridA).toBeVisible(SETTLE);

    const cell = (column: string) =>
      gridA.locator(`[data-slot='docblocks/database-cell'][data-column-id='${column}'][data-row='0']`);
    const chipsOf = (column: string) =>
      cell(column).locator("[data-slot='docblocks/database-ref-chip']").allTextContents();
    const option = (value: string) =>
      a.locator(`[data-slot='docblocks/database-ref-multi-option'][data-option-value='${value}']`);
    const bridgeCells = (pane: Page) =>
      pane.evaluate(async (id) => {
        const page = await window.__bridge!.queryRows(id, {});
        return Object.values(page.rows)[0] as Record<string, unknown>;
      }, tableId);

    // ---- The multi-enum: the EMPTY cell stands the multi editor (the
    // single-pick's stand is out) — the first pick commits the ARRAY.
    await cell("tags").dblclick();
    await expect(option("todo")).toBeVisible(SETTLE);
    await expect(option("todo")).not.toHaveAttribute("data-state", "checked");
    await option("todo").click();
    await a.waitForTimeout(50);
    await option("done").click();
    await a.waitForTimeout(50);
    // The two picks' stand: the chips' train (the joined text is out) +
    // the array over both panes' bridges (the echo).
    await expect(async () => {
      expect(await chipsOf("tags")).toEqual(["todo", "done"]);
    }).toPass({ timeout: 5_000 });
    const cellsA = await bridgeCells(a);
    expect(cellsA.tags).toEqual(["todo", "done"]);
    const cellsB = await bridgeCells(b);
    expect(cellsB.tags).toEqual(["todo", "done"]);

    // The uncheck's stand: the chips' update + the array's stand.
    await cell("tags").dblclick();
    await expect(option("done")).toBeVisible(SETTLE);
    await option("todo").click();
    await a.waitForTimeout(50);
    await expect(async () => {
      expect(await chipsOf("tags")).toEqual(["done"]);
    }).toPass({ timeout: 5_000 });
    expect((await bridgeCells(a)).tags).toEqual(["done"]);

    // ---- The undo's per toggle (the existing's contract): the two
    // toggles' stand the two entries (the uncheck's + the add's). The
    // outside press stands the popover's close (the modal layer's
    // one-click stand); the grid's hotkey stands the undo over the
    // table's focus (the cell's press stands the focus stand).
    const chipsWait = (values: string[]) =>
      expect(async () => {
        expect(await chipsOf("tags")).toEqual(values);
      }).toPass({ timeout: 5_000 });
    // The cell's raw press: the popover's close (the outside press) + the
    // table's focus stand (the cell's pointerdown stands it — the hotkey's
    // reach; the popover's close stands the focus over the trigger's row,
    // so the press stands the stand back).
    const statusBox = await a.evaluate((id) => {
      const scope = document.querySelector(`[data-block-id='${id}']`);
      const el = scope?.querySelector<HTMLElement>("[data-slot='docblocks/database-cell'][data-column-id='status']");
      const r = el?.getBoundingClientRect();
      return r ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null;
    }, blockA);
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
    await cell("owners").dblclick();
    const ownerOption = (rowId: string) =>
      a.locator(`[data-slot='docblocks/database-ref-multi-option'][data-option-value='${rowId}']`);
    await expect(ownerOption("r-table-linkpeople-1")).toBeVisible(SETTLE);
    await ownerOption("r-table-linkpeople-1").click();
    await a.waitForTimeout(50);
    await ownerOption("r-table-linkpeople-2").click();
    await a.waitForTimeout(50);
    await expect(async () => {
      expect(await chipsOf("owners")).toEqual(["Ann", "Bob"]);
    }).toPass({ timeout: 5_000 });
    expect((await bridgeCells(a)).owners).toEqual(["r-table-linkpeople-1", "r-table-linkpeople-2"]);

    // ---- The single's pick stands the SCALAR (the regression): the
    // single-enum's cell opens the picker (the multi's stand is out), the
    // pick commits the string (not the array). The row's option-value
    // stands the option's row id (the pk's stand = the dict's value).
    await cell("status").dblclick();
    await a.waitForTimeout(150);
    const enumPickerRow = a.locator("[data-slot='docblocks/database-enum-picker-row']");
    await expect(enumPickerRow.first()).toBeVisible(SETTLE);
    expect(await a.locator("[data-slot='docblocks/database-ref-multi-option']").count()).toBe(0);
    await a.locator("[data-slot='docblocks/database-enum-picker-row'][data-option-value='doing']").click();
    await a.waitForTimeout(50);
    const singleEnum = (await bridgeCells(a)).status;
    expect(singleEnum).toBe("doing");

    // The single row-link's cell opens the picker (the multi's stand is
    // out), the pick commits the row id's scalar.
    await cell("owner").dblclick();
    // The picker's rows stand in the portaled content (the block's scope
    // is out — the pane's locator stands the pick, like the multi's).
    const rowPick = a.locator("[data-slot='docblocks/database-row-picker-row']");
    await expect(rowPick.first()).toBeVisible(SETTLE);
    expect(await a.locator("[data-slot='docblocks/database-ref-multi-option']").count()).toBe(0);
    await rowPick.first().click();
    await a.waitForTimeout(50);
    const singleLink = (await bridgeCells(a)).owner;
    expect(singleLink).toBe("r-table-linkpeople-1");
  } finally {
    await close();
  }
});

test("the enum's create form (the options' editor: the reorder / the color / the delete; the system table stands hidden; the chip's stand; the picker's contract; the undo)", async ({
  browser,
}) => {
  const { a, b, close } = await twoPanesSharedContext(browser, "ext04-enumform");
  try {
    const demo = await bridgeDemoTable(a);
    const blockId = await a.evaluate((tableId) => window.__paneDocs!.a!.insertBlock("database", { tableId }), demo.id);
    const gridA = a.locator(`[data-block-id='${blockId}'] [data-slot='docblocks/database-grid']`);
    await expect(gridA).toBeVisible(SETTLE);
    await b.locator("[data-slot='docblocks/database-grid']").last().waitFor({ timeout: 15000 });

    // The demo's status enum stands the system table (the hidden stand):
    // the `listTables` stands it out, the chip stands the option's color
    // (the data's inline stand over the pastel palette).
    const tables = await a.evaluate(async () => (await window.__bridge!.listTables()).map((t) => t.name));
    expect(tables).not.toContain("Statuses-enum");
    const chip = gridA.locator("[data-column-id='status'][data-row='0'] [data-slot='docblocks/database-ref-chip']");
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
    // The grip's drag stands the live reorder (the high stands first).
    const grips = form.locator("[data-slot='docblocks/database-enum-option-grip']");
    const first = await grips.nth(0).boundingBox();
    const last = await grips.nth(1).boundingBox();
    if (first === null || last === null) throw new Error("the grip's box stands none");
    await a.mouse.move(last.x + last.width / 2, last.y + last.height / 2);
    await a.mouse.down();
    await a.mouse.move(first.x + first.width / 2, first.y + first.height / 2 - 6, { steps: 8 });
    await a.mouse.up();
    await a.waitForTimeout(100);
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

    // The column stands in both panes (the echo); the system table stands
    // the hidden catalog out.
    const header = (pane: typeof a) =>
      pane.locator(`[data-block-id='${blockId}'] [data-slot='docblocks/database-header-cell'][data-column-id='col5']`);
    await expect(header(a)).toHaveText("Priority", SETTLE);
    await expect(header(b)).toHaveText("Priority", SETTLE);
    const schema = await a.evaluate(
      async (tableId) => (await window.__bridge!.describeTable(tableId)).columns,
      demo.id
    );
    const created = schema.find((column) => column.id === "col5");
    expect(created).not.toBeNull();
    const enumTableId = (created as unknown as { refTableId: string }).refTableId!;
    expect(tables).not.toContain(enumTableId);
    const optionRows = await a.evaluate(async (id) => {
      const page = await window.__bridge!.queryRows(id, {});
      return Object.values(page.rows);
    }, enumTableId);
    expect(optionRows.map((cells: Record<string, unknown>) => cells.name)).toEqual(["high", "low"]);
    expect(optionRows[0]).toHaveProperty("color", "#f7a8a8");

    // The empty cell's stand: the background only (the chip stands none —
    // the trigger's box is out). The one press stands the selection, the
    // double press stands the picker.
    const cell = gridA.locator("[data-column-id='col5'][data-row='0']");
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

    // The pick commits the option's id (the chip stands over the echo),
    // the undo reverts (the focus stands over the cell's press).
    await optionRow("high").click();
    await a.waitForTimeout(100);
    const chipA = cell.locator("[data-slot='docblocks/database-ref-chip']");
    await expect(chipA).toHaveText("high", SETTLE);
    expect(await chipA.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe("rgb(247, 168, 168)");
    const chipB = b
      .locator(`[data-block-id='${blockId}'] [data-slot='docblocks/database-grid']`)
      .locator("[data-column-id='col5'][data-row='0'] [data-slot='docblocks/database-ref-chip']");
    await expect(chipB).toHaveText("high", SETTLE);
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
    const multiCell = gridA.locator("[data-column-id='col6'][data-row='0']");
    await multiCell.dblclick();
    await a.waitForTimeout(150);
    const multiOption = (value: string) =>
      a.locator(`[data-slot='docblocks/database-ref-multi-option'][data-option-value='${value}']`);
    // The option values stand the system table's row ids (the pk's stand).
    const tintsTableId = (await a.evaluate(async (tableId) => {
      const { columns } = await window.__bridge!.describeTable(tableId);
      return (columns.find((column) => column.id === "col6") as unknown as { refTableId: string }).refTableId;
    }, demo.id))!;
    const tintsIds = await a.evaluate(
      async (id) => Object.keys(await window.__bridge!.queryRows(id, {}).then((p) => p.rows)),
      tintsTableId
    );
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
    await close();
  }
});

test("the enum's edit form (the options' diff: the values stand; the names / the order / the colors update)", async ({
  browser,
}) => {
  const { a, b, close } = await twoPanesSharedContext(browser, "ext04-enumedit");
  try {
    const demo = await bridgeDemoTable(a);
    const blockId = await a.evaluate((tableId) => window.__paneDocs!.a!.insertBlock("database", { tableId }), demo.id);
    const gridA = a.locator(`[data-block-id='${blockId}'] [data-slot='docblocks/database-grid']`);
    await expect(gridA).toBeVisible(SETTLE);
    await b.locator("[data-slot='docblocks/database-grid']").last().waitFor({ timeout: 15000 });

    // The demo's status column stands the system table (the options'
    // diff's target). The cell's value stands the option's row id (the
    // pk's stand — the identity over the rename).
    const statusChip = gridA.locator(
      "[data-column-id='status'][data-row='0'] [data-slot='docblocks/database-ref-chip']"
    );
    await expect(statusChip).toHaveText("todo", SETTLE);

    // The edit's open (the column menu's "Edit options" entry — the
    // Ellipsis's press opens the menu): the draft prefills from the system
    // table (the order's stand, the names, the colors).
    const header = gridA.locator("[data-slot='docblocks/database-header-cell'][data-column-id='status']");
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
    // stands the planned's label over the echo).
    await expect(statusChip).toHaveText("planned", SETTLE);
    const statusChipB = b
      .locator(`[data-block-id='${blockId}'] [data-slot='docblocks/database-grid']`)
      .locator("[data-column-id='status'][data-row='0'] [data-slot='docblocks/database-ref-chip']");
    await expect(statusChipB).toHaveText("planned", SETTLE);

    // The picker's list stands the new stand (the planned's rename,
    // the stalled's stand at the end; the old name is gone). The order
    // stands the table's row order (the rename keeps the row in place —
    // the draft's order stands no reorder in this diff).
    await gridA.locator("[data-column-id='status'][data-row='1']").dblclick();
    await a.waitForTimeout(150);
    const rows = a.locator("[data-slot='docblocks/database-enum-picker-row']");
    expect(await rows.count()).toBe(4);
    expect(await rows.nth(0).textContent()).toContain("planned");
    expect(await rows.nth(1).textContent()).toContain("doing");
    expect(await rows.nth(2).textContent()).toContain("done");
    expect(await rows.nth(3).textContent()).toContain("stalled");
  } finally {
    await close();
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

    // The enum cell's double press opens the picker (the edit session stands).
    const enumCellA = a.locator("[data-slot='docblocks/database-cell'][data-column-id='status']").first();
    await enumCellA.dblclick();
    const option = a.locator("[data-slot='docblocks/database-enum-picker-row'][data-option-value='doing']");
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
    const titleCells = () => a.locator("[data-slot='docblocks/database-cell'][data-column-id='title']").count();
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
    // A fresh table over the shared bridge: the long text (the ellipsis's
    // stand), the number + the datetime (the single-line regression), the
    // multi-enum + the multi row-links (the right fade over the overflow),
    // and the single enum (the chip's ellipsis — the text's stand, not the
    // fade). The enum's dict's long labels + the row-link's long names force
    // the chips' train over the column's width (the overflow's stand).
    const tableId = await a.evaluate(async () => {
      const bridge = window.__bridge!;
      const dictId = await bridge.createTable("DisplayOpts", { system: true });
      await bridge.createColumn(dictId, { id: "name", name: "name", type: "text" });
      await bridge.insertRows(dictId, [
        { id: "alpha-very-long-option", name: "Alpha very long option label" },
        { id: "beta-very-long-option", name: "Beta very long option label" },
        { id: "gamma-very-long-option", name: "Gamma very long option label" },
      ]);
      await bridge.createTable("DisplayPeople");
      await bridge.createColumn("table-displaypeople", { id: "name", name: "Name", type: "text" });
      await bridge.insertRows("table-displaypeople", [
        { id: "person-one", name: "Ann Longworth-Whitfield" },
        { id: "person-two", name: "Bo Longworth-Whitfield" },
        { id: "person-three", name: "Cy Longworth-Whitfield" },
      ]);
      const id = await bridge.createTable("DisplayCell");
      await bridge.createColumn(id, { id: "body", name: "Body", type: "text" });
      await bridge.createColumn(id, { id: "num", name: "Num", type: "integer" });
      await bridge.createColumn(id, { id: "dt", name: "DT", type: "timestamptz" });
      await bridge.createColumn(id, {
        id: "tags",
        name: "Tags",
        type: "text",
        refKind: "enum",
        refTableId: dictId,
        refMany: true,
      });
      await bridge.createColumn(id, {
        id: "owners",
        name: "Owners",
        type: "text",
        refKind: "row",
        refTableId: "table-displaypeople",
        refMany: true,
      });
      await bridge.createColumn(id, {
        id: "status",
        name: "Status",
        type: "text",
        refKind: "enum",
        refTableId: dictId,
      });
      await bridge.insertRows(id, [
        {
          id: "row-1",
          body: "A very long piece of text that will not fit inside the cell's width and must stand one line with the trailing ellipsis instead of wrapping onto a new line of the row",
          num: 123456789,
          dt: "2026-10-26T09:15:00",
          tags: ["alpha-very-long-option", "beta-very-long-option", "gamma-very-long-option"],
          owners: ["person-one", "person-two", "person-three"],
          status: "alpha-very-long-option",
        },
      ]);
      return id;
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
      a.evaluate((blockId) => {
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
        const body = displayOf("body");
        const tags = chipsOf("tags");
        const owners = chipsOf("owners");
        const status = chipsOf("status");
        const num = contentOf("num");
        const dt = contentOf("dt");
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
          tagsChipOverflow: cs(chipOf("tags")!).getPropertyValue("text-overflow"),
          ownersFade: owners.getAttribute("data-fade"),
          ownersMask: mask(owners),
          statusFade: status.getAttribute("data-fade"),
          statusMask: mask(status),
          statusChipOverflow: cs(chipOf("status")!).getPropertyValue("text-overflow"),
        };
      }, blockA);
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
    const lightMask = await a.evaluate((blockId) => {
      const grid = document.querySelector(
        `[data-block-id="${blockId}"] [data-slot="docblocks/database-grid"]`
      ) as HTMLElement | null;
      const chips = grid?.querySelector(
        '[data-slot="docblocks/database-cell"][data-column-id="tags"][data-row="0"] [data-slot="docblocks/database-ref-chips"]'
      ) as HTMLElement | null;
      return chips !== null ? getComputedStyle(chips).getPropertyValue("mask-image") : null;
    }, blockA);
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
    const tableId = await a.evaluate(async () => {
      const bridge = window.__bridge!;
      const id = await bridge.createTable("AlignCell");
      await bridge.createColumn(id, { id: "body", name: "Body", type: "text" });
      await bridge.createColumn(id, { id: "num", name: "Num", type: "integer" });
      await bridge.createColumn(id, { id: "bool", name: "Flag", type: "boolean" });
      await bridge.insertRows(id, [{ id: "row-1", body: "Some text", num: 1234567, bool: true }]);
      return id;
    });
    const blockA = await a.evaluate((id) => window.__paneDocs!.a!.insertBlock("database", { tableId: id }), tableId);
    await b.evaluate((id) => window.__paneDocs!.b!.insertBlock("database", { tableId: id }), tableId);
    const gridA = a.locator(`[data-block-id='${blockA}'] [data-slot='docblocks/database-grid']`);
    await expect(gridA).toBeVisible(SETTLE);

    // The display's stand from one read (the grid's own DOM — no locator's
    // auto-wait / the strict-mode's stand over the grid's rows).
    const readAlign = () =>
      a.evaluate((blockId) => {
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
        const checkbox = cell("bool")?.querySelector(
          '[data-slot="docblocks/database-cell-checkbox"]'
        ) as HTMLElement | null;
        const num = display("num");
        const body = display("body");
        if (num === null || body === null || checkbox === null) return null;
        const numCell = cell("num")!;
        const boolCell = cell("bool")!;
        const cbRect = checkbox.getBoundingClientRect();
        const boolRect = boolCell.getBoundingClientRect();
        return {
          numDisplayAlign: getComputedStyle(num).textAlign,
          bodyDisplayAlign: getComputedStyle(body).textAlign,
          numHeaderAlign: header("num") !== null ? getComputedStyle(header("num")!).textAlign : null,
          boolHeaderAlign: header("bool") !== null ? getComputedStyle(header("bool")!).textAlign : null,
          bodyHeaderAlign: header("body") !== null ? getComputedStyle(header("body")!).textAlign : null,
          // The value's right edge stands the cell's right edge (the number's
          // right align — the text's right edge is over the cell's right
          // padding, not the left).
          numValueRightOffset: numCell.getBoundingClientRect().right - num.getBoundingClientRect().right,
          // The checkbox's center stands the cell's center (the boolean's
          // center — the offset is the padding's asymmetry, ~0).
          cbCenterOffset: Math.abs(cbRect.left + cbRect.right - boolRect.left - boolRect.right) / 2,
        };
      }, blockA);
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
    await gridA.locator(`[data-slot='docblocks/database-cell'][data-column-id='num'][data-row='0']`).dblclick();
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

test("the header's type icon stands left of the name (the 10 types' icon set; both panes; the muted token's color; the px-2 stands)", async ({
  browser,
}) => {
  const { a, b, close } = await twoPanesSharedContext(browser, "db-typeicon");
  try {
    // The main table: one column per type (the 10). The ref columns' ref
    // tables stand (the enum's dict / the row's linked table).
    const { mainId, expected } = await a.evaluate(async () => {
      const bridge = window.__bridge!;
      const dictId = await bridge.createTable("TypeIcon-enum", { system: true });
      await bridge.createColumn(dictId, { id: "name", name: "name", type: "text" });
      await bridge.createColumn(dictId, { id: "color", name: "color", type: "text" });
      const linkId = await bridge.createTable("TypeIcon-link");
      await bridge.createColumn(linkId, { id: "label", name: "Label", type: "text" });
      const mainId = await bridge.createTable("TypeIcons");
      const spec: {
        id: string;
        name: string;
        type: string;
        refKind?: "enum" | "row";
        refMany?: boolean;
        refTableId?: string;
      }[] = [
        { id: "c_text", name: "Text", type: "text" },
        { id: "c_int", name: "Int", type: "integer" },
        { id: "c_dec", name: "Dec", type: "numeric" },
        { id: "c_bool", name: "Bool", type: "boolean" },
        { id: "c_date", name: "Date", type: "date" },
        { id: "c_dt", name: "DT", type: "timestamptz" },
        { id: "c_enum", name: "Enum", type: "text", refKind: "enum", refTableId: dictId },
        { id: "c_multi", name: "Multi", type: "text", refKind: "enum", refMany: true, refTableId: dictId },
        { id: "c_rowlink", name: "RL", type: "text", refKind: "row", refTableId: linkId },
        { id: "c_rowlinks", name: "RLs", type: "text", refKind: "row", refMany: true, refTableId: linkId },
      ];
      for (const s of spec) await bridge.createColumn(mainId, s);
      return {
        mainId,
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
    await b.evaluate((id) => window.__paneDocs!.b!.insertBlock("database", { tableId: id }), mainId);

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
    // Both panes' icons stand the type's markers (the mapping) + the icon's
    // left of the name.
    for (const pane of [a, b]) {
      await expect.poll(async () => (await readIcons(pane)) !== null, SETTLE).toBe(true);
      const icons = (await readIcons(pane))!;
      for (const [col, type] of Object.entries(expected)) {
        for (const marker of MARKERS[type]!) {
          expect(icons[col]?.sig, `the ${col}'s icon's signature`).toContain(marker);
        }
        expect(icons[col]?.iconLeftOfName, `the ${col}'s icon's left of the name`).toBe(true);
      }
    }

    // The icon's color resolves the muted-foreground token (the theme-
    // independent stand — the probe stands the token's resolved value).
    const iconColor = (pane: Page) =>
      pane.evaluate((id) => {
        const grid = document.querySelector(`[data-block-id="${id}"] [data-slot="docblocks/database-grid"]`)!;
        const icon = grid.querySelector<SVGElement>(
          '[data-slot="docblocks/database-header-cell"][data-column-id="c_text"] > svg'
        )!;
        const probe = document.createElement("div");
        probe.style.color = "var(--muted-foreground)";
        probe.style.position = "absolute";
        document.body.appendChild(probe);
        const token = getComputedStyle(probe).color;
        probe.remove();
        return { icon: getComputedStyle(icon).color, token };
      }, blockA);
    // The dark stand (the explicit dark): the color resolves the token.
    await a.evaluate(() => document.documentElement.classList.add("dark"));
    const dark = await iconColor(a);
    expect(dark.icon).toBe(dark.token);
    // The light stand (the flip stands the resolution).
    await a.evaluate(() => document.documentElement.classList.remove("dark"));
    const light = await iconColor(a);
    expect(light.icon).toBe(light.token);
  } finally {
    await close();
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
      const dictId = await bridge.createTable("Gap-enum", { system: true });
      await bridge.createColumn(dictId, { id: "name", name: "name", type: "text" });
      const linkId = await bridge.createTable("Gap-link");
      await bridge.createColumn(linkId, { id: "label", name: "Label", type: "text" });
      const mainId = await bridge.createTable("GapTable");
      const spec: {
        id: string;
        name: string;
        type: string;
        refKind?: "enum" | "row";
        refMany?: boolean;
        refTableId?: string;
      }[] = [
        { id: "c_text", name: "Text", type: "text" },
        { id: "c_int", name: "Int", type: "integer" },
        { id: "c_dec", name: "Decimal", type: "numeric" },
        { id: "c_bool", name: "Bool", type: "boolean" },
        { id: "c_date", name: "Date", type: "date" },
        { id: "c_dt", name: "DateTime", type: "timestamptz" },
        { id: "c_enum", name: "Enum", type: "text", refKind: "enum", refTableId: dictId },
        { id: "c_multi", name: "Multi", type: "text", refKind: "enum", refMany: true, refTableId: dictId },
        { id: "c_rowlink", name: "RowLink", type: "text", refKind: "row", refTableId: linkId },
        { id: "c_rowlinks", name: "RLs", type: "text", refKind: "row", refMany: true, refTableId: linkId },
      ];
      for (const s of spec) await bridge.createColumn(mainId, s);
      return { mainId, cols: spec.map((s) => s.id) };
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
    const blockA = await a.evaluate(async () => {
      const bridge = window.__bridge!;
      const id = await bridge.createTable("EllipsisCenter");
      for (const [cid, name, type] of [
        ["colA", "Alpha", "text"],
        ["colB", "Beta", "integer"],
        ["colC", "Gamma", "boolean"],
      ] as [string, string, string][]) {
        await bridge.createColumn(id, { id: cid, name, type });
      }
      return window.__paneDocs!.a!.insertBlock("database", { tableId: id });
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
    for (const col of ["colA", "colB", "colC"]) {
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
      `[data-block-id='${blockA}'] [data-slot='docblocks/database-header-cell'][data-column-id='colA'] [data-slot='docblocks/database-column-menu']`
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
  const titleHeader = a.locator("[data-slot='docblocks/database-header-cell'][data-column-id='title']");
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
    const { tableId, blockA } = await a.evaluate(async () => {
      const bridge = window.__bridge!;
      const id = await bridge.createTable("HeaderMenu");
      for (const [cid, name] of [
        ["colA", "Alpha"],
        ["colB", "Beta"],
        ["colC", "Gamma"],
      ] as [string, string][]) {
        await bridge.createColumn(id, { id: cid, name, type: "text" });
      }
      const blockA = window.__paneDocs!.a!.insertBlock("database", { tableId: id });
      return { tableId: id, blockA };
    });
    await b.evaluate((id) => window.__paneDocs!.b!.insertBlock("database", { tableId: id }), tableId);

    const headerA = a.locator(
      `[data-block-id='${blockA}'] [data-slot='docblocks/database-header-cell'][data-column-id='colA']`
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
        `[data-block-id='${blockA}'] [data-slot='docblocks/database-header-cell'][data-column-id='colA'] [data-slot='docblocks/database-column-menu']`
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
    // Before the drag: colA stands first (the creation's order).
    expect((await headerOrder(a))[0]).toBe("colA");

    // The drag's reorder stands from the header's name's zone (the past-
    // threshold's press: the columnOrder's commit, both panes' resync). The
    // name's stand is the same zone (the click's point) — the drag is a
    // past-threshold press, not the click's no-op. The target stands past
    // colC's (the last column's) live midpoint (the parting's shift) — colA
    // lands at the sequence's end.
    const dragBox = (await headerA.boundingBox())!;
    const colCBox = (await a
      .locator(`[data-block-id='${blockA}'] [data-slot='docblocks/database-header-cell'][data-column-id='colC']`)
      .boundingBox())!;
    await a.mouse.move(dragBox.x + 12, dragBox.y + dragBox.height / 2);
    await a.mouse.down();
    await a.mouse.move(colCBox.x + colCBox.width + 50, dragBox.y + dragBox.height / 2, { steps: 12 });
    await a.waitForTimeout(250);
    await a.mouse.up();

    // After the drag: colA stands no longer first (the reorder's commit).
    await expect.poll(async () => (await headerOrder(a))[0], SETTLE).not.toBe("colA");
    // Pane B's grid resyncs from the columnOrder's attr (the wire's commit).
    await expect.poll(async () => (await headerOrder(b))[0], SETTLE).not.toBe("colA");
  } finally {
    await close();
  }
});
