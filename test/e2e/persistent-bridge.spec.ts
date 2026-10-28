import { type Page, expect, test } from "@playwright/test";

// The persistent bridge's harness global (the wrapped default memory bridge
// over the localStorage snapshot).
//
// Pinned with test.fail(): while the snapshot stores the table's name only (no
// stable id), the reload's re-creation derives a fresh id and the original one
// is lost, so the assertion fails and the fail-mark is met. Once a stable
// tableId is persisted and restored, the test passes and must be converted to a
// plain test().
const RELAY = "ws://localhost:5199";

async function openPane(page: Page, client: "a" | "b", room: string): Promise<void> {
  await page.goto(`/?client=${client}&syncUrl=${RELAY}/${room}`);
  await expect(page.getByTestId(`status-${client}`).first()).toHaveText("connected");
}

/** Whether the bridge holds a table of the given id (the seed's readiness
 * is awaited by the bridge's reads). */
const hasTableId = (page: Page, tableId: string) =>
  page.evaluate(async (id) => {
    const bridge = window.__bridge;
    if (bridge === undefined) return false;
    const tables = await bridge.listTables();
    return tables.some((table) => table.id === id);
  }, tableId);

test.fail("the persistent bridge keeps the table id across a rename and a reload", async ({ browser }) => {
  const context = await browser.newContext();
  const a = await context.newPage();
  const room = `persist-${Math.random().toString(36).slice(2, 8)}`;
  try {
    await openPane(a, "a", room);

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
