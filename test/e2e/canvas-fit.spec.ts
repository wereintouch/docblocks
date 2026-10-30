// The canvas fit button: the content's union
// box (the page miniature + the surface items + the connector's free
// points) centered at the viewport's center at the smallest fitting zoom —
// every item stands in the viewport after the fit, the zoom / pan stand the
// view state only (the doc stands), the empty canvas stands the no-op, and
// the reset / the steps stand over the fit's stand.
import { type Page, expect, test } from "@playwright/test";

import { canvasView, openPane, toCanvas } from "./helpers";

/** Switch the pane to the canvas view (the harness's view toggle). */

/** The canvas-view container (the viewport's chrome root). */

/** The zoom toolbar (scoped to the pane's canvas view). */
const zoomToolbar = (page: Page, client: "a" | "b") =>
  canvasView(page, client).getByRole("toolbar", { name: "Canvas zoom" });

/** The world transform (the zoom / pan's stand, the style string). */
const worldTransform = async (page: Page, client: "a" | "b"): Promise<string> =>
  canvasView(page, client)
    .locator('[data-slot="docblocks/canvas-world"]')
    .evaluate((el) => el.style.transform);

/** The zoom label (the "Reset zoom" button's text). */
const zoomPercent = (page: Page, client: "a" | "b") => zoomToolbar(page, client).getByLabel("Reset zoom");

/** The seed's scattered scene: one surface with two shapes + a connector
 * with a free endpoint (the doc's own command API over the harness global). */
async function seedScene(page: Page): Promise<void> {
  await page.evaluate(() => {
    const doc = window.__paneDocs?.a;
    if (doc === null || doc === undefined) throw new Error("the pane's doc is not mounted");
    doc.transact(() => {
      const surface = doc.insertBlock("surface");
      const a = doc.insertBlock("shape", { variant: "rect" }, { parent: surface });
      doc.setGeometry(a, { x: 600, y: -400, w: 100, h: 80 });
      const b = doc.insertBlock("shape", { variant: "ellipse" }, { parent: surface });
      doc.setGeometry(b, { x: -500, y: 300, w: 60, h: 40 });
      doc.insertBlock("connector", { start: { blockId: a }, end: { x: -900, y: 0 } }, { parent: surface });
    });
  });
  await expect(page.locator(`[data-testid="doc-a"] [data-slot="docblocks/canvas-item"]`)).toHaveCount(3);
}

test.describe("the canvas fit button", () => {
  test("frames the content at the fit's zoom (every item stands in the viewport)", async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    const room = `canvas-fit-${Math.random().toString(36).slice(2, 8)}`;
    try {
      await openPane(page, "a", room);
      await toCanvas(page, "a");
      await seedScene(page);

      const jsonBefore = await page.evaluate(() => window.__paneDocs?.a?.toJSON());

      // The zoomed-in stand: the content stands over the viewport's edge.
      for (let i = 0; i < 4; i += 1) {
        await zoomToolbar(page, "a").getByLabel("Zoom in").click();
      }
      expect(await zoomPercent(page, "a").textContent()).toBe("140%");

      await zoomToolbar(page, "a").getByLabel("Fit to screen").click();

      // The zoom stands the fit's stand (a new value in the 25%–400% band).
      const label = Number((await zoomPercent(page, "a").textContent())!.replace("%", ""));
      expect(label).not.toBe(140);
      expect(label).toBeGreaterThanOrEqual(25);
      expect(label).toBeLessThanOrEqual(400);

      // Every canvas item and the page card stand in the viewport (the
      // union's screen box maps into the viewport; the 3px epsilon stands
      // the two-decimal pan round).
      const view = (await canvasView(page, "a").boundingBox())!;
      const inside = (
        box: { x: number; y: number; width: number; height: number },
        outer: { x: number; y: number; width: number; height: number },
        epsilon = 3
      ) =>
        box.x >= outer.x - epsilon &&
        box.y >= outer.y - epsilon &&
        box.x + box.width <= outer.x + outer.width + epsilon &&
        box.y + box.height <= outer.y + outer.height + epsilon;
      const items = page.locator(`[data-testid="doc-a"] [data-slot="docblocks/canvas-item"]`);
      const count = await items.count();
      expect(count).toBe(3);
      for (let i = 0; i < count; i += 1) {
        const box = (await items.nth(i).boundingBox())!;
        expect(inside(box, view), `the canvas item ${i} stands over the viewport`).toBe(true);
      }
      const card = (await canvasView(page, "a").locator('[data-slot="docblocks/page-card"]').boundingBox())!;
      expect(inside(card, view), "the page card stands over the viewport").toBe(true);

      // The fit stands the view state only: the doc stands.
      const jsonAfter = await page.evaluate(() => window.__paneDocs?.a?.toJSON());
      expect(jsonAfter).toEqual(jsonBefore);

      // The reset / the steps stand over the fit's stand (the continuous
      // fit's zoom is not a stop — the step's contract stands over the
      // stop grid: the reset's stand and the 10% steps' parity).
      await zoomToolbar(page, "a").getByLabel("Reset zoom").click();
      expect(await zoomPercent(page, "a").textContent()).toBe("100%");
      await zoomToolbar(page, "a").getByLabel("Zoom in").click();
      expect(await zoomPercent(page, "a").textContent()).toBe("110%");
      await zoomToolbar(page, "a").getByLabel("Zoom out").click();
      expect(await zoomPercent(page, "a").textContent()).toBe("100%");
    } finally {
      await context.close();
    }
  });

  test("stands the no-op over the empty canvas (the zoom and the pan keep)", async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    const room = `canvas-fit-empty-${Math.random().toString(36).slice(2, 8)}`;
    try {
      await openPane(page, "a", room);
      await toCanvas(page, "a");
      // The canvas stands the page miniature only (no surface content).
      await expect(page.locator(`[data-testid="doc-a"] [data-slot="docblocks/canvas-item"]`)).toHaveCount(0);

      // A non-default stand (the zoom over the no-op's target).
      await zoomToolbar(page, "a").getByLabel("Zoom in").click();
      await zoomToolbar(page, "a").getByLabel("Zoom in").click();
      expect(await zoomPercent(page, "a").textContent()).toBe("120%");
      const transformBefore = await worldTransform(page, "a");

      const jsonBefore = await page.evaluate(() => window.__paneDocs?.a?.toJSON());
      await zoomToolbar(page, "a").getByLabel("Fit to screen").click();

      // The no-op: the zoom / pan stand, the doc stands.
      expect(await zoomPercent(page, "a").textContent()).toBe("120%");
      expect(await worldTransform(page, "a")).toBe(transformBefore);
      const jsonAfter = await page.evaluate(() => window.__paneDocs?.a?.toJSON());
      expect(jsonAfter).toEqual(jsonBefore);
    } finally {
      await context.close();
    }
  });
});
