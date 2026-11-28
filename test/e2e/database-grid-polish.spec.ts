import { type Page, expect, test } from "@playwright/test";

import { SETTLE, expectStays, twoPanes } from "./helpers";

test.setTimeout(45_000);

async function demoTable(page: Page): Promise<string> {
  await expect
    .poll(async () => {
      return page.evaluate(async () => {
        const tables = (await window.__bridge?.listTables()) ?? [];
        return tables.find((table) => table.name === "Demo")?.id ?? null;
      });
    }, SETTLE)
    .not.toBeNull();
  return page.evaluate(async () => {
    const tables = await window.__bridge!.listTables();
    return tables.find((table) => table.name === "Demo")!.id;
  });
}

function heightAttr(page: Page, client: "a" | "b", dbId: string) {
  return page.evaluate(
    ({ client, dbId }) => {
      const doc = client === "a" ? window.__paneDocs?.a : window.__paneDocs?.b;
      const block = doc?.getBlock(dbId);
      const value = block?.type === "database" ? block.attrs?.height : null;
      return typeof value === "number" ? value : null;
    },
    { client, dbId }
  );
}

async function dragBottom(page: Page, wrapper: ReturnType<Page["locator"]>, delta: number) {
  await wrapper.hover();
  const box = (await wrapper.boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + box.height - 4;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y + delta, { steps: 5 });
  await page.mouse.up();
}

test("the document grid's polished chrome and bottom resize work over the wire", async ({ browser }) => {
  const { a, b, close } = await twoPanes(browser, "db-grid-polish");
  const tableId = await demoTable(a);
  const dbId = await a.evaluate((id) => window.__paneDocs!.a!.insertBlock("database", { tableId: id }), tableId);
  const wrapper = a.locator("[data-testid='doc-a'] [data-block-type='database']:not([data-slot='docblocks/row'])");
  const wrapperB = b.locator("[data-testid='doc-b'] [data-block-type='database']:not([data-slot='docblocks/row'])");
  await expect(wrapper).toHaveCount(1, SETTLE);
  await expect(wrapperB).toHaveCount(1, SETTLE);
  await expect(wrapper.locator("[data-slot='docblocks/database-count']")).toHaveText("3 rows", SETTLE);

  const undo = wrapper.locator("[data-slot='docblocks/database-undo']");
  const redo = wrapper.locator("[data-slot='docblocks/database-redo']");
  await expect(undo).toHaveAttribute("aria-label", "Undo");
  await expect(undo.locator("svg")).toBeVisible();
  await expect(redo).toHaveAttribute("aria-label", "Redo");
  await expect(redo.locator("svg")).toBeVisible();
  await expect(undo).toBeDisabled();
  await expect(redo).toBeDisabled();

  const table = wrapper.locator("[data-slot='docblocks/database-table']");
  const borders = await table.evaluate((element) => {
    const style = getComputedStyle(element);
    return [style.borderTopWidth, style.borderRightWidth, style.borderBottomWidth, style.borderLeftWidth];
  });
  expect(borders).toEqual(["1px", "1px", "1px", "1px"]);
  await expect(wrapper.locator("[data-slot='docblocks/database-header-cell']").first()).toHaveCSS(
    "border-top-left-radius",
    "10px"
  );
  await expect(wrapper.locator("[data-slot='docblocks/database-add-column']")).toHaveCSS(
    "border-top-right-radius",
    "10px"
  );
  await expect(wrapper.locator("[data-slot='docblocks/database-cell'][data-row='2'][data-col='0']")).toHaveCSS(
    "border-bottom-left-radius",
    "10px"
  );
  await expect(wrapper.locator("[data-slot='docblocks/database-row-menu']").last()).toHaveCSS(
    "border-bottom-right-radius",
    "10px"
  );

  const addRow = wrapper.locator("[data-slot='docblocks/database-add-row']");
  await expect(addRow).toHaveClass(/bg-accent/);
  await addRow.click();
  await expect(wrapper.locator("[data-slot='docblocks/database-count']")).toHaveText("4 rows", SETTLE);
  await expect(undo).toBeEnabled();
  await undo.click();
  await expect(wrapper.locator("[data-slot='docblocks/database-count']")).toHaveText("3 rows", SETTLE);
  await expect(redo).toBeEnabled();
  await redo.click();
  await expect(wrapper.locator("[data-slot='docblocks/database-count']")).toHaveText("4 rows", SETTLE);

  await expect(wrapper.locator("[data-slot='docblocks/database-resize']")).toBeAttached();
  expect(await heightAttr(a, "a", dbId)).toBeNull();
  await expect.poll(async () => wrapper.evaluate((element) => element.style.maxHeight), SETTLE).not.toBe("none");
  await dragBottom(a, wrapper, 120);
  await expect.poll(async () => heightAttr(a, "a", dbId), SETTLE).not.toBeNull();
  const committed = await heightAttr(a, "a", dbId);
  if (committed === null) throw new Error("The resize commit is missing");
  await expect.poll(async () => heightAttr(b, "b", dbId), SETTLE).toBe(committed);

  await dragBottom(a, wrapper, -2000);
  await expect.poll(async () => heightAttr(a, "a", dbId), SETTLE).toBeLessThan(committed);
  const scrolling = await wrapper.locator("[data-slot='docblocks/database-grid']").evaluate((element) => ({
    client: element.clientHeight,
    scroll: element.scrollHeight,
  }));
  expect(scrolling.scroll).toBeGreaterThan(scrolling.client);
  await close();
});

test("the auto height keeps the ten-row cap beyond the loaded window", async ({ browser }) => {
  const { a, close } = await twoPanes(browser, "db-grid-auto-height");
  const tableId = await demoTable(a);
  await a.evaluate(async (id) => {
    await window.__bridge!.batchRows(
      id,
      {
        ops: Array.from({ length: 12 }, () => ({ op: "create" as const, row: {}, beforeRowId: null })),
      },
      { operationId: crypto.randomUUID(), issuedAt: new Date().toISOString() }
    );
  }, tableId);
  await a.evaluate((id) => window.__paneDocs!.a!.insertBlock("database", { tableId: id }), tableId);

  const wrapper = a.locator("[data-testid='doc-a'] [data-block-type='database']:not([data-slot='docblocks/row'])");
  await expect(wrapper.locator("[data-slot='docblocks/database-count']")).toHaveText("15 rows", SETTLE);
  const grid = wrapper.locator("[data-slot='docblocks/database-grid']");
  await expect
    .poll(async () => grid.evaluate((element) => element.scrollHeight > element.clientHeight), SETTLE)
    .toBe(true);
  const cappedHeight = await wrapper.evaluate((element) => element.getBoundingClientRect().height);
  const maxHeight = Number.parseFloat(await wrapper.evaluate((element) => element.style.maxHeight));
  expect(maxHeight).toBeGreaterThan(0);
  expect(cappedHeight).toBeLessThanOrEqual(maxHeight);
  await expectStays(async () => {
    await expect(wrapper).toHaveCSS("max-height", `${maxHeight}px`);
    expect(await wrapper.evaluate((element) => element.getBoundingClientRect().height)).toBe(cappedHeight);
    expect(await grid.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true);
  });
  await close();
});
