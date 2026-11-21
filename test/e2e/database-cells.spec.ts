// The cell's value types' stand: the enum's chip over the EnumPicker
// (the number's spin-button's suppression), and the date's DatePicker
// (the pick's commit over the pane's bridge, the grid's scroller's thin
// scrollbar).
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

test("the enum cell stands the package's EnumPicker (the pick commits over the pane's bridge; the doc stands); the number cell suppresses the spin buttons", async ({
  browser,
}) => {
  const context = await editorContext(browser);
  const a = await context.newPage();
  try {
    await openPane(a, "a", "db-cells-" + Math.random().toString(36).slice(2, 8));

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
    await openPane(a, "a", "db-datecell-" + Math.random().toString(36).slice(2, 8));

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
