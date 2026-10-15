import { expect, test } from "@playwright/test";

// The design system preview (?ds=1, harness-only): the shared/ui primitives
// rendered OUTSIDE any editor root. Pins the compiled utility CSS
// (docblocks-react-ui/ui.css) end to end: the utilities resolve the standard
// tokens at the use site, the dark set flips under the .dark class, and the
// popup content (menu/popover/select) is styled by the utility CSS.
const URL = "/?ds=1";

/** The standard token value the page resolves (the inlined seed, light). */
const tokenOf = (page: import("@playwright/test").Page, name: string) =>
  page.evaluate((n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim(), name);

test("the utility CSS styles the primitives outside the editor root", async ({ page }) => {
  await page.goto(URL);
  await expect(page.getByTestId("ds-btn-default")).toBeVisible();

  // bg-primary resolves the standard token at the use site (the @theme
  // inline mapping — not a baked-in literal).
  const primary = await tokenOf(page, "--primary");
  await expect(page.getByTestId("ds-btn-default")).toHaveCSS("background-color", primary);
  // Ghost carries no background.
  await expect(page.getByTestId("ds-btn-ghost")).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  // The destructive alert: card background + destructive text (the
  // shadcn destructive variant paints the text/icon, not the fill).
  const card = await tokenOf(page, "--card");
  const destructive = await tokenOf(page, "--destructive");
  await expect(page.getByTestId("ds-alert-destructive")).toHaveCSS("background-color", card);
  await expect(page.getByTestId("ds-alert-destructive")).toHaveCSS("color", destructive);
  // The structural pieces render.
  await expect(page.getByTestId("ds-badge")).toBeVisible();
  await expect(page.getByTestId("ds-card")).toBeVisible();
  await expect(page.getByTestId("ds-skeleton")).toBeVisible();
});

test("the .dark class flips the standard token set", async ({ page }) => {
  await page.goto(URL);
  await expect(page.getByTestId("ds-btn-default")).toBeVisible();
  // The harness loads dark by default; clear it so the flip is light -> dark.
  await page.evaluate(() => document.documentElement.classList.remove("dark"));
  const light = await tokenOf(page, "--primary");
  const button = page.getByTestId("ds-btn-default");
  await expect(button).toHaveCSS("background-color", light);

  await page.evaluate(() => document.documentElement.classList.add("dark"));
  const dark = await tokenOf(page, "--primary");
  expect(dark).not.toBe(light);
  await expect(button).toHaveCSS("background-color", dark);

  await page.evaluate(() => document.documentElement.classList.remove("dark"));
  await expect(button).toHaveCSS("background-color", light);
});

test("the popups open over the utility CSS", async ({ page }) => {
  await page.goto(URL);
  await expect(page.getByTestId("ds-menu-trigger")).toBeVisible();

  // DropdownMenu: the content is styled by bg-popover + border.
  await page.getByTestId("ds-menu-trigger").click();
  const menu = page.getByTestId("ds-menu-item");
  await expect(menu).toBeVisible();
  const menuContent = page.locator('[data-slot="dropdown-menu-content"]');
  const popover = await tokenOf(page, "--popover");
  await expect(menuContent).toHaveCSS("background-color", popover);
  await expect(menuContent).toHaveCSS("border-top-width", "1px");
  await page.keyboard.press("Escape");

  // Popover: the content is styled the same way.
  await page.getByTestId("ds-popover-trigger").click();
  const popoverContent = page.locator('[data-slot="popover-content"]');
  await expect(popoverContent).toBeVisible();
  await expect(popoverContent).toHaveCSS("background-color", popover);
  await page.keyboard.press("Escape");

  // Select: the listbox renders the options.
  await page.getByTestId("ds-select-trigger").click();
  const selectContent = page.locator('[data-slot="select-content"]');
  await expect(selectContent).toBeVisible();
  await expect(selectContent).toHaveCSS("background-color", popover);
});
