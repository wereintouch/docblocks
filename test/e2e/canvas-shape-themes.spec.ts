// The figure's themes' stand (the render-time's fill / text's transform):
// the dark theme's light fixed fill stands the darkened's value (the SVG's
// `fill` attr's stand — the data stands the source hex, no wire's write),
// the light theme's verbatim (the fidelity's stand), the explicit
// `textColor`'s data's stand over the contrast's resolution; the flip's
// re-render (the class's stand). The harness loads dark by default (the
// `light: true`'s option's clear stand — the flip's parity).
import { type Page, expect, test } from "@playwright/test";

import { canvasView, toCanvas, twoPanes } from "./helpers";

/** The themes' scene: the light fill + the dark fill (the explicit's
 * textColor's stand) + the token's fill + the dark fill's textless (the
 * contrast's stand's no-override's pin). */
async function seedThemesScene(page: Page): Promise<void> {
  await page.evaluate(() => {
    const doc = window.__paneDocs?.a;
    if (doc === null || doc === undefined) throw new Error("the pane's doc is not mounted");
    doc.transact(() => {
      const surface = doc.insertBlock("surface");
      const light = doc.insertBlock(
        "shape",
        { variant: "rect", fill: "#dae8fc", text: "light" },
        {
          parent: surface,
        }
      );
      doc.setGeometry(light, { x: -240, y: -40, w: 160, h: 80 });
      const dark = doc.insertBlock(
        "shape",
        { variant: "rect", fill: "#1a1a1a", text: "dark", textColor: "#ff0000" },
        { parent: surface }
      );
      doc.setGeometry(dark, { x: 40, y: -40, w: 160, h: 80 });
      const token = doc.insertBlock(
        "shape",
        { variant: "rect", fill: "var(--docblocks-palette-blue)" },
        {
          parent: surface,
        }
      );
      doc.setGeometry(token, { x: -240, y: 80, w: 120, h: 60 });
    });
  });
}

/** The doc's shapes' fill / text-attr stand (the data's stand — the
 * no-write's pin over the flip). */
async function shapesDataOf(page: Page): Promise<string> {
  return page.evaluate(() => {
    const doc = window.__paneDocs?.a;
    if (doc === null || doc === undefined) throw new Error("the pane's doc is not mounted");
    const out: Record<string, unknown> = {};
    for (const [id, block] of Object.entries(doc.toJSON().blocks)) {
      const entry = block as { type: string; attrs?: { fill?: unknown; textColor?: unknown; text?: unknown } };
      if (entry.type === "shape") {
        out[id] = { fill: entry.attrs?.fill, textColor: entry.attrs?.textColor, text: entry.attrs?.text };
      }
    }
    return JSON.stringify(out);
  });
}

/** The shape's item by its text's overlay (the `text`'s attr's stand —
 * the text's locator's first's stand: the page's mini-card's nested copy
 * stands no text over the canvas's zoom-less stand). */
function shapeByText(page: Page, client: "a" | "b", text: string) {
  return page
    .locator(`[data-testid="doc-${client}"] [data-slot="docblocks/shape-text"]`, { hasText: text })
    .first()
    .locator("xpath=ancestor::div[contains(@data-slot, 'docblocks/canvas-item')]");
}

/** The shape's SVG's `g`'s fill attr (the effective fill's stand). */
async function fillOf(shape: ReturnType<typeof shapeByText>): Promise<string | null> {
  return shape.locator("g").first().getAttribute("fill");
}

/** The shape's text's computed color (the effective contrast's stand — the
 * wrapper div's inline stand over the no-explicit's textColor). */
async function textColorOf(shape: ReturnType<typeof shapeByText>): Promise<string> {
  const wrapper = shape.locator('[data-slot="docblocks/shape-text-target"]');
  return wrapper.evaluate((el) => getComputedStyle(el).color);
}

async function setTheme(page: Page, dark: boolean): Promise<void> {
  await page.evaluate((d) => {
    if (d) document.documentElement.classList.add("dark");
    else document.documentElement.classList.remove("dark");
  }, dark);
}

test.describe("the figure's themes' stand (the render-time's fill / text's transform)", () => {
  test("the dark's darkened + the light's verbatim + the flip's re-render (the no-data's stand)", async ({
    browser,
  }) => {
    const { a, close } = await twoPanes(browser, "cvs-shape-themes");
    try {
      await toCanvas(a, "a");
      await seedThemesScene(a);

      // The dark's stand (the harness's default — the `dark`'s class over
      // the html).
      await expect(canvasView(a, "a").locator('[data-slot="docblocks/canvas-item"]')).toHaveCount(3);

      const light = shapeByText(a, "a", "light");
      const dark = shapeByText(a, "a", "dark");
      const token = canvasView(a, "a").locator('[data-slot="docblocks/canvas-item"]').nth(2);

      // The light fill's darkened's stand: not the source's hex, the
      // 6-digit's, the dark's (the luminance's under).
      const lightFill = (await fillOf(light))!;
      expect(lightFill).not.toBe("#dae8fc");
      expect(lightFill).toMatch(/^#[0-9a-f]{6}$/);
      expect(Number.parseInt(lightFill.slice(1, 3), 16)).toBeLessThan(100);
      // The white's text over the effective (darkened's) fill.
      expect(await textColorOf(light)).toBe("rgb(255, 255, 255)");

      // The dark's fill stands pass-through + the explicit's textColor's
      // data's stand (over the contrast's resolution).
      expect(await fillOf(dark)).toBe("#1a1a1a");
      expect(await textColorOf(dark)).toBe("rgb(255, 0, 0)");

      // The token's fill stands verbatim (the adaptive's stand on its own).
      expect(await fillOf(token)).toBe("var(--docblocks-palette-blue)");

      // The data's stand before the flip (the no-write's pin).
      const before = await shapesDataOf(a);

      // The flip to the light (the class's stand — the re-render).
      await setTheme(a, false);
      expect(await fillOf(light)).toBe("#dae8fc");
      // The light theme's contrast over the light fill: the black (the
      // foreground's parity).
      expect(await textColorOf(light)).toBe("rgb(0, 0, 0)");
      expect(await fillOf(dark)).toBe("#1a1a1a");
      expect(await textColorOf(dark)).toBe("rgb(255, 0, 0)");

      // The back's flip (the darkened's stand).
      await setTheme(a, true);
      expect(await fillOf(light)).not.toBe("#dae8fc");
      expect(await textColorOf(light)).toBe("rgb(255, 255, 255)");

      // The data's stand (no CRDT's write, no wire, no persistence).
      expect(await shapesDataOf(a)).toBe(before);
    } finally {
      await close();
    }
  });
});
