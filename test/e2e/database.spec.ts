import { type Page, expect, test } from "@playwright/test";

import { SETTLE, insertBlockType, twoPanes } from "./helpers";

/** Insert one v1 type at the root through the pane's harness control. */
async function insertType(page: Page, client: "a" | "b", type: string): Promise<void> {
  await insertBlockType(page, client, type);
}

/** The pane's database block from the harness global (its own letter). */
function readDatabase(page: Page, client: "a" | "b", dbId: string) {
  return page.evaluate(
    ({ client, dbId }) => {
      const doc = client === "a" ? window.__paneDocs?.a : window.__paneDocs?.b;
      const block = doc?.toJSON().blocks[dbId];
      return block?.type === "database" ? { rowOrder: block.rowOrder!, rows: block.rows! } : null;
    },
    { client, dbId }
  );
}

/** The database id + the seed row order, from the pane's live doc. */
async function databaseInfo(page: Page): Promise<{ dbId: string; rowOrder: string[] }> {
  const info = await page.evaluate(() => {
    const doc = window.__paneDocs?.a;
    if (!doc) return null;
    const json = doc.toJSON();
    const dbId = Object.keys(json.blocks).find((id) => json.blocks[id]!.type === "database");
    if (dbId === undefined) return null;
    const block = json.blocks[dbId]!;
    return { dbId, rowOrder: block.type === "database" ? block.rowOrder! : [] };
  });
  expect(info).not.toBeNull();
  return info!;
}

test("a database inserted in A renders in both panes and reaches the JSON", async ({ browser }) => {
  const { a, b, close } = await twoPanes(browser, "db-card");

  await insertType(a, "a", "database");

  for (const [pane, client] of [
    [a, "a"],
    [b, "b"],
  ] as const) {
    const doc = pane.locator(`[data-testid="doc-${client}"]`);
    const wrapper = doc.locator('[data-block-type="database"]');

    // The placeholder card in both panes: the column names (from the
    // harness seed) and the row count 2 (the seed rows synced over the
    // wire in B).
    await expect(wrapper).toHaveCount(1);
    await expect(wrapper.locator("[data-slot='docblocks/database-header']")).toContainText("Name");
    await expect(wrapper.locator("[data-slot='docblocks/database-header']")).toContainText("Done");
    await expect(wrapper.locator("[data-slot='docblocks/database-header']")).toContainText("Status");
    await expect(wrapper.locator("[data-slot='docblocks/database-count']")).toHaveText("2 rows");
    // The card frame reads the table border tokens (zone 3 — the classes
    // replaced the removed wrapper rule; the catalog has no database
    // block, so this pane is its visual pin).
    const cardStyle = await wrapper.first().evaluate((el) => {
      const s = getComputedStyle(el);
      return { width: s.borderTopWidth, style: s.borderTopStyle, radius: s.borderTopLeftRadius };
    });
    expect(cardStyle).toEqual({ width: "1px", style: "solid", radius: "10px" });
    // The wrapper contract: not text-editable, no gutter.
    expect(await wrapper.locator('[data-slot="docblocks/block-content"]').count()).toBe(0);
    expect(await wrapper.locator('[data-slot="docblocks/gutter"]').count()).toBe(0);
  }

  // The JSON inspector of pane A shows the rows + rowOrder + a cell value.
  const jsonA = a.getByTestId("json-a");
  await expect.poll(async () => (await jsonA.innerText()).includes('"type": "database"'), SETTLE).toBe(true);
  const jsonText = await jsonA.innerText();
  expect(jsonText).toContain('"rows"');
  expect(jsonText).toContain('"rowOrder"');
  expect(jsonText).toContain('"First task"');
  expect(jsonText).toContain('"status": "active"');

  await close();
});

