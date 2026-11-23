// The datetime's cell's picker (the calendar + the time box: the commit
// / the cancel over the pane's bridge), and the number column's create
// form's attributes (the prefix / the thousands over the cell's display
// — the raw number stands the data).
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

test("the datetime cell stands the calendar + the time box (the time/date order, the Enter commit, the Escape's cancel; the commit over the pane's bridge)", async ({
  browser,
}) => {
  const context = await editorContext(browser);
  const a = await context.newPage();
  try {
    await openPane(a, "a", "db-datetimecell-" + Math.random().toString(36).slice(2, 8));

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
    // Enter commits the ISO date-time to the bridge + closes (the popover's
    // keys' stand).
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
    await a.keyboard.press("Enter");
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

    // The Escape's cancel: the in-flight changes (the time's re-edit over
    // the seed's stand; the same-day re-pick's toggle stands no draft date
    // reset) stand no write — the value stands the open-time's stand.
    await cellA.dblclick();
    await expect(picker).toBeVisible(SETTLE);
    await picker.locator("[data-slot='time-segments'] [data-segment='m']").fill("15");
    await picker.getByRole("button", { name: new RegExp(`${monthName} 20`) }).click();
    await a.keyboard.press("Escape");
    await expect(picker).toBeHidden(SETTLE);
    const rowAfterCancel = await readAt();
    expect(rowAfterCancel).toBe(`2026-${isoMonth}-20T07:45`);
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
    await openPane(a, "a", "db-numbercol-" + Math.random().toString(36).slice(2, 8));

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
