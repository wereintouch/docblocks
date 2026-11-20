// The canvas's world-space strokes' min-screen stand (the 1/zoom's
// compensation): over the zoom's < 1 the line / the shape's border stands
// at least 1 screen-px wide (the computed stroke's width = the 1/zoom's
// stand over the data's), the zoom's >= 1 stands the data's verbatim. The
// stand reads the world's inverse-zoom's CSS variable (the `max()`'s
// native resolution — the no per-item re-render's stand).
import { type Page, expect, test } from "@playwright/test";

import { canvasView, editorContext, openPane, switchPaneView } from "./helpers";

/** The stroke scene: two rects (the 100px gap) over the connector's line
 * (the line's / the shapes' borders stand the default's widths — the
 * 1px / the 2px's stands). */
async function seedStrokeScene(page: Page): Promise<void> {
  await page.evaluate(() => {
    const doc = window.__paneDocs?.a;
    if (doc === null || doc === undefined) throw new Error("the pane's doc is not mounted");
    doc.transact(() => {
      const surface = doc.insertBlock("surface");
      const a = doc.insertBlock("shape", { variant: "rect" }, { parent: surface });
      doc.setGeometry(a, { x: -100, y: 0, w: 100, h: 60 });
      const b = doc.insertBlock("shape", { variant: "rect" }, { parent: surface });
      doc.setGeometry(b, { x: 100, y: 0, w: 100, h: 60 });
      doc.insertBlock("connector", { start: { blockId: a }, end: { blockId: b } }, { parent: surface });
    });
  });
}

/** The viewport's stored stand (the zoom's 100% / no pan): the entry's
 * fit stands off (the 100% zoom's viewport's stand over the data's
 * verbatim's assert — the fit's zoom over the scene's union would drop
 * the compensation's stand). The harness's pane doc id stands the fixed
 * `d1`. */
async function pinZoom100(page: Page): Promise<void> {
  await page.evaluate(() => {
    const key = "docblocks.canvas-viewport.v1";
    const raw = window.localStorage.getItem(key);
    const map = raw !== null ? JSON.parse(raw) : {};
    map["d1"] = { zoom: 1, pan: { x: 0, y: 0 } };
    window.localStorage.setItem(key, JSON.stringify(map));
  });
}

test("the min-screen stroke's stand (the 1/zoom's compensation over the zoom's < 1)", async ({ browser }) => {
  const context = await editorContext(browser);
  const page = await context.newPage();
  const room = `canvas-stroke-min-${Math.random().toString(36).slice(2, 8)}`;
  try {
    await openPane(page, "a", room);
    await seedStrokeScene(page);
    await pinZoom100(page);
    await switchPaneView(page, "a", "canvas");
    const view = canvasView(page, "a");

    // The zoom's 100%: the data's verbatim (the connector's 1px default,
    // the shape's 2px default).
    await expect(view.locator("[data-connector-id]").first()).toHaveCSS("stroke-width", "1px");
    await expect(view.locator('[data-slot="docblocks/shape"] > g').first()).toHaveCSS("stroke-width", "2px");

    // The zoom out's steps (the 10% grid: 100% → 25% over the 8 steps):
    // the 1/zoom's stand (the 4px over the 1px / the 2px's data).
    const zoomOut = view.getByRole("button", { name: "Zoom out" });
    for (let i = 0; i < 8; i += 1) await zoomOut.click();
    await expect(view.getByRole("button", { name: "Reset zoom" })).toHaveText("25%");
    await expect(view.locator("[data-connector-id]").first()).toHaveCSS("stroke-width", "4px");
    await expect(view.locator('[data-slot="docblocks/shape"] > g').first()).toHaveCSS("stroke-width", "4px");

    // The zoom's reset (the 25% → 100%): the data's verbatim's return
    // (the compensation's stand off).
    await view.getByRole("button", { name: "Reset zoom" }).click();
    await expect(view.getByRole("button", { name: "Reset zoom" })).toHaveText("100%");
    await expect(view.locator("[data-connector-id]").first()).toHaveCSS("stroke-width", "1px");
    await expect(view.locator('[data-slot="docblocks/shape"] > g').first()).toHaveCSS("stroke-width", "2px");
  } finally {
    await context.close();
  }
});
