// The new figure variants over the drag-to-size place: the shift's 1:1
// (the square's stand — the larger span wins, the free's regression, the
// live toggle over the standing drag).
import { type Page, expect, test } from "@playwright/test";

import { SETTLE, canvasCenter, canvasView, toCanvas, twoPanes } from "./helpers";

/** The doc's first shape of the variant's geometry (the center anchor, the canvas px). */
async function shapeGeometry(page: Page, client: "a" | "b", variant: string) {
  return page.evaluate(
    ({ client, variant }) => {
      const doc = window.__paneDocs?.[client];
      if (doc === null || doc === undefined) return null;
      for (const block of Object.values(doc.toJSON().blocks)) {
        const entry = block as {
          type: string;
          attrs?: { variant?: unknown };
          geometry?: { x: number; y: number; w: number; h: number };
        };
        if (entry.type === "shape" && entry.attrs?.variant === variant) return entry.geometry ?? null;
      }
      return null;
    },
    { client, variant }
  );
}

test.describe("the new figure variants", () => {
  test("the shift's 1:1 on the drag-to-size place (the square's stand, the free's regression, the live toggle)", async ({
    browser,
  }) => {
    const { a, b, close } = await twoPanes(browser, "cvs-shape-shift-1to1");
    try {
      await toCanvas(a, "a");
      await toCanvas(b, "b");
      const center = await canvasCenter(a, "a");
      const preview = canvasView(a, "a").locator('[data-slot="docblocks/canvas-place-preview"]');
      const shapes = canvasView(a, "a").getByRole("toolbar", { name: "Canvas tools" }).getByLabel("Shapes");

      // (a) The ellipse's shift drag: the mid-drag preview stands the square
      // (W = H — the larger span wins), the release commits the circle over
      // the wire (both panes stand the same geometry).
      await shapes.click();
      await a.locator('[data-slot="docblocks/canvas-shapes-menu"]').getByLabel("Ellipse", { exact: true }).click();
      await a.keyboard.down("Shift");
      await a.mouse.move(center.x - 100, center.y - 60);
      await a.mouse.down();
      await a.mouse.move(center.x + 100, center.y + 60, { steps: 5 });
      // The mid-drag preview is the square (the constraint's live stand —
      // the larger span's 200 wins over the 120's height).
      await expect
        .poll(async () => {
          const bb = (await preview.boundingBox())!;
          return Math.abs(bb.width - bb.height);
        }, SETTLE)
        .toBeLessThan(2);
      await a.mouse.up();
      await a.keyboard.up("Shift");
      await expect
        .poll(async () => {
          const geo = await shapeGeometry(a, "a", "ellipse");
          return geo !== null && geo.w === 200 && geo.h === 200 && geo.x === 0 && geo.y === 0;
        }, SETTLE)
        .toBe(true);
      await expect
        .poll(async () => {
          const geo = await shapeGeometry(b, "b", "ellipse");
          return geo !== null && geo.w === 200 && geo.h === 200 && geo.x === 0 && geo.y === 0;
        }, SETTLE)
        .toBe(true);
      await expect(preview).toHaveCount(0);

      // (b) The rect's shift drag: the square (the W = H's stand — the
      // vertical span's 160 wins over the 60's width).
      await shapes.click();
      await a.locator('[data-slot="docblocks/canvas-shapes-menu"]').getByLabel("Rectangle", { exact: true }).click();
      await a.keyboard.down("Shift");
      await a.mouse.move(center.x - 80, center.y - 80);
      await a.mouse.down();
      await a.mouse.move(center.x + 80, center.y - 20, { steps: 5 });
      await a.mouse.up();
      await a.keyboard.up("Shift");
      await expect
        .poll(async () => {
          const geo = await shapeGeometry(a, "a", "rect");
          return geo !== null && geo.w === 160 && geo.h === 160 && geo.x === 0 && geo.y === -50;
        }, SETTLE)
        .toBe(true);

      // (c) The free drag (no shift): the W×H stands (the regression — the
      // constraint is off, the dragged box's stand).
      await shapes.click();
      await a
        .locator('[data-slot="docblocks/canvas-shapes-menu"]')
        .getByLabel("Rounded Rectangle", { exact: true })
        .click();
      await a.mouse.move(center.x - 100, center.y - 50);
      await a.mouse.down();
      await a.mouse.move(center.x + 100, center.y + 50, { steps: 5 });
      await expect
        .poll(async () => {
          const bb = (await preview.boundingBox())!;
          return Math.abs(bb.width - bb.height);
        }, SETTLE)
        .toBeGreaterThan(40);
      await a.mouse.up();
      await expect
        .poll(async () => {
          const geo = await shapeGeometry(a, "a", "rounded");
          return geo !== null && geo.w === 200 && geo.h === 100 && geo.x === 0 && geo.y === 0;
        }, SETTLE)
        .toBe(true);

      // (d) The live toggle: the shift's keydown over the standing drag
      // squares the preview (the center stands), the keyup frees it again —
      // the release commits the free box (the shift's drop before the up).
      await canvasView(a, "a").focus();
      await shapes.click();
      await a.locator('[data-slot="docblocks/canvas-shapes-menu"]').getByLabel("Diamond", { exact: true }).click();
      await a.mouse.move(center.x - 100, center.y - 50);
      await a.mouse.down();
      await a.mouse.move(center.x + 100, center.y + 50, { steps: 5 });
      await expect
        .poll(async () => {
          const bb = (await preview.boundingBox())!;
          return Math.abs(bb.width - bb.height);
        }, SETTLE)
        .toBeGreaterThan(40);
      const freeCenter = await preview.evaluate((el) => {
        const r = el.getBoundingClientRect();
        return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
      });
      await a.keyboard.down("Shift");
      // The shift's keydown squares the preview (the live stand — the center
      // stands the drag's midpoint, the size grows to the larger span).
      await expect
        .poll(async () => {
          const bb = (await preview.boundingBox())!;
          return Math.abs(bb.width - bb.height);
        }, SETTLE)
        .toBeLessThan(2);
      const shiftCenter = await preview.evaluate((el) => {
        const r = el.getBoundingClientRect();
        return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
      });
      expect(Math.abs(shiftCenter.x - freeCenter.x)).toBeLessThan(2);
      expect(Math.abs(shiftCenter.y - freeCenter.y)).toBeLessThan(2);
      await a.keyboard.up("Shift");
      await expect
        .poll(async () => {
          const bb = (await preview.boundingBox())!;
          return Math.abs(bb.width - bb.height);
        }, SETTLE)
        .toBeGreaterThan(40);
      await a.mouse.up();
      await expect
        .poll(async () => {
          const geo = await shapeGeometry(a, "a", "diamond");
          return geo !== null && geo.w === 200 && geo.h === 100 && geo.x === 0 && geo.y === 0;
        }, SETTLE)
        .toBe(true);

      // The one-step undo (the diamond's transact) stands the diamond gone
      // over the wire (the others stand).
      await a.keyboard.press("Escape");
      await canvasView(a, "a").focus();
      await a.keyboard.press("Control+z");
      await expect.poll(async () => await shapeGeometry(a, "a", "diamond"), SETTLE).toBeNull();
      expect(await shapeGeometry(a, "a", "ellipse")).not.toBeNull();
    } finally {
      await close();
    }
  });
});
