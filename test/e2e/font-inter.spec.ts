import { type Locator, type Page, expect, test } from "@playwright/test";

import { switchPaneView } from "./helpers";

// The UI default font (2026-10-22): the editor's chrome + the page text render
// in the self-hosted Inter (the @font-face ships it; the fetch is by
// unicode-range). The consumer's `--font-sans` override takes priority (the
// token contract stands). The shape text's own `fontFamily` attr stands over
// the UI default (the shape mechanism is unchanged).
const RELAY = "ws://localhost:5199";

/** The catalog pane (the deterministic doc: page text + the UI chrome). */
async function openCatalogPane(page: Page): Promise<void> {
  const room = `fontui-${Math.random().toString(36).slice(2, 8)}`;
  await page.goto(`/?client=a&catalog=1&syncUrl=${RELAY}/${room}`);
  await expect(page.getByTestId("status-a")).toHaveText("connected");
  // The harness loads dark by default; clear the `.dark` class (a light pin).
  await page.evaluate(() => document.documentElement.classList.remove("dark"));
  await expect(page.locator('hr[data-slot="docblocks/divider"]')).toHaveCount(1);
  // Wait for the self-hosted Inter to resolve so the computed font-family
  // reflects the real font, not the FOUT fallback.
  await page.evaluate(() =>
    Promise.all(["400 16px Inter", "600 16px Inter"].map((font) => document.fonts.load(font))).then(
      () => document.fonts.ready
    )
  );
}

/** The top-level editor root only (the catalog's sync-embed + frame render
 * their own nested editor roots under the doc). */
function editor(page: Page) {
  return page.locator('[data-testid="doc-a"] > [data-slot="card"] > [data-slot="docblocks/editor"]');
}

const fontFamilyOf = (locator: Locator) => locator.evaluate((el) => getComputedStyle(el).fontFamily);

test.describe("the UI default font (the self-hosted Inter)", () => {
  test("the editor's chrome and the page text render in Inter", async ({ page }) => {
    await openCatalogPane(page);

    // The self-hosted Inter is resolved for the UI's 16px regular text.
    const interLoaded = await page.evaluate(() => document.fonts.check("400 16px Inter", "abc"));
    expect(interLoaded).toBe(true);

    // The editor root (the chrome) stands the Inter stack first.
    const rootFamily = await fontFamilyOf(editor(page));
    expect(rootFamily).toContain("Inter");

    // The page text (a paragraph) renders in Inter.
    const paragraph = editor(page).locator('[data-block-type="paragraph"]').first();
    const paragraphFamily = await fontFamilyOf(paragraph);
    expect(paragraphFamily).toContain("Inter");
  });

  test("the consumer's --font-sans override takes priority over the Inter default", async ({ page }) => {
    await openCatalogPane(page);

    // Set the standard token on the editor root (the token contract: the
    // consumer's --font-sans wins over the package's Inter default). The
    // override is a pure CSS stand (no doc write).
    await editor(page).evaluate((el) => (el as HTMLElement).style.setProperty("--font-sans", "Georgia, serif"));
    const family = await editor(page).evaluate((el) => getComputedStyle(el).fontFamily);
    expect(family).toContain("Georgia");
  });
});

test("the shape text's own fontFamily stands over the UI default (the shape mechanism unchanged)", async ({ page }) => {
  const room = `fontshape-${Math.random().toString(36).slice(2, 8)}`;
  await page.goto(`/?client=a&syncUrl=${RELAY}/${room}`);
  await expect(page.getByTestId("status-a")).toHaveText("connected");
  await page.evaluate(() => document.documentElement.classList.remove("dark"));
  await switchPaneView(page, "a", "canvas");
  const view = page.locator('[data-slot="docblocks/canvas-view"]');

  // Seed one shape with its own fontFamily (Lora) + text.
  const id = await page.evaluate(() => {
    const docs = (window as { __paneDocs?: { a?: unknown } }).__paneDocs;
    const doc = docs?.a as {
      toJSON: () => { blocks: Record<string, { type: string }> };
      insertBlock: (t: string, a?: unknown, o?: { parent: string }) => string;
      setGeometry: (id: string, g: unknown) => void;
    };
    const json = doc.toJSON();
    const surfaceId =
      Object.entries(json.blocks).find(([, block]) => block.type === "surface")?.[0] ?? doc.insertBlock("surface");
    const shapeId = doc.insertBlock(
      "shape",
      { variant: "rounded", text: "shape text", fontFamily: "Lora" },
      { parent: surfaceId }
    );
    doc.setGeometry(shapeId, { x: 0, y: 0, w: 200, h: 80 });
    return shapeId;
  });
  // Wait for the shape's Lora face to resolve (the by-unicode-range fetch).
  await page.evaluate(() => document.fonts.load("400 16px Lora").then(() => document.fonts.ready));

  const target = view.locator(
    `[data-slot="docblocks/canvas-item"][data-block-id="${id}"] [data-slot="docblocks/shape-text-target"]`
  );
  await expect(target).toHaveCount(1);
  const family = await fontFamilyOf(target);
  // The shape text stands its own font (Lora), not the UI default (Inter).
  expect(family).toContain("Lora");
  expect(family).not.toContain("Inter");
});
