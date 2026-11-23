// The header's seam's resize's stand: the columnWidths' commit over the
// wire (the live preview stands view state), the no-op drag's no-write,
// and the grid's own measurement's scope (two grids on one page).
import { type Page, expect, test } from "@playwright/test";

import { SETTLE, twoPanes } from "./helpers";

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

test("the header's right-edge seam resizes the column (the columnWidths attr over the wire; the no-op drag stands none)", async ({
  browser,
}) => {
  const { a, close } = await twoPanes(browser, "db-colwidth");

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

  const { Title: titleColId } = await demoColumns(a, demo.id, ["Title"]);
  const titleHeader = a.locator(`[data-slot='docblocks/database-header-cell'][data-column-id='${titleColId}']`);
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

test("two grids on one page stand their own measurement (the seam's commit reads its own grid's cells)", async ({
  browser,
}) => {
  const { a, close } = await twoPanes(browser, "db-multigrid");

  // Two blocks over the same table: the page stands two grids at once (the
  // measurement's scope — a grid must not read the foreign grid's cells).
  const demo = await bridgeDemoTable(a);
  const dbIdA = (await a.evaluate((tableId) => window.__paneDocs!.a!.insertBlock("database", { tableId }), demo.id))!;
  const dbIdB = (await a.evaluate((tableId) => window.__paneDocs!.a!.insertBlock("database", { tableId }), demo.id))!;
  const gridOf = (id: string) => a.locator(`[data-block-id='${id}']`);
  const seamOf = (id: string, index: number) =>
    gridOf(id).locator(`[data-slot='docblocks/database-col-resize'][data-index='${index}']`);
  const headerCellOf = (id: string, index: number) =>
    gridOf(id).locator("[data-slot='docblocks/database-header-cell']").nth(index);
  const widthsOf = (id: string) =>
    a.evaluate(
      (blockId) =>
        (window.__paneDocs!.a!.toJSON().blocks[blockId]?.attrs as Record<string, unknown> | undefined)?.columnWidths ??
        null,
      id
    );

  await expect(gridOf(dbIdA).locator("[data-slot='docblocks/database-grid']")).toBeVisible(SETTLE);
  await expect(gridOf(dbIdB).locator("[data-slot='docblocks/database-grid']")).toBeVisible(SETTLE);

  // The grid A's columns 0 + 1 widen (the commit's stand over the default).
  const widen = async (id: string, index: number) => {
    await headerCellOf(id, index).hover();
    const seam = (await seamOf(id, index).boundingBox())!;
    await a.mouse.move(seam.x + 1, seam.y + 1);
    await a.mouse.down();
    await a.mouse.move(seam.x + 1 + 96, seam.y + 1, { steps: 6 });
    await a.mouse.up();
  };
  await widen(dbIdA, 0);
  await expect.poll(async () => await widthsOf(dbIdA), SETTLE).toEqual(expect.arrayContaining([expect.any(Number)]));
  await widen(dbIdA, 1);
  await expect.poll(async () => await widthsOf(dbIdA), SETTLE).not.toBeNull();
  const widthsA = (await widthsOf(dbIdA)) as number[];
  expect(widthsA[0]!).toBeGreaterThan(190);
  expect(widthsA[1]!).toBeGreaterThan(190);

  // The grid B's commit reads its own cells: the non-dragged column 1 must
  // stand its own measured width (not the grid A's widened stand — the
  // document-wide query would stand the grid A's cell over the grid B's
  // commit).
  await headerCellOf(dbIdB, 0).hover();
  const seamB = (await seamOf(dbIdB, 0).boundingBox())!;
  await a.mouse.move(seamB.x + 1, seamB.y + 1);
  await a.mouse.down();
  await a.mouse.move(seamB.x + 1 + 2, seamB.y + 1, { steps: 3 });
  await a.mouse.up();
  await expect.poll(async () => await widthsOf(dbIdB), SETTLE).toEqual(expect.arrayContaining([expect.any(Number)]));
  const widthsB = (await widthsOf(dbIdB)) as number[];
  expect(
    widthsB[1]!,
    "the grid B's column 1 must stand its own measurement (not the grid A's widened stand)"
  ).toBeLessThan(180);

  await close();
});
