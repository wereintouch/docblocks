import { expect, test } from "@playwright/test";

import { SETTLE, editorContext, openPane } from "./helpers";

test("the localized numeric emptiness filter keeps old rows until its snapshot arrives", async ({ browser }) => {
  const context = await editorContext(browser);
  const page = await context.newPage();
  try {
    await openPane(page, "a", "db-filter-no-flicker");
    await page.evaluate(() => document.documentElement.setAttribute("lang", "ru"));
    const countColumnId = await page.evaluate(async () => {
      const snapshot = await window.__bridge!.snapshotTable("table-demo", {});
      return snapshot.columns.find((column) => column.name === "Count")!.id;
    });
    await page.evaluate(() => window.__paneDocs!.a!.insertBlock("database", { tableId: "table-demo" }));
    await expect(page.locator("[data-slot='docblocks/database-cell']")).toHaveCount(12, SETTLE);
    await page.evaluate(() => {
      const bridge = window.__bridge!;
      const original = bridge.snapshotTable.bind(bridge);
      let release = (): void => undefined;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      Object.assign(window, { releaseFilterSnapshot: release, filterSnapshotWaiting: false });
      bridge.snapshotTable = async (tableId, query) => {
        if (query.filter !== undefined) {
          Object.assign(window, { filterSnapshotWaiting: true });
          await gate;
        }
        return original(tableId, query);
      };
    });
    await page.locator("[data-slot='docblocks/database-filter']").click();
    await page.locator("[data-slot='docblocks/filter-add-condition']").click();
    await page.locator("[data-slot='docblocks/filter-column']").selectOption(countColumnId);
    await page.locator("[data-slot='docblocks/filter-operator']").click();
    const empty = page.locator("[data-slot='docblocks/filter-operator-option'][data-operator='empty']");
    await expect(empty).toHaveText("не заполнено", SETTLE);
    await empty.click();
    await expect(page.locator("[data-slot='docblocks/filter-value']")).toHaveCount(0);
    await page.locator("[data-slot='docblocks/filter-apply']").click();
    await expect
      .poll(
        () =>
          page.evaluate(
            () => (window as unknown as { filterSnapshotWaiting?: boolean }).filterSnapshotWaiting === true
          ),
        SETTLE
      )
      .toBe(true);
    await expect(page.locator("[data-slot='docblocks/database-cell']")).toHaveCount(12);
    await expect(page.locator("[data-slot='docblocks/database'][data-state='loading']")).toHaveCount(0);
    await expect(page.locator("[data-slot='docblocks/database-empty']")).toHaveCount(0);
    await page.evaluate(() => (window as unknown as { releaseFilterSnapshot: () => void }).releaseFilterSnapshot());
    await expect(page.locator("[data-slot='docblocks/database-empty']")).toHaveText(
      "Строки не соответствуют фильтру.",
      SETTLE
    );
    await page.locator("[data-slot='docblocks/database-filter']").click();
    await page.locator("[data-slot='docblocks/filter-clear']").click();
    await page.locator("[data-slot='docblocks/filter-apply']").click();
    await expect(page.locator("[data-slot='docblocks/database-cell']")).toHaveCount(12, SETTLE);
  } finally {
    await context.close();
  }
});
