import { type Locator, type Page, expect, test } from "@playwright/test";

import { SETTLE, editorContext, openPane } from "./helpers";

async function demoTitles(page: Page): Promise<Array<string | null>> {
  return page.evaluate(async () => {
    const snapshot = await window.__bridge!.snapshotTable("table-demo", {});
    const title = snapshot.columns.find((column) => column.name === "Title")!.id;
    return snapshot.page.rows.map((row) => (row.cells[title] as string | undefined) ?? null);
  });
}

async function exerciseRange(page: Page, scope: Locator, action: "clear" | "delete"): Promise<void> {
  const first = scope.locator("[data-slot='docblocks/database-cell'][data-row='0'][data-col='0']");
  await expect(first).toBeVisible(SETTLE);
  await first.click();
  await scope.locator("[data-slot='docblocks/database-table']").focus();
  await page.keyboard.press("Shift+ArrowRight");
  await page.keyboard.press("Shift+ArrowDown");
  await expect(scope.locator("[data-slot='docblocks/database-cell'][data-selected='true']")).toHaveCount(4, SETTLE);
  await first.click({ button: "right" });
  const menu = page.locator("[data-slot='docblocks/database-context-menu']");
  await expect(menu).toBeVisible(SETTLE);
  await menu.locator(`[data-slot='docblocks/database-context-${action}']`).click();
  const changed = action === "clear" ? [null, null, "Third task"] : ["Third task"];
  await expect.poll(() => demoTitles(page), SETTLE).toEqual(changed);
  await scope.locator("[data-slot='docblocks/database-undo']").click();
  await expect.poll(() => demoTitles(page), SETTLE).toEqual(["First task", "Second task", "Third task"]);
}

async function openDocumentGrid(page: Page): Promise<Locator> {
  await openPane(page, "a", "db-range-menu");
  const blockId = await page.evaluate(() => window.__paneDocs!.a!.insertBlock("database", { tableId: "table-demo" }));
  const scope = page.locator(`[data-slot='docblocks/row'][data-block-id='${blockId}']`);
  await expect(scope.locator("[data-slot='docblocks/database-grid']")).toBeVisible(SETTLE);
  return scope;
}

async function openStandaloneGrid(page: Page): Promise<Locator> {
  await page.goto("/?tables=1");
  await page.locator("[data-table-id='table-demo']").click();
  const scope = page.locator("[data-testid='tables-grid']");
  await expect(scope.locator("[data-slot='docblocks/database-grid']")).toBeVisible(SETTLE);
  return scope;
}

for (const surface of ["document", "standalone"] as const) {
  for (const action of ["clear", "delete"] as const) {
    test(`the ${surface} grid ${action} action commits once and undoes once`, async ({ browser }) => {
      const context = await editorContext(browser);
      const page = await context.newPage();
      try {
        const scope = surface === "document" ? await openDocumentGrid(page) : await openStandaloneGrid(page);
        await exerciseRange(page, scope, action);
      } finally {
        await context.close();
      }
    });
  }
}
