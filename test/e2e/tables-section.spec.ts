/**
 * The standalone's database tables section (`?tables=1`): the `useTableList`
 * hook + the `DatabaseTable` component over the harness's shared bridge
 * (the panes' blocks stand the same tables — the cross-surface's parity).
 * The section stands outside any document (the consumer's own page's
 * stand); the bridge's truth is read over `window.__bridge` (the
 * harness's e2e stand).
 */
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

import { SETTLE } from "./helpers";

const SECTION_URL = "/?tables=1";

/** The harness's demo table's ref (the playground's per-page seed). */
async function demoTable(page: Page): Promise<{ id: string; name: string }> {
  await expect
    .poll(async () => {
      const tables = await page.evaluate(async () => window.__bridge?.listTables() ?? []);
      return tables.find((entry) => entry.name === "Demo") ?? null;
    }, SETTLE)
    .not.toBeNull();
  return page.evaluate(async () => {
    const tables = await window.__bridge!.listTables();
    return tables.find((entry) => entry.name === "Demo")!;
  });
}

/** The demo table's column id by the schema's name. */
async function columnIdOf(page: Page, tableId: string, name: string): Promise<string> {
  return page.evaluate(
    async ({ tableId, name }) => {
      const { columns } = await window.__bridge!.describeTable(tableId);
      const column = columns.find((entry) => entry.name === name);
      if (column === undefined) throw new Error(`the demo table's "${name}" column stands absent`);
      return column.id;
    },
    { tableId, name }
  );
}

test.beforeEach(async ({ page }) => {
  await page.goto(SECTION_URL);
});

test("the catalog's list stands the harness's demo table (the seed's settle)", async ({ page }) => {
  const demoName = page.locator("[data-testid='tables-item-name']").getByText("Demo", { exact: true });
  await expect(demoName).toBeVisible(SETTLE);
});

test("the standalone root anchors the package's token scope (the computed tokens resolve)", async ({ page }) => {
  const demo = await demoTable(page);
  await page.locator(`[data-testid='tables-item'][data-table-id='${demo.id}']`).click();
  await expect(page.locator("[data-slot='docblocks/database-name']")).toBeVisible(SETTLE);

  // The token mapping is declared on the editor root's selector; the
  // standalone's root stands that scope over the consumer's page (the
  // section stands outside any document) — the computed custom
  // properties resolve over the grid (absent the scope, the grid's
  // token-driven utilities stand unresolved).
  const scope = page.locator("[data-testid='tables-grid'] [data-slot='docblocks/editor']");
  await expect
    .poll(async () => {
      return scope.evaluate((element) => {
        const styles = getComputedStyle(element);
        return [
          styles.getPropertyValue("--docblocks-block-spacing"),
          styles.getPropertyValue("--docblocks-table-border-color"),
        ].filter((value) => value.trim() !== "").length;
      });
    }, SETTLE)
    .toBe(2);
});

test("the create's stand: the list's grow + the grid's render over the new table", async ({ page }) => {
  await page.locator("[data-testid='tables-create-input']").fill("Tasks");
  await page.locator("[data-testid='tables-create']").click();

  // The auto-refresh stands the new table's entry (selected by default).
  const item = page.locator("[data-testid='tables-item']", { hasText: "Tasks" });
  await expect(item).toBeVisible(SETTLE);

  // The grid's render over the new (column-less) table: the toolbar's stand.
  await expect(page.locator("[data-slot='docblocks/database-toolbar']").first()).toBeVisible(SETTLE);

  // The bridge's truth stands the create.
  await expect
    .poll(async () => {
      return page.evaluate(async () =>
        window.__bridge!.listTables().then((tables) => tables.some((t) => t.name === "Tasks"))
      );
    })
    .toBe(true);
});

test("the section's rename commits to the bridge; the grid's name stands live", async ({ page }) => {
  const demo = await demoTable(page);

  // Select the demo table + wait for the grid's settle.
  await page.locator(`[data-testid='tables-item'][data-table-id='${demo.id}']`).click();
  await expect(page.locator("[data-slot='docblocks/database-name']")).toHaveText("Demo", SETTLE);

  // The section's rename (the useTableList's stand).
  await page.locator(`[data-testid='tables-item'][data-table-id='${demo.id}'] [data-testid='tables-rename']`).click();
  const input = page.locator("[data-testid='tables-rename-input']");
  await input.fill("Renamed Demo");
  await input.press("Enter");

  // The list's stand (the auto-refresh) + the bridge's truth.
  await expect(page.locator(`[data-testid='tables-item'][data-table-id='${demo.id}']`)).toContainText(
    "Renamed Demo",
    SETTLE
  );
  await expect
    .poll(
      async () =>
        page.evaluate(async (id) => {
          const tables = await window.__bridge!.listTables();
          return tables.find((entry) => entry.id === id)?.name ?? null;
        }, demo.id),
      SETTLE
    )
    .toBe("Renamed Demo");

  // The grid's display name stands live over the table event.
  await expect(page.locator("[data-slot='docblocks/database-name']")).toHaveText("Renamed Demo", SETTLE);
});

test("the cell's edit over the standalone's grid commits to the bridge", async ({ page }) => {
  const demo = await demoTable(page);
  const countId = await columnIdOf(page, demo.id, "Count");

  await page.locator(`[data-testid='tables-item'][data-table-id='${demo.id}']`).click();
  const cell = page.locator(`[data-slot='docblocks/database-cell'][data-column-id='${countId}']`).first();
  await expect(cell).toBeVisible(SETTLE);

  await cell.dblclick();
  const input = cell.locator("[data-slot='docblocks/database-cell-input']");
  await expect(input).toBeVisible(SETTLE);
  await input.fill("99");
  await input.blur();

  // The bridge's truth stands the commit (the data's stand over the doc).
  await expect
    .poll(async () => {
      return page.evaluate(
        async ({ tableId, columnId }) => {
          const snapshot = await window.__bridge!.snapshotTable(tableId, {});
          return snapshot.page.rows.map((row) => row.cells[columnId]).includes(99);
        },
        { tableId: demo.id, columnId: countId }
      );
    })
    .toBe(true);
});

test("the readOnly's stand: the cell's edit session stands off", async ({ page }) => {
  const demo = await demoTable(page);
  const titleId = await columnIdOf(page, demo.id, "Title");

  await page.locator(`[data-testid='tables-item'][data-table-id='${demo.id}']`).click();
  const cell = page.locator(`[data-slot='docblocks/database-cell'][data-column-id='${titleId}']`).first();
  await expect(cell).toBeVisible(SETTLE);

  await page.locator("[data-testid='tables-readonly']").check();
  await cell.dblclick();
  await expect(cell.locator("[data-slot='docblocks/database-cell-input']")).toHaveCount(0, { timeout: 1500 });
});

test("the manual's refresh re-reads the external's create", async ({ page }) => {
  // The external's create over the bridge (the section's list stands no push).
  await page.evaluate(async () => {
    await window.__bridge!.createTable(
      { name: "External" },
      { operationId: crypto.randomUUID(), issuedAt: new Date().toISOString() }
    );
  });
  await expect(page.locator("[data-testid='tables-item']", { hasText: "External" })).toHaveCount(0);

  await page.locator("[data-testid='tables-refresh']").click();
  await expect(page.locator("[data-testid='tables-item']", { hasText: "External" })).toBeVisible(SETTLE);
});
