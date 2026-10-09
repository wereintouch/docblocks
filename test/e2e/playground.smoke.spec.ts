import { expect, test } from "@playwright/test";

test("playground shell loads", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle(/docblocks playground/);
});
