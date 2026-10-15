import { expect, test } from "@playwright/test";

// Its own room: a manually left-over tab must not pollute the sync specs.
const SETTLE = { timeout: 15_000 };

test("the dark theme activates via the .dark class on an ancestor", async ({ page }) => {
  await page.goto(`/?syncUrl=ws://localhost:5199/theme-${Math.random().toString(36).slice(2, 8)}`);
  await expect(page.getByTestId("status-a")).toHaveText("connected", SETTLE);
  // The harness loads dark by default; this spec pins the light seed
  // baseline first, so clear the `.dark` class explicitly.
  await page.evaluate(() => document.documentElement.classList.remove("dark"));
  const editor = page.locator('[data-slot="docblocks/editor"]');
  await expect(editor).toBeVisible();

  // The token resolves to the light standard seed the package ships (the
  // seed section of the shipped styles.css is the unthemed default in this harness).
  const tokenOf = () => editor.evaluate((el) => getComputedStyle(el).getPropertyValue("--docblocks-text-color").trim());
  await expect.poll(tokenOf, SETTLE).toBe("oklch(0.145 0 0)");

  // The class on any ancestor (here: <html>) switches the inherited token
  // set to the shipped dark values — no consumer CSS involved.
  await page.evaluate(() => document.documentElement.classList.add("dark"));
  await expect.poll(tokenOf, SETTLE).toBe("oklch(0.985 0 0)");

  await page.evaluate(() => document.documentElement.classList.remove("dark"));
  await expect.poll(tokenOf, SETTLE).toBe("oklch(0.145 0 0)");
});
