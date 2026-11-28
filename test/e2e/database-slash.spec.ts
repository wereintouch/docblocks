// The slash's Database picker: the table's list over the pane's bridge,
// the pick's insert (the tableId's reference, no inline schema), the
// create-new's form (the shared context's snapshot's restore), and the
// search's name's filter.
import { type Browser, type Page, expect, test } from "@playwright/test";

import { SETTLE, editorContext, openPane, twoPanes } from "./helpers";

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

test("the slash Database picker inserts a block referencing a table", async ({ browser }) => {
  const { a, close } = await twoPanes(browser, "db-slash");

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

  const wrapper = a.locator("[data-block-type='database']:not([data-slot='docblocks/row'])");
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
  const { a, b, close } = await twoPanesSharedContext(browser, "db-slash-create");
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
    const wrapperA = a.locator("[data-block-type='database']:not([data-slot='docblocks/row'])");
    await expect(wrapperA).toHaveCount(1, SETTLE);
    await expect(wrapperA.locator("[data-slot='docblocks/database-name']")).toHaveText("My Board", SETTLE);
    // The block stands in the other pane over the doc's wire (its grid
    // stands the broken state — the pane's own bridge lacks the table).
    const wrapperB = b.locator("[data-block-type='database']:not([data-slot='docblocks/row'])");
    await expect(wrapperB).toHaveCount(1, SETTLE);
    // The table's state stands the shared snapshot over the other pane's
    // reload: the pane's bridge's save stands the snapshot's table, the
    // reload's restore re-creates it over the stable id, and the pane's
    // re-fetched doc stands the block's reference resolved.
    // The pane's bridge's save stands the snapshot's table (the state-based
    // guard — the stored snapshot carries the created table's name, not the
    // fixed debounce's wait).
    await expect
      .poll(async () =>
        a.evaluate(() => window.localStorage.getItem("docblocks-playground-bridge-v2")?.includes("My Board") ?? false)
      )
      .toBe(true);
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
  const { a, close } = await twoPanes(browser, "db-slash-search");
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
