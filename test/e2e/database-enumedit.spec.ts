// The enum's edit form's stand (the options' diff: the value's identity
// over the rename, the picker's list's stand), and the enum cell's
// double-click's regression (no format toolbar / no chrome's selection).
import { type Page, expect, test } from "@playwright/test";

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

test("the enum's edit form (the options' diff: the values stand; the names / the order / the colors update)", async ({
  browser,
}) => {
  const context = await editorContext(browser);
  const a = await context.newPage();
  try {
    await openPane(a, "a", "db-enumedit-" + Math.random().toString(36).slice(2, 8));

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
  const { a, close } = await twoPanes(browser, "db-chrome-noselect");
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
