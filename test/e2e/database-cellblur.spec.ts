// The cell's mouse-blur's stand: the typed draft's commit over the
// other cell's / the outside press (the focus model's stand — the press
// commit's park, the hotkey's reach over the grid's undo stack).
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

test("the cell's mouse-blur: the typed draft commits over the other cell's / the outside press (the focus model stands)", async ({
  browser,
}) => {
  const context = await editorContext(browser);
  const a = await context.newPage();
  try {
    await openPane(a, "a", "db-mouseblur-" + Math.random().toString(36).slice(2, 8));

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
