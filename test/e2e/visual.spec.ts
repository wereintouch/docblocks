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
  await expect(page.getByTestId("status-a")).toHaveText("connected");
  // The catalog is built locally on mount; the divider lands with it. The
  // mermaid block stands in its default code mode (no async diagram render
  // to wait for — the modes are exclusive, the preview render is pinned by
  // the mermaid spec).
  await expect(page.locator('hr[data-slot="docblocks/divider"]')).toHaveCount(1);
  // Wait for the self-hosted UI font (Inter) to resolve: the page text renders
  // in Inter (the UI default font), so the golden must capture the real font,
  // not the FOUT fallback. Load the faces the catalog's text uses (the regular
  // / semibold x the normal / italic styles) and wait for them to settle.
  await page.evaluate(() =>
    Promise.all(
      ["400 16px Inter", "600 16px Inter", "italic 400 16px Inter", "italic 600 16px Inter"].map((font) =>
        document.fonts.load(font)
      )
    ).then(() => document.fonts.ready)
  );
}

/** The pane's editor root — the screenshot scope (the harness chrome stays out). The direct-child scope (through the shared Card frame) keeps the nested editor root (the catalog's sync-embed) out of the match. The element's top edge sits on a subpixel offset (the harness header's height), so a chrome change above the doc area can shift the integer clip height by 1px without any content change — regenerate the goldens in that case. */
function editor(page: Page) {
  return page.locator('[data-testid="doc-a"] > [data-slot="card"] > [data-slot="docblocks/editor"]');
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
  // The harness loads dark by default; the light golden clears the `.dark`
  // class first (the dark shot below re-adds it).
  await page.evaluate(() => document.documentElement.classList.remove("dark"));
  const pane = editor(page);
  await expect(pane).toBeVisible();

  await clearFocus(page);
  await expect(pane).toHaveScreenshot("catalog-light.png");

  // The dark token set activates via the .dark class on <html> (the shadcn
  // convention). The page background is a consumer concern the package
  // stylesheet does not own, so the harness sets a dark canvas for the dark
  // golden; wait for the computed token to flip before shooting (the seed's
  // dark --foreground, which the token follows while the seed is inlined).
  await page.evaluate(() => {
    document.documentElement.classList.add("dark");
    document.body.style.backgroundColor = "#0d1117";
  });
  await expect
    .poll(() => pane.evaluate((el) => getComputedStyle(el).getPropertyValue("--docblocks-text-color").trim()), SETTLE)
    .toBe("oklch(0.985 0 0)");
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
