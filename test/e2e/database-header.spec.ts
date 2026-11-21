// The header's stand: the type's line stands the menu only (the widths
// align over the rows, the drag reorders over the wire — the preview's
// no-write), and the name's px-2's padding (the icon's left's stand, the
// rename's regression).
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

test("the header: the type stands in the menu only, the widths align with the rows, the drag reorders over the wire", async ({
  browser,
}) => {
  const { a, b, close } = await twoPanes(browser, "db-header");

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

test("the header's name stands the px-2 padding (the text stands over the data's text; the rename stands)", async ({
  browser,
}) => {
  const context = await editorContext(browser);
  const a = await context.newPage();
  try {
    await openPane(a, "a", "db-header-pad-" + Math.random().toString(36).slice(2, 8));

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
