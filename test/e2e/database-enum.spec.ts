import { type Page, expect, test } from "@playwright/test";

import { SETTLE, openPane } from "./helpers";

/** The enum / the multi-enum's stand: the picker's width's clamp (the
 * cell's floor, the option's drive, the 220 px's ceiling), the rows'
 * selected's stand (the current value / the empty's clear), the
 * overflow's stands (the single press's picker over the clipped value;
 * the tall's list over the clipped chips), the options' block (the
 * standard's font, the shared color's palette, the grip's live reorder). */

/** The pane's bridge's demo table (the seed's stand). */
async function bridgeDemoTable(page: Page): Promise<{ id: string; name: string }> {
  let result: { id: string; name: string } | null = null;
  await expect
    .poll(async () => {
      result = await page.evaluate(async () => {
        if (window.__bridge === undefined) return null;
        const tables = await window.__bridge.listTables();
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

/** Set the database block's column width (the block's `columnWidths`
 *  attribute — the index's stand over the rendered header's order). */
async function setColumnWidth(page: Page, blockId: string, colId: string, width: number): Promise<void> {
  await page.evaluate(
    ([id, target, w]) => {
      const [blockId, colId, width] = [id, target, w] as [string, string, number];
      const headerCells = document.querySelectorAll(
        `[data-block-id='${blockId}'] [data-slot='docblocks/database-header-cell']`
      );
      const order = [...headerCells].map((el) => el.getAttribute("data-column-id") as string);
      const block = window.__paneDocs!.a!.getBlock(blockId) as unknown as { columnWidths?: number[] };
      const existing = block.columnWidths ?? [];
      const next = order.map((cid, i) => (cid === colId ? width : (existing[i] ?? 160)));
      window.__paneDocs!.a!.updateBlock(blockId, { columnWidths: next });
    },
    [blockId, colId, width]
  );
}

/** The picker's popover (the Radix's content — the last's over the
 *  stacked's stand). */
const pickerPopover = (page: Page) => page.locator("[data-slot='popover-content']").last();

test("the enum's picker width stands the clamp (the cell's floor, the option's drive, the 220 px's ceiling)", async ({
  browser,
}) => {
  const context = await browser.newContext();
  const a = await context.newPage();
  try {
    await openPane(a, "a", `enum01-width-${Math.random().toString(36).slice(2, 8)}`);
    const demo = await bridgeDemoTable(a);
    // The long's options (the drive over the 220 px's ceiling): the
    // system's table's stand over the bridge (the pk's rows).
    const longColId = await a.evaluate(async (tableId) => {
      const bridge = window.__bridge!;
      const ctx = () => ({ operationId: crypto.randomUUID(), issuedAt: new Date().toISOString() });
      const longTable = await bridge.createTable(
        { name: `Enum Width ${Math.random().toString(36).slice(2, 6)}`, system: true },
        ctx()
      );
      const longTableId = longTable.result.id;
      const nameCol = await bridge.createColumn(
        longTableId,
        { column: { name: "name", type: "text", position: 0, nullable: true } },
        ctx()
      );
      await bridge.createColumn(
        longTableId,
        { column: { name: "color", type: "text", position: 1, nullable: true } },
        ctx()
      );
      const { columns } = await bridge.describeTable(tableId);
      const longCol = await bridge.createColumn(
        tableId,
        {
          column: {
            name: "Long",
            type: "text",
            position: columns.length,
            nullable: true,
            reference: { kind: "enum", tableId: longTableId, many: false },
          },
        },
        ctx()
      );
      await bridge.batchRows(
        longTableId,
        {
          ops: [
            { op: "create", row: { [nameCol.result.id]: "Short" }, beforeRowId: null },
            { op: "create", row: { [nameCol.result.id]: "Implementation details review cycle" }, beforeRowId: null },
            { op: "create", row: { [nameCol.result.id]: "Medium option" }, beforeRowId: null },
          ],
        },
        ctx()
      );
      return longCol.result.id;
    }, demo.id);
    const { Status: statusColId } = await demoColumns(a, demo.id, ["Status"]);

    const blockId = await a.evaluate((tableId) => window.__paneDocs!.a!.insertBlock("database", { tableId }), demo.id);
    const grid = a.locator(`[data-block-id='${blockId}'] [data-slot='docblocks/database-grid']`);
    await expect(grid).toBeVisible(SETTLE);

    const cell = (colId: string) =>
      a.locator(`[data-slot='docblocks/database-cell'][data-column-id='${colId}']`).first();
    const openPicker = async (colId: string) => {
      await cell(colId).dblclick();
      await a.waitForTimeout(150);
    };
    const closePicker = () => a.keyboard.press("Escape");

    // The short's options' stand (the demo's Statuses): the picker's width
    // stands the cell's floor (the trigger's width — the options' labels
    // are narrower than the cell).
    await openPicker(statusColId);
    const statusTrigger = a.locator("[data-slot='docblocks/database-enum-picker-trigger']").first();
    const statusTriggerWidth = await statusTrigger.boundingBox().then((box) => box!.width);
    const statusPopoverWidth = await pickerPopover(a)
      .boundingBox()
      .then((box) => box!.width);
    expect(Math.abs(statusPopoverWidth - statusTriggerWidth)).toBeLessThanOrEqual(2);
    await closePicker();

    // The long's options' stand: the widest label's drive over the
    // 220 px's ceiling (the "Implementation details review cycle's" label
    // + the row's chrome stands over the 220's floor — the ceiling's clamp).
    await openPicker(longColId);
    const longPopoverBox = await pickerPopover(a).boundingBox();
    expect(longPopoverBox!.width).toBeLessThanOrEqual(222);
    expect(longPopoverBox!.width).toBeGreaterThan(150);
    // The rows' stand over the clamp (the label's full's line — the
    // ellipsis is out).
    const longRow = a.locator("[data-slot='docblocks/database-enum-picker-row']").first();
    const longRowWidth = await longRow.boundingBox().then((box) => box!.width);
    expect(longRowWidth).toBeLessThanOrEqual(longPopoverBox!.width);
    await closePicker();
  } finally {
    await context.close();
  }
});

test("the picker's rows stand the selection (the current value's highlight; the empty's clear's highlight)", async ({
  browser,
}) => {
  const context = await browser.newContext();
  const a = await context.newPage();
  try {
    await openPane(a, "a", `enum02-select-${Math.random().toString(36).slice(2, 8)}`);
    const demo = await bridgeDemoTable(a);
    const { Status: statusColId, Title: titleColId } = await demoColumns(a, demo.id, ["Status", "Title"]);
    // The empty's value's row (the clear's highlight's stand): the seed's
    // rows stand filled — the new's row over the missing's status.
    const emptyRowIndex = await a.evaluate(
      async ({ tableId, statusColId, titleColId }) => {
        const bridge = window.__bridge!;
        const snapshot = await bridge.snapshotTable(tableId, {});
        const empty = snapshot.page.rows.findIndex((row) => row.cells[statusColId] == null);
        if (empty !== -1) return empty;
        await bridge.batchRows(
          tableId,
          { ops: [{ op: "create", row: { [titleColId]: "The empty's row" }, beforeRowId: null }] },
          { operationId: crypto.randomUUID(), issuedAt: new Date().toISOString() }
        );
        const fresh = await bridge.snapshotTable(tableId, {});
        return fresh.page.rows.length - 1;
      },
      { tableId: demo.id, statusColId, titleColId }
    );
    const todoId = await statusOptionId(a, "todo");
    const doingId = await statusOptionId(a, "doing");

    const blockId = await a.evaluate((tableId) => window.__paneDocs!.a!.insertBlock("database", { tableId }), demo.id);
    const grid = a.locator(`[data-block-id='${blockId}'] [data-slot='docblocks/database-grid']`);
    await expect(grid).toBeVisible(SETTLE);

    const filledCell = a
      .locator(`[data-slot='docblocks/database-cell'][data-column-id='${statusColId}']`)
      .filter({ hasText: "todo" })
      .first();
    const emptyCell = a
      .locator(`[data-slot='docblocks/database-cell'][data-column-id='${statusColId}'][data-row='${emptyRowIndex}']`)
      .first();

    // The filled's cell: the current value's row stands the selected's
    // background (the muted's stand over the row's default).
    await filledCell.dblclick();
    await a.waitForTimeout(150);
    const bgOf = (value: string) =>
      a
        .locator(`[data-slot='docblocks/database-enum-picker-row'][data-option-value='${value}']`)
        .evaluate((el) => getComputedStyle(el).backgroundColor);
    const selectedBg = await bgOf(todoId);
    const unselectedBg = await bgOf(doingId);
    expect(selectedBg).not.toBe(unselectedBg);
    await a.keyboard.press("Escape");
    await a.waitForTimeout(200);

    // The empty's cell: the clear's row stands the selected's background,
    // the options' rows stand the default.
    await emptyCell.dblclick();
    await a.waitForTimeout(150);
    const clearBg = await a
      .locator("[data-slot='docblocks/database-enum-picker-clear']")
      .evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(clearBg).toBe(selectedBg);
    const optionBg = await bgOf(todoId);
    expect(optionBg).toBe(unselectedBg);
  } finally {
    await context.close();
  }
});

test("the enum's overflow's stand: the single press stands the picker (the clipped value; the wide cell keeps the double press)", async ({
  browser,
}) => {
  const context = await browser.newContext();
  const a = await context.newPage();
  try {
    await openPane(a, "a", `enum03-overflow-${Math.random().toString(36).slice(2, 8)}`);
    const demo = await bridgeDemoTable(a);
    // The long's option (the value's display stands over the clip's
    // ellipsis — the single press's trigger's stand).
    const { longColId, shortId } = await a.evaluate(async (tableId) => {
      const bridge = window.__bridge!;
      const ctx = () => ({ operationId: crypto.randomUUID(), issuedAt: new Date().toISOString() });
      const longTable = await bridge.createTable(
        { name: `Enum Overflow ${Math.random().toString(36).slice(2, 6)}`, system: true },
        ctx()
      );
      const longTableId = longTable.result.id;
      const nameCol = await bridge.createColumn(
        longTableId,
        { column: { name: "name", type: "text", position: 0, nullable: true } },
        ctx()
      );
      await bridge.createColumn(
        longTableId,
        { column: { name: "color", type: "text", position: 1, nullable: true } },
        ctx()
      );
      const { columns } = await bridge.describeTable(tableId);
      const longCol = await bridge.createColumn(
        tableId,
        {
          column: {
            name: "Long",
            type: "text",
            position: columns.length,
            nullable: true,
            reference: { kind: "enum", tableId: longTableId, many: false },
          },
        },
        ctx()
      );
      const rows = await bridge.batchRows(
        longTableId,
        {
          ops: [
            { op: "create", row: { [nameCol.result.id]: "ok" }, beforeRowId: null },
            { op: "create", row: { [nameCol.result.id]: "Implementation details review cycle" }, beforeRowId: null },
          ],
        },
        ctx()
      );
      const shortId = rows.result.rows[0]!.id;
      const longId = rows.result.rows[1]!.id;
      const page = await bridge.snapshotTable(tableId, {});
      const rowId = page.page.rows[0]!.id;
      await bridge.batchRows(
        tableId,
        { ops: [{ op: "update", rowId, cells: { [longCol.result.id]: longId } }] },
        ctx()
      );
      return { longColId: longCol.result.id, shortId, longId };
    }, demo.id);

    const blockId = await a.evaluate((tableId) => window.__paneDocs!.a!.insertBlock("database", { tableId }), demo.id);
    const grid = a.locator(`[data-block-id='${blockId}'] [data-slot='docblocks/database-grid']`);
    await expect(grid).toBeVisible(SETTLE);

    const cell = a.locator(`[data-slot='docblocks/database-cell'][data-column-id='${longColId}']`).first();
    const popoverVisible = async () => pickerPopover(a).isVisible();

    // The wide's stand: the value's full's line — the single press stands
    // the selection only (the double press is the picker's stand).
    await setColumnWidth(a, blockId, longColId, 400);
    await expect(cell).toContainText("Implementation details review cycle", SETTLE);
    await cell.click();
    await a.waitForTimeout(200);
    expect(await popoverVisible()).toBe(false);
    await cell.dblclick();
    await a.waitForTimeout(200);
    expect(await popoverVisible()).toBe(true);
    await a.keyboard.press("Escape");
    await a.waitForTimeout(200);

    // The clipped's stand: the narrow's column (the value's ellipsis) —
    // the single press stands the picker.
    await setColumnWidth(a, blockId, longColId, 110);
    await expect
      .poll(
        async () =>
          cell
            .locator('[data-slot="docblocks/database-ref-chip"]')
            .evaluate((el) => el.scrollWidth > el.clientWidth + 1),
        SETTLE
      )
      .toBe(true);
    await cell.click();
    await a.waitForTimeout(200);
    expect(await popoverVisible()).toBe(true);
    // The picked's stand (the regression): the option's row's pick stands
    // the value (the short's option over the long's).
    const shortRow = a.locator(`[data-slot='docblocks/database-enum-picker-row'][data-option-value='${shortId}']`);
    await shortRow.click();
    await expect(cell).toHaveText("ok", SETTLE);
  } finally {
    await context.close();
  }
});

test("the multi's overflow stretches the list (the clipped chips' tall's stand; the wide's stand stays the compact)", async ({
  browser,
}) => {
  const context = await browser.newContext();
  const a = await context.newPage();
  try {
    await openPane(a, "a", `enum04-tall-${Math.random().toString(36).slice(2, 8)}`);
    const demo = await bridgeDemoTable(a);
    // The multi-enum's column over the long's system's table (the chips'
    // train stands the clip's fade).
    const longtagsColId = await a.evaluate(async (tableId) => {
      const bridge = window.__bridge!;
      const ctx = () => ({ operationId: crypto.randomUUID(), issuedAt: new Date().toISOString() });
      const longTable = await bridge.createTable(
        { name: `Enum Tall ${Math.random().toString(36).slice(2, 6)}`, system: true },
        ctx()
      );
      const longTableId = longTable.result.id;
      const nameCol = await bridge.createColumn(
        longTableId,
        { column: { name: "name", type: "text", position: 0, nullable: true } },
        ctx()
      );
      await bridge.createColumn(
        longTableId,
        { column: { name: "color", type: "text", position: 1, nullable: true } },
        ctx()
      );
      const { columns } = await bridge.describeTable(tableId);
      await bridge.createColumn(
        tableId,
        {
          column: {
            name: "Long",
            type: "text",
            position: columns.length,
            nullable: true,
            reference: { kind: "enum", tableId: longTableId, many: false },
          },
        },
        ctx()
      );
      const longtagsCol = await bridge.createColumn(
        tableId,
        {
          column: {
            name: "LongTags",
            type: "text",
            position: columns.length + 1,
            nullable: true,
            reference: { kind: "enum", tableId: longTableId, many: true },
          },
        },
        ctx()
      );
      const rows = await bridge.batchRows(
        longTableId,
        {
          ops: [
            { op: "create", row: { [nameCol.result.id]: "Longer option label one" }, beforeRowId: null },
            { op: "create", row: { [nameCol.result.id]: "Another longish label" }, beforeRowId: null },
          ],
        },
        ctx()
      );
      const firstId = rows.result.rows[0]!.id;
      const secondId = rows.result.rows[1]!.id;
      const page = await bridge.snapshotTable(tableId, {});
      const rowId = page.page.rows[0]!.id;
      await bridge.batchRows(
        tableId,
        { ops: [{ op: "update", rowId, cells: { [longtagsCol.result.id]: [firstId, secondId] } }] },
        ctx()
      );
      return longtagsCol.result.id;
    }, demo.id);

    const blockId = await a.evaluate((tableId) => window.__paneDocs!.a!.insertBlock("database", { tableId }), demo.id);
    const grid = a.locator(`[data-block-id='${blockId}'] [data-slot='docblocks/database-grid']`);
    await expect(grid).toBeVisible(SETTLE);
    const cell = a.locator(`[data-slot='docblocks/database-cell'][data-column-id='${longtagsColId}']`).first();
    await expect(cell).toBeVisible(SETTLE);

    const maxHeightOf = () =>
      a.locator("[data-slot='docblocks/database-enum-picker-list']").evaluate((el) => getComputedStyle(el).maxHeight);

    // The wide's stand (the chips' full's train): the compact's list
    // (the 192 px's stand).
    await setColumnWidth(a, blockId, longtagsColId, 420);
    await expect
      .poll(
        async () =>
          cell
            .locator('[data-slot="docblocks/database-ref-chips"]')
            .evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
        SETTLE
      )
      .toBe(true);
    await cell.dblclick();
    await a.waitForTimeout(150);
    expect(await maxHeightOf()).toBe("192px");
    await a.keyboard.press("Escape");
    await a.waitForTimeout(200);

    // The clipped's stand (the fade's mask over the train): the tall's
    // list (the 320 px's stand — the values' full's stand over the
    // scroll's inner stand).
    await setColumnWidth(a, blockId, longtagsColId, 120);
    await expect
      .poll(
        async () =>
          cell
            .locator('[data-slot="docblocks/database-ref-chips"]')
            .evaluate((el) => el.scrollWidth > el.clientWidth + 1),
        SETTLE
      )
      .toBe(true);
    await cell.dblclick();
    await a.waitForTimeout(150);
    expect(await maxHeightOf()).toBe("320px");
  } finally {
    await context.close();
  }
});

test("the options' block stands the standard's font, the shared color's palette and the grip's live reorder", async ({
  browser,
}) => {
  const context = await browser.newContext();
  const a = await context.newPage();
  try {
    await openPane(a, "a", `enum05-form-${Math.random().toString(36).slice(2, 8)}`);
    const demo = await bridgeDemoTable(a);
    const blockId = await a.evaluate((tableId) => window.__paneDocs!.a!.insertBlock("database", { tableId }), demo.id);
    const grid = a.locator(`[data-block-id='${blockId}'] [data-slot='docblocks/database-grid']`);
    await expect(grid).toBeVisible(SETTLE);

    const trigger = a.locator("[data-slot='docblocks/database-add-column-trigger']");
    const menu = a.locator("[data-slot='dropdown-menu-content']");
    const form = a.locator("[data-slot='docblocks/database-add-column-form']");
    await trigger.click();
    await expect(menu).toBeVisible(SETTLE);
    await menu.locator("[data-column-entry='enum']").click();
    await expect(form).toBeVisible(SETTLE);

    // The form's width's stand (the w-72's 288 px — the popover's box's
    // stand over the form's inner's content).
    const formPopover = a.locator("[data-slot='popover-content']").last();
    const formBox = await formPopover.boundingBox();
    expect(formBox!.width).toBeCloseTo(288, 0);

    // The standard's font (the text-sm's 14 px over the form's entries).
    const fontOf = (slot: string) =>
      form
        .locator(`[data-slot='${slot}']`)
        .first()
        .evaluate((el) => getComputedStyle(el).fontSize);
    await form.locator("[data-slot='docblocks/database-enum-option-add']").click();
    expect(await fontOf("docblocks/database-enum-option-name")).toBe("14px");
    expect(await fontOf("docblocks/database-enum-option-add")).toBe("14px");

    // The shared color's palette (the format's / the shape's toolbars'
    // stand): the 7's swatches + the none's stand.
    const addOption = async (name: string) => {
      await form.locator("[data-slot='docblocks/database-enum-option-add']").click();
      const inputs = form.locator("[data-slot='docblocks/database-enum-option-name']");
      await inputs.last().fill(name);
    };
    await addOption("alpha");
    await addOption("beta");
    await addOption("gamma");
    const colorTrigger = form.locator("[data-slot='docblocks/database-enum-option-color']").first();
    await colorTrigger.click();
    const swatches = a.locator("[data-slot='docblocks/palette-swatch']");
    const noneSwatch = a.locator("[data-slot='docblocks/palette-none']");
    await expect(swatches).toHaveCount(7, SETTLE);
    await expect(noneSwatch).toHaveCount(1, SETTLE);
    const secondHex = (await swatches.nth(1).getAttribute("data-color"))!;
    await swatches.nth(1).click();
    await expect(colorTrigger).toHaveAttribute("data-color", secondHex, SETTLE);
    await a.keyboard.press("Escape"); // the palette's popover stands the close (the drag's press stands clear)
    await a.waitForTimeout(200);

    // The grip's live reorder (the framer's Reorder's stand over the
    // motion's editor — the playground's default): the first's option's
    // row's drag over the third's seat stands the live's offset (the row's
    // travel over the drag).
    const grips = form.locator("[data-slot='docblocks/database-enum-option-grip']");
    const rows = form.locator("[data-slot='docblocks/database-enum-option-row']");
    await expect(rows).toHaveCount(4, SETTLE); // the empty's first + alpha + beta + gamma
    const gripBox = await grips.nth(1).boundingBox(); // alpha's row's grip
    await a.mouse.move(gripBox!.x + gripBox!.width / 2, gripBox!.y + gripBox!.height / 2);
    await a.mouse.down();
    // The two rows' travel (the 72 px's stand over the pitch's ~36 px):
    // the alpha's row over the gamma's seat. The framer's reorder stands
    // the live DOM's swap, so the order is read after the settle (the
    // index's locator re-resolves over the swapped's stand).
    await a.mouse.move(gripBox!.x + gripBox!.width / 2, gripBox!.y + gripBox!.height / 2 + 72, { steps: 12 });
    await a.mouse.up();
    await a.waitForTimeout(400); // the back-out's settle
    const orderAfter = await rows.evaluateAll((els) =>
      els.map((el) => (el.querySelector("input") as HTMLInputElement).value)
    );
    expect(orderAfter).toEqual(["", "beta", "gamma", "alpha"]);

    // The commit's stand (the regression): the system's table's rows stand
    // the dragged's order.
    await form.locator("[data-slot='docblocks/database-add-column-name']").fill("Mood");
    await form.locator("[data-slot='docblocks/database-add-column-create']").click();
    await expect(form).toBeHidden(SETTLE);
    const moodOrder = await a.evaluate(async (tableId) => {
      const bridge = window.__bridge!;
      const schema = await bridge.describeTable(tableId);
      const column = schema.columns.find((entry) => entry.name === "Mood");
      const refTableId = column?.reference?.tableId;
      if (refTableId === undefined) return null;
      const snapshot = await bridge.snapshotTable(refTableId, {});
      const nameColumnId = snapshot.columns.find((entry) => entry.name === "name")?.id ?? null;
      if (nameColumnId === null) return null;
      return snapshot.page.rows.map((row) => row.cells[nameColumnId]);
    }, demo.id);
    expect(moodOrder).toEqual(["beta", "gamma", "alpha"]);
  } finally {
    await context.close();
  }
});

test("the picker's contracts stand (the search's autofocus; the filter; the single's pick; the multi's toggle; the row's height)", async ({
  browser,
}) => {
  const context = await browser.newContext();
  const a = await context.newPage();
  try {
    await openPane(a, "a", `enum06-contract-${Math.random().toString(36).slice(2, 8)}`);
    const demo = await bridgeDemoTable(a);
    // The multi-enum's column (the demo's Statuses' dict) + the row's
    // first cell's tags' seed (the option's row id over the column id).
    const { Status: statusColId, Tags: tagsColId } = await a.evaluate(async (tableId) => {
      const bridge = window.__bridge!;
      const ctx = () => ({ operationId: crypto.randomUUID(), issuedAt: new Date().toISOString() });
      const { columns } = await bridge.describeTable(tableId);
      const statusColId = columns.find((column) => column.name === "Status")?.id ?? null;
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
      const enumSnapshot = await bridge.snapshotTable("table-statuses-enum", {});
      const nameColumnId = enumSnapshot.columns.find((column) => column.name === "name")?.id ?? null;
      const todoOption =
        nameColumnId === null ? undefined : enumSnapshot.page.rows.find((row) => row.cells[nameColumnId] === "todo");
      if (statusColId === null || todoOption === undefined) {
        throw new Error("the demo's Status column / the todo option stands absent");
      }
      const page = await bridge.snapshotTable(tableId, {});
      const rowId = page.page.rows[0]!.id;
      await bridge.batchRows(
        tableId,
        { ops: [{ op: "update", rowId, cells: { [tagsCol.result.id]: [todoOption.id] } }] },
        ctx()
      );
      return { Status: statusColId, Tags: tagsCol.result.id };
    }, demo.id);
    const doingId = await statusOptionId(a, "doing");

    const blockId = await a.evaluate((tableId) => window.__paneDocs!.a!.insertBlock("database", { tableId }), demo.id);
    const grid = a.locator(`[data-block-id='${blockId}'] [data-slot='docblocks/database-grid']`);
    await expect(grid).toBeVisible(SETTLE);

    const enumCell = a.locator(`[data-slot='docblocks/database-cell'][data-column-id='${statusColId}']`).first();

    // The search's autofocus (the regression): the open stands the input's
    // focus.
    await enumCell.dblclick();
    await a.waitForTimeout(150);
    await expect(a.locator("[data-slot='docblocks/database-enum-picker-search']")).toBeFocused();
    // The filter's stand (the query's stand over the rows).
    await a.keyboard.type("done");
    const visibleRows = a.locator("[data-slot='docblocks/database-enum-picker-row']");
    await expect(visibleRows).toHaveCount(1, SETTLE);
    await expect(visibleRows.first()).toContainText("done");
    await a.keyboard.press("Escape");
    await a.waitForTimeout(200);

    // The single's pick's commit (the regression): the pick stands the
    // value over the bridge.
    await enumCell.dblclick();
    await a.waitForTimeout(150);
    await a.locator(`[data-slot='docblocks/database-enum-picker-row'][data-option-value='${doingId}']`).click();
    await expect(enumCell).toHaveText("doing", SETTLE);

    // The multi's toggle (the regression): the row's press stands the
    // checkbox's toggle (the cell's chips' stand).
    const multiCell = a.locator(`[data-slot='docblocks/database-cell'][data-column-id='${tagsColId}']`).first();
    await multiCell.dblclick();
    await a.waitForTimeout(150);
    const firstOption = a.locator("[data-slot='docblocks/database-ref-multi-option']").first();
    const stateBefore = await firstOption.getAttribute("data-state");
    await firstOption.click();
    const stateAfter = await firstOption.getAttribute("data-state");
    expect(stateBefore).not.toBe(stateAfter);
    await a.keyboard.press("Escape");

    // The row's height's stand (the regression): the cell's line stands
    // the 32 px's stand (the unified's row's height).
    const cellHeight = await enumCell.boundingBox().then((box) => box!.height);
    expect(cellHeight).toBeCloseTo(32, 0);
  } finally {
    await context.close();
  }
});
