// The external form's stand: the tableId's reference travels over the
// wire (the data stands per pane over its own bridge), the ready grid's
// render, and the row commands' typed refusal over the form.
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

test("the external form (the tableId reference) syncs over the wire and renders the live grid", async ({ browser }) => {
  const { a, b, close } = await twoPanes(browser, "db-external");

  // Both panes' default bridges seed the identical demo table (per page);
  // the reference only travels over the wire, the data is per-page.
  const demoA = await bridgeDemoTable(a);
  const demoB = await bridgeDemoTable(b);
  expect(demoA.id).toBe(demoB.id);
  expect(demoA.name).toBe("Demo");

  const dbId = (await a.evaluate((tableId) => window.__paneDocs!.a!.insertBlock("database", { tableId }), demoA.id))!;

  for (const [pane, client] of [
    [a, "a"],
    [b, "b"],
  ] as const) {
    const doc = pane.locator(`[data-testid="doc-${client}"]`);
    const wrapper = doc.locator("[data-block-type='database']");
    await expect(wrapper).toHaveCount(1, SETTLE);
    // The ready grid stands (not the broken state): the table name from the
    // pane's own bridge + the demo row count (3 rows).
    const card = wrapper.locator("[data-slot='docblocks/database']");
    await expect(card).toHaveCount(1, SETTLE);
    await expect(card).not.toHaveAttribute("data-state", "broken", SETTLE);
    await expect(wrapper.locator("[data-slot='docblocks/database-name']")).toHaveText("Demo", SETTLE);
    await expect(wrapper.locator("[data-slot='docblocks/database-count']")).toHaveText("3 rows", SETTLE);

    // The doc keeps the reference only: the inline schema is absent on both sides.
    const json = await pane.evaluate(
      ({ client, dbId }) => {
        const d = client === "a" ? window.__paneDocs?.a : window.__paneDocs?.b;
        const block = d?.toJSON().blocks[dbId] as { attrs?: Record<string, unknown> } | undefined;
        return {
          tableId: typeof block?.attrs?.tableId === "string" ? block.attrs.tableId : null,
          columns: Array.isArray(block?.attrs?.columns) ? (block.attrs.columns as unknown[]).length : null,
        };
      },
      { client, dbId }
    );
    expect(json.tableId).toBe(demoA.id);
    expect(json.columns).toBeNull();
  }

  await close();
});

test("the row commands refuse the external form over the wire (the typed error)", async ({ browser }) => {
  const { a, close } = await twoPanes(browser, "db-external-error");

  const dbId = (await a.evaluate(() => window.__paneDocs!.a!.insertBlock("database", { tableId: "ext-1" })))!;
  // The block itself is the comparison unit: the room's tail guarantee may
  // still be standing its paragraph over the wire, so the whole-doc
  // snapshot is not a stable baseline here.
  const blockOf = () => a.evaluate((id) => JSON.stringify(window.__paneDocs?.a?.getBlock(id) ?? null), dbId);
  const before = await blockOf();

  const outcome = await a.evaluate((dbId) => {
    const doc = window.__paneDocs!.a!;
    try {
      doc.insertRow(dbId);
      return "no-throw";
    } catch (error) {
      return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    }
  }, dbId);
  expect(outcome.startsWith("ExternalDatabaseError")).toBe(true);
  expect(outcome).toContain("ext-1");

  // The failed command left the block untouched.
  await expect.poll(async () => (await blockOf()) === before, SETTLE).toBe(true);

  await close();
});
