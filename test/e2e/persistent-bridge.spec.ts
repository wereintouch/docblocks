// The persistent bridge's harness global (the wrapped default memory bridge
// over the localStorage snapshot).
//
// The snapshot stores each table's stable id (independent of the name), so
// the reload's restore re-creates the table under its original id: a rename
// and the doc's `tableId` references survive. Pinned: create → rename →
// save → reload keeps the original table id.
import { type Page, expect, test } from "@playwright/test";

import { openPane } from "./helpers";

/** Whether the bridge holds a table of the given id (the seed's readiness
 * is awaited by the bridge's reads). */
const hasTableId = (page: Page, tableId: string) =>
  page.evaluate(async (id) => {
    const bridge = window.__bridge;
    if (bridge === undefined) return false;
    const tables = await bridge.listTables();
    return tables.some((table) => table.id === id);
  }, tableId);

test("the persistent bridge keeps the table id across a rename and a reload", async ({ browser }) => {
  const context = await browser.newContext();
  const a = await context.newPage();
  const room = `persist-${Math.random().toString(36).slice(2, 8)}`;
  try {
    await openPane(a, "a", room, { first: true });

    // Create a table through the persistent bridge and capture its id.
    const tableId = await a.evaluate(() => {
      const bridge = window.__bridge;
      if (bridge === undefined) throw new Error("the bridge global is not ready");
      return bridge.createTable("Probe Table");
    });

    // Rename it. The table id is derived from the name's slug, and the
    // snapshot stores the name only — so the reload's re-creation would
    // derive a fresh id and drop the original one.
    await a.evaluate((id) => {
      const bridge = window.__bridge;
      if (bridge === undefined) throw new Error("the bridge global is not ready");
      return bridge.renameTable(id, "Renamed Table");
    }, tableId);

    // Let the save's debounce flush the snapshot to localStorage.
    await a.waitForTimeout(500);

    // Reload: the seed re-creates the tables from the snapshot. The table's
    // original id must survive (the doc's `tableId` references depend on it).
    await a.reload();
    await expect(a.getByTestId("status-a").first()).toHaveText("connected");
    await expect.poll(() => hasTableId(a, tableId), { timeout: 15_000 }).toBe(true);
  } finally {
    await context.close();
  }
});
