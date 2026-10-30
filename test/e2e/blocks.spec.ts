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
  await expect(doc.locator('hr[data-slot="docblocks/divider"]')).toHaveCount(1);
  const img = doc.locator('img[data-slot="docblocks/image"]');
  await expect(img).toHaveCount(1);
  expect(await img.getAttribute("src")).toContain("data:image/svg+xml");
  await expect(img).toBeVisible();

  await close();
});
