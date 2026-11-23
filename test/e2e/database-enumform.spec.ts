// The enum's create form's options' editor's stand: the reorder / the
// color / the delete (the system table's hidden stand), the chip's
// stand, the picker's contract, the undo, and the multi-enum's toggle.
import { type Page, expect, test } from "@playwright/test";

import { SETTLE, editorContext, expectStays, openPane } from "./helpers";

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

test("the enum's create form (the options' editor: the reorder / the color / the delete; the system table stands hidden; the chip's stand; the picker's contract; the undo)", async ({
  browser,
}) => {
  const context = await editorContext(browser);
  const a = await context.newPage();
  try {
    await openPane(a, "a", "db-enumform-" + Math.random().toString(36).slice(2, 8));

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
    // The reorder commits over the release (the DOM's order is the state;
    // the back-out's animation is visual only — the order's poll stands
    // the back-out's settle).
    await expect
      .poll(
        async () =>
          form
            .locator("[data-slot='docblocks/database-enum-option-name']")
            .evaluateAll((elements) => elements.map((element) => (element as HTMLInputElement).value)),
        { timeout: 5_000 }
      )
      .toEqual(["high", "low"]);
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
    // The undo's chip-removal stands over the window (a late re-add lands
    // after a single sample).
    await expectStays(async () => {
      expect(await cell.locator("[data-slot='docblocks/database-ref-chip']").count()).toBe(0);
    });

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
