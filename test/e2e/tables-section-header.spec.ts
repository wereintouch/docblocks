/**
 * The standalone's tables section — the header row's height stand
 * (`?tables=1`): the stretch's names' wrap (the reflow over the row's
 * height) and the double-click's reset (the auto's return). The section's
 * stand over the harness's shared bridge (the panes' parity); the bridge's
 * truth is read over `window.__bridge`.
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

test.beforeEach(async ({ page }) => {
  await page.goto(SECTION_URL);
});

test("the double click over the stretched header's row resets the height (the auto's return)", async ({ page }) => {
  const demo = await demoTable(page);
  await page.locator(`[data-testid='tables-item'][data-table-id='${demo.id}']`).click();
  const table = page.locator("[data-slot='docblocks/database-table']");
  await expect(table).toBeVisible(SETTLE);
  const handle = page.locator("[data-slot='docblocks/database-header-resize']");
  await expect(handle).toBeAttached();
  const header = page.locator("[data-slot='docblocks/database-header-cell']").first();
  const headerBox = (await header.boundingBox())!;

  // The stretch's commit over the drag (the section's value's stand).
  await page.mouse.move(headerBox.x + 20, headerBox.y + headerBox.height - 2);
  await page.mouse.down();
  await page.mouse.move(headerBox.x + 20, headerBox.y + headerBox.height + 40, { steps: 4 });
  await page.mouse.up();
  await expect
    .poll(async () => table.evaluate((element) => element.style.gridTemplateRows), SETTLE)
    .toMatch(/^\d+(?:\.\d+)?px$/);
  await expect.poll(async () => table.getAttribute("data-header-wrap"), SETTLE).toBe("true");

  // The double click over the header's row (the name's zone) stands the
  // reset: the section's value's clear (the display's stand over the
  // local echo until the store's value lands).
  await page.mouse.dblclick(headerBox.x + 20, headerBox.y + 10);
  await expect.poll(async () => table.evaluate((element) => element.style.gridTemplateRows), SETTLE).toBe("auto");
  await expect(table).not.toHaveAttribute("data-header-wrap", SETTLE);
});

test("the stretched header's names stand the wrap (the auto's stand keeps the one-line's ellipsis)", async ({
  page,
}) => {
  const demo = await demoTable(page);
  await page.locator(`[data-testid='tables-item'][data-table-id='${demo.id}']`).click();
  const table = page.locator("[data-slot='docblocks/database-table']");
  await expect(table).toBeVisible(SETTLE);

  // The long name's column (the wrap's subject — the auto's stand truncates
  // it, the stretch's stand reflows it over the row's height).
  await page.evaluate(async (tableId) => {
    const ctx = { operationId: crypto.randomUUID(), issuedAt: new Date().toISOString() };
    await window.__bridge!.createColumn(
      tableId,
      {
        column: {
          name: "A very long column name that must wrap over several lines when the header row is stretched tall",
          type: "text",
          position: 0,
          nullable: true,
        },
      },
      ctx
    );
  }, demo.id);
  const name = page
    .locator("[data-slot='docblocks/database-header-name']")
    .filter({ hasText: "A very long column name" });
  await expect(name.first()).toBeVisible(SETTLE);

  // The auto's stand: the one-line's ellipsis (no wrap's key).
  await expect(table).not.toHaveAttribute("data-header-wrap");
  expect(await name.first().evaluate((element) => getComputedStyle(element).whiteSpace)).toBe("nowrap");

  // The stretch's stand (the drag over the header's bottom edge): the
  // wrap's key + the multi-line's stand (the name's reflow over the row's
  // height, the lines' clip over the under-height's stand).
  const handleBox = (await page.locator("[data-slot='docblocks/database-header-resize']").boundingBox())!;
  await page.mouse.move(handleBox.x + 20, handleBox.y + 3);
  await page.mouse.down();
  await page.mouse.move(handleBox.x + 20, handleBox.y + 130, { steps: 6 });
  await page.mouse.up();
  await expect.poll(async () => table.getAttribute("data-header-wrap"), SETTLE).toBe("true");
  const stretched = await name.first().evaluate((element) => ({
    whiteSpace: getComputedStyle(element).whiteSpace,
    clientHeight: element.clientHeight,
  }));
  expect(stretched.whiteSpace).toBe("normal");
  // The multi-line's stand over the single line's ~25 px (the reflow's
  // visible proof — the full name's reflow over the column's width).
  expect(stretched.clientHeight).toBeGreaterThan(40);
});
