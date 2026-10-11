import { type Page, expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// The catalog pane: ?catalog=1 makes the pane build the deterministic v1
// catalog document (apps/playground/src/catalog.ts) instead of the empty
// seed. A unique room per test: the relay keeps rooms for the dev server's
// lifetime, so a shared room would be polluted by other specs.
const RELAY = "ws://localhost:5199";
const SETTLE = { timeout: 15_000 };
const GOLDEN = fileURLToPath(new URL("./fixtures/catalog.json", import.meta.url));

async function openCatalogPane(page: Page): Promise<void> {
  const room = `vreg01-${Math.random().toString(36).slice(2, 8)}`;
  await page.goto(`/?client=a&catalog=1&syncUrl=${RELAY}/${room}`);
  await expect(page.getByTestId("status-a")).toHaveText("connected", SETTLE);
  // The catalog is built locally on mount; the divider lands with it.
  await expect(page.locator('hr[data-slot="docblocks/divider"]')).toHaveCount(1, SETTLE);
  // The mermaid catalog block renders asynchronously (mermaid.render); the
  // goldens must capture the diagram, not the loading placeholder.
  await expect(page.locator('[data-slot="docblocks/mermaid"] svg'), SETTLE).toHaveCount(1);
}

/** The pane's editor root — the screenshot scope (the harness chrome stays out). The direct-child scope keeps the nested editor root (the catalog's sync-embed) out of the match. */
function editor(page: Page) {
  return page.locator('[data-testid="doc-a"] > [data-slot="docblocks/editor"]');
}

/** No caret in the golden: blur the focus and clear the DOM selection. */
async function clearFocus(page: Page): Promise<void> {
  await page.evaluate(() => {
    const active = document.activeElement;
    if (active instanceof HTMLElement) active.blur();
    window.getSelection()?.removeAllRanges();
  });
}

test("the catalog renders the light and dark goldens", async ({ page }) => {
  await openCatalogPane(page);
  const pane = editor(page);
  await expect(pane).toBeVisible();

  await clearFocus(page);
  await expect(pane).toHaveScreenshot("catalog-light.png");

  // The dark token set activates via the .dark class on <html> (the shadcn
  // convention). The page background is a consumer concern the package
  // stylesheet does not own, so the harness sets a dark canvas for the dark
  // golden; wait for the computed token to flip before shooting.
  await page.evaluate(() => {
    document.documentElement.classList.add("dark");
    document.body.style.backgroundColor = "#0d1117";
  });
  await expect
    .poll(() => pane.evaluate((el) => getComputedStyle(el).getPropertyValue("--docblocks-text-color").trim()), SETTLE)
    .toBe("#e6edf3");
  await clearFocus(page);
  await expect(pane).toHaveScreenshot("catalog-dark.png");
});

test("the catalog's toJSON matches the committed golden", async ({ page }) => {
  await openCatalogPane(page);
  // The harness-only global: the catalog pane exposes its live doc (see
  // catalog.ts) so the snapshot is read precisely — the JSON inspector text
  // is a human view.
  const json = await page.evaluate(() => window.__catalogDoc?.toJSON() ?? null);
  expect(json).not.toBeNull();
  // Deep equality on the full JSON: the deterministic block ids (catalog.ts)
  // keep it stable across runs, so no id normalization is needed.
  expect(json).toEqual(JSON.parse(readFileSync(GOLDEN, "utf8")));
});