test("the row commands over the wire: insertRow / setCell / moveRow / removeRow reach pane B", async ({ browser }) => {
  const { a, b, close } = await twoPanes(browser, "db-wire");

  await insertType(a, "a", "database");
  const cardB = b.locator('[data-block-type="database"]');
  await expect.poll(async () => cardB.count(), SETTLE).toBe(1);
  await expect(cardB.locator("[data-slot='docblocks/database-count']")).toHaveText("2 rows");

  const info = await databaseInfo(a);
  const { dbId, rowOrder: seedOrder } = info;
  const outBefore = await a.locator("[data-testid='wire-a'] li", { hasText: " out " }).count();

  // Stage 1: insertRow + one transact of two setCells (the name + a
  // select cell with a valid option) — two wire updates.
  const newRow = await a.evaluate(
    ({ dbId }: { dbId: string }) => {
      const doc = window.__paneDocs!.a!;
      const newRow = doc.insertRow(dbId);
      doc.transact(() => {
        doc.setCell(dbId, newRow, "name", "New row");
        doc.setCell(dbId, newRow, "status", "active");
      });
      return newRow;
    },
    { dbId }
  );
  await expect
    .poll(async () => a.locator("[data-testid='wire-a'] li", { hasText: " out " }).count(), SETTLE)
    .toBeGreaterThanOrEqual(outBefore + 2);

  // Pane B: the new row present with the values, the count updated (3 rows).
  await expect
    .poll(async () => readDatabase(b, "b", dbId), SETTLE)
    .toMatchObject({
      rowOrder: [...seedOrder, newRow],
    });
  const stage1 = await readDatabase(b, "b", dbId);
  expect(stage1?.rows[newRow]).toEqual({ name: "New row", status: "active" });
  await expect(cardB.locator("[data-slot='docblocks/database-count']")).toHaveText("3 rows");

  // Stage 2: moveRow (the first seed row to the end, pre-move index) +
  // removeRow (the second seed row) — two more wire updates.
  await a.evaluate(
    ({ dbId }: { dbId: string }) => {
      const doc = window.__paneDocs!.a!;
      const json = doc.toJSON();
      const block = json.blocks[dbId]!;
      const [first, second] = block.type === "database" ? block.rowOrder! : [];
      doc.moveRow(dbId, first!, 2);
      doc.removeRow(dbId, second!);
    },
    { dbId }
  );
  await expect
    .poll(async () => a.locator("[data-testid='wire-a'] li", { hasText: " out " }).count(), SETTLE)
    .toBeGreaterThanOrEqual(outBefore + 4);

  // Pane B: the order moved, the removed row gone, the count back to 2.
  await expect
    .poll(async () => readDatabase(b, "b", dbId), SETTLE)
    .toMatchObject({
      rowOrder: [seedOrder[0]!, newRow],
    });
  const final = await readDatabase(b, "b", dbId);
  expect(final?.rows[seedOrder[0]!]).toEqual({ name: "First task", done: false, status: "active" });
  expect(final?.rows[newRow]).toEqual({ name: "New row", status: "active" });
  expect(final?.rows[seedOrder[1]!]).toBeUndefined();
  await expect(cardB.locator("[data-slot='docblocks/database-count']")).toHaveText("2 rows");

  // The four command updates are visible in A's wire log.
  const wireText = await a.locator("[data-testid='wire-a']").innerText();
  expect((wireText.match(/ out /g) ?? []).length).toBeGreaterThanOrEqual(outBefore + 4);

  await close();
});

test("setCell with an out-of-options select value throws InvalidCellValueError (the doc is unchanged)", async ({
  browser,
}) => {
  const { a, close } = await twoPanes(browser, "db-error");

  await insertType(a, "a", "database");
  const { dbId, rowOrder: seedOrder } = await databaseInfo(a);
  const rowId = seedOrder[0]!;

  const snapshotOf = () => a.evaluate(() => JSON.stringify(window.__paneDocs?.a?.toJSON() ?? null));
  // The document's tail contract: the peer's remote feed stands the doc's
  // trailing paragraph over the wire (the non-text tail stands no caret
  // home). Settle it before the stability baseline, or the stand lands
  // inside the comparison window and reads as a "changed" doc.
  await expect
    .poll(
      () =>
        a.evaluate(() => {
          const doc = window.__paneDocs?.a;
          if (doc === null || doc === undefined) return false;
          const json = doc.toJSON();
          const root = json.blocks[json.id]!;
          const children = root.children;
          if (children === undefined) return false;
          const lastId = children[children.length - 1];
          return lastId !== undefined && json.blocks[lastId]!.type === "paragraph";
        }),
      SETTLE
    )
    .toBe(true);
  const before = await snapshotOf();

  const outcome = await a.evaluate(
    ({ dbId, rowId }) => {
      const doc = window.__paneDocs!.a!;
      try {
        doc.setCell(dbId, rowId, "status", "bogus");
        return "no-throw";
      } catch (error) {
        return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
      }
    },
    { dbId, rowId }
  );
  expect(outcome.startsWith("InvalidCellValueError")).toBe(true);
  expect(outcome).toContain("status");

  // The failed command left the doc untouched (the JSON is stable).
  expect(await snapshotOf()).toBe(before);

  await close();
});
