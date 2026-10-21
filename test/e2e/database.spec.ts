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
        const [first] = tables;
        return first ?? null;
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

  // The header's press stands the menu (the read-only type line + the hide).
  await titleHeader.click();
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

test("the select cell stands the package's Select (the pick stands over the wire); the number cell suppresses the spin buttons", async ({
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

  // The select cell stands the package's Select trigger (the radix
  // combobox), not a native <select> (the demo table's status column):
  // the cell stands the display, the combobox is the inner trigger, and
  // the list opens on the double press (the single press is the selection).
  const selectCellA = a.locator("[data-slot='docblocks/database-cell'][data-column-id='status']").first();
  const selectTriggerA = selectCellA.locator("[role='combobox']");
  await expect(selectTriggerA).toHaveCount(1, SETTLE);
  await expect(selectCellA).toHaveText("todo", SETTLE);
  await expect(selectCellA.locator("select")).toHaveCount(0);

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

  // The pick over the real mouse: the double press opens the list, the
  // "doing" pick commits over the wire (the row is the consumer's data —
  // pane B's bridge and grid resync from the bridge's echo, the doc stands
  // unchanged).
  await selectCellA.dblclick();
  const option = a.getByRole("option", { name: "doing" });
  await expect(option).toBeVisible(SETTLE);
  await option.click();
  await expect(selectCellA).toHaveText("doing", SETTLE);
  const selectCellB = b.locator("[data-slot='docblocks/database-cell'][data-column-id='status']").first();
  await expect(selectCellB).toHaveText("doing", SETTLE);
  const rowB = await b.evaluate(async () => {
    const [table] = await window.__bridge!.listTables();
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

test("the datetime cell stands the DateTimePicker (the calendar + the time box; the commit over the wire)", async ({
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
    const [table] = await window.__bridge!.listTables();
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

  // The double press stands the edit (the input over the display); the
  // Escape cancels the session (the draft reverts, no write).
  await cell(0, 0).dblclick();
  await expect(cell(0, 0)).toHaveAttribute("data-editing", "true", SETTLE);
  await expect(cell(0, 0).locator("[data-slot='docblocks/database-cell-input']")).toBeVisible(SETTLE);
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

test("the number column: the create form's attributes stand the cell's display (the prefix / the thousands over the bridge echo; the raw number stays the data)", async ({
  browser,
}) => {
  // The shared-context panes (the same origin): the bridge echo carries the
  // column's create + the value to pane B's grid.
  const { a, b, close } = await twoPanesSharedContext(browser, "ext04-numbercol");

  const demo = await bridgeDemoTable(a);
  await a.evaluate((tableId) => window.__paneDocs!.a!.insertBlock("database", { tableId }), demo.id);

  // The create over the grid's form: the plus's menu → the Number entry →
  // the attribute form (the thousands' separator + the prefix / the
  // suffix) → the Add commits the column's data to the bridge.
  await a.locator("[data-slot='docblocks/database-add-column-trigger']").click();
  const menu = a.locator("[data-slot='dropdown-menu-content']");
  await expect(menu).toBeVisible(SETTLE);
  await menu.locator("[data-column-type='number']").click();
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
