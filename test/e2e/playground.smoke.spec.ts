import { expect, test } from "@playwright/test";

test("playground shell loads", async ({ page }) => {
  // Its own room: a manually left-over tab must not pollute the sync specs.
  await page.goto("/?syncUrl=ws://localhost:5199/smoke");
  await expect(page).toHaveTitle(/docblocks playground/);
  await expect(page.getByTestId("status-a")).toHaveText("connected", { timeout: 15_000 });
});
