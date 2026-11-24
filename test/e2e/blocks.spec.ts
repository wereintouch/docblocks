import { type Page, expect, test } from "@playwright/test";

import { SETTLE, insertBlockType, twoPanes } from "./helpers";

/** Insert one v1 type at the root through the pane's harness control. */
async function insertType(page: Page, client: "a" | "b", type: string): Promise<void> {
  await insertBlockType(page, client, type);
}

test("structurally inserted blocks render in the other pane", async ({ browser }) => {
  const { a, b, close } = await twoPanes(browser, "ui03a-blocks", { light: true });

  await insertType(a, "a", "code");
  await insertType(a, "a", "table");
  await insertType(a, "a", "divider");
  await insertType(a, "a", "image");

  const doc = b.locator('[data-testid="doc-b"]');

  // Code: a <pre> with a mono inner content (the preflight makes pre mono
  // on its own — the pin reads the content element the class lands on).
  const pre = doc.locator('pre[data-block-type="code"]');
  await expect(pre).toHaveCount(1);
  const codeContent = pre.first().locator('[data-slot="docblocks/block-content"]');
  await expect
    .poll(async () => codeContent.evaluate((el) => getComputedStyle(el).fontFamily), SETTLE)
    .toContain("mono");

  // Table: 2 rows x 2 cells; the cell border comes from the token (the
  // inlined standard seed is the harness default — the seeded border value).
  const cells = doc.locator("td[data-slot='docblocks/table-cell']");
  await expect(cells).toHaveCount(4);
  await expect(doc.locator("tr")).toHaveCount(2);
  await expect
    .poll(async () => cells.first().evaluate((el) => getComputedStyle(el).borderTopColor), SETTLE)
    .toBe("oklch(0.922 0 0)");

  // Divider and image (the src resolved from the harness's blob map).
  await expect(doc.locator('[data-slot="docblocks/divider"]')).toHaveCount(1);
  const img = doc.locator('img[data-slot="docblocks/image"]');
  await expect(img).toHaveCount(1);
  expect(await img.getAttribute("src")).toMatch(/^blob:/);
  await expect(img).toBeVisible();

  await close();
});

test("the divider's row stands the line over the row's center (the gutter controls on the line's axis)", async ({
  browser,
}) => {
  const { a, close } = await twoPanes(browser, "divider-row-geometry");

  const dividerId = await insertBlockType(a, "a", "divider");
  const row = a.locator(`[data-slot="docblocks/row"]:has([data-block-id="${dividerId}"])`);

  const geometryOf = () =>
    row.evaluate((el) => {
      const box = el.querySelector('[data-slot="docblocks/divider"]');
      if (box === null) return null;
      const line = box.querySelector("hr");
      const grip = el.querySelector('button[data-slot="docblocks/gutter"]');
      const remove = el.querySelector('button[data-slot="docblocks/gutter-delete"]');
      if (line === null || grip === null || remove === null) return null;
      const center = (rect: DOMRect) => rect.top + rect.height / 2;
      const rowRect = el.getBoundingClientRect();
      return {
        rowHeight: rowRect.height,
        rowCenter: center(rowRect),
        lineCenter: center(line.getBoundingClientRect()),
        gripCenter: center(grip.getBoundingClientRect()),
        removeCenter: center(remove.getBoundingClientRect()),
      };
    });

  // The row's box is the divider's box (the hover zone's stand — no
  // collapse over the 1px line).
  await expect.poll(async () => (await geometryOf().catch(() => null))?.rowHeight ?? 0, SETTLE).toBeCloseTo(41, 0);

  const geometry = await geometryOf();
  if (geometry === null) throw new Error("the divider's row has no geometry");
  // The line over the row's center (the box's min-height's stand).
  expect(Math.abs(geometry.lineCenter - geometry.rowCenter)).toBeLessThan(0.5);
  // The gutter's controls on the line's axis.
  expect(Math.abs(geometry.gripCenter - geometry.lineCenter)).toBeLessThan(0.5);
  expect(Math.abs(geometry.removeCenter - geometry.lineCenter)).toBeLessThan(0.5);

  await close();
});
