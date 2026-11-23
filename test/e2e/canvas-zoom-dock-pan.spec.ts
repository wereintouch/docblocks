// The canvas pan's stands: the select mode's wheel's pan (the 1:1 screen px,
// the shift's horizontal only, the pinch's continuous zoom at the cursor) and
// the hand mode's drag (the view state, no data write, the lost release's
// contract, the grab over the page miniature's text).
import { type Page, expect, test } from "@playwright/test";

import { blockShapes, canvasCenter, canvasView, seedShape, toCanvas, twoPanes } from "./helpers";

// The two-pane's settle stands the default 30s budget at its edge (the 15s
// SETTLE's panes + the page loads): the raised budget keeps the timeout
// class out of the loaded machine's flake zone (a true stall stays visible).
test.setTimeout(45_000);

/** Switch the pane to the canvas view (the harness's view toggle). */

/** The canvas-view container (the viewport's chrome root). */

/** The world wrapper (the zoom/pan transform carrier). */
const world = (page: Page, client: "a" | "b") =>
  canvasView(page, client).locator('[data-slot="docblocks/canvas-world"]');

/** The zoom toolbar (scoped to the pane's canvas view). */
const zoomToolbar = (page: Page, client: "a" | "b") =>
  canvasView(page, client).getByRole("toolbar", { name: "Canvas zoom" });

/** The dock (scoped to the pane's canvas view). */
const dock = (page: Page, client: "a" | "b") => canvasView(page, client).getByRole("toolbar", { name: "Canvas tools" });

/** The canvas-view center in page coordinates. */

/** The world wrapper's transform (the scale + the pan in px, from the computed matrix). */
async function worldTransform(page: Page, client: "a" | "b"): Promise<{ scale: number; tx: number; ty: number }> {
  const transform = await world(page, client).evaluate((el) => getComputedStyle(el).transform);
  if (transform === "none") return { scale: 1, tx: 0, ty: 0 };
  const match = transform.match(/matrix\(([-\d.]+), ([-\d.]+), ([-\d.]+), ([-\d.]+), ([-\d.]+), ([-\d.]+)\)/);
  if (match === null) throw new Error(`unparseable world transform: ${transform}`);
  return { scale: parseFloat(match[1]!), tx: parseFloat(match[5]!), ty: parseFloat(match[6]!) };
}

/** Seed one canvas shape on the pane's doc (the first surface, created when absent). */

/** The pane's doc JSON blocks (the type + the geometry per id). */

test.describe("the wheel's gesture", () => {
  test("the select mode: the wheel pans the canvas (the 1:1 screen px, the doc stands)", async ({ browser }) => {
    const { a, close } = await twoPanes(browser, "canvas-wheel-pan");
    try {
      await toCanvas(a, "a");
      const id = await seedShape(a, "a", { variant: "rect" }, { x: 0, y: 0, w: 120, h: 80 });
      expect(id).toBeTruthy();

      const cursor = await canvasCenter(a, "a");
      await a.mouse.move(cursor.x, cursor.y);
      const before = await worldTransform(a, "a");
      expect(before.scale).toBe(1);

      // The vertical notch: the content stands 1:1 against the delta's
      // direction (the inversion — the wheel down stands the
      // canvas up), no zoom (the pan moves).
      await a.mouse.wheel(0, 120);
      let after = await worldTransform(a, "a");
      expect(after.scale).toBe(1);
      expect(before.ty - after.ty).toBeCloseTo(120, 1);
      expect(Math.abs(after.tx - before.tx)).toBeLessThan(1);

      // The two-axis swipe: both axes (inverted).
      await a.mouse.wheel(80, 40);
      after = await worldTransform(a, "a");
      expect(before.ty - after.ty).toBeCloseTo(160, 1);
      expect(before.tx - after.tx).toBeCloseTo(80, 1);

      // The doc stands (the pan is the view state).
      const shapes = await blockShapes(a, "a");
      expect(shapes[id]?.geometry).toEqual({ x: 0, y: 0, w: 120, h: 80 });
    } finally {
      await close();
    }
  });

  test("the select mode: the shift's wheel pans horizontal only", async ({ browser }) => {
    const { a, close } = await twoPanes(browser, "canvas-wheel-shift-pan");
    try {
      await toCanvas(a, "a");
      const id = await seedShape(a, "a", { variant: "rect" }, { x: 0, y: 0, w: 120, h: 80 });
      expect(id).toBeTruthy();

      const cursor = await canvasCenter(a, "a");
      await a.mouse.move(cursor.x, cursor.y);
      const before = await worldTransform(a, "a");

      await a.keyboard.down("Shift");
      await a.mouse.wheel(0, 120);
      await a.keyboard.up("Shift");
      const after = await worldTransform(a, "a");
      expect(after.scale).toBe(1);
      // The horizontal axis stands the delta (the browser's mapped wheel
      // or the unconverted notch's fallback — the same 120 px, inverted).
      expect(before.tx - after.tx).toBeCloseTo(120, 1);
      expect(Math.abs(after.ty - before.ty)).toBeLessThan(1);

      const shapes = await blockShapes(a, "a");
      expect(shapes[id]?.geometry).toEqual({ x: 0, y: 0, w: 120, h: 80 });
    } finally {
      await close();
    }
  });

  test("the pinch (ctrl+wheel) zooms at the cursor in the select mode (the point stands fixed)", async ({
    browser,
  }) => {
    const { a, close } = await twoPanes(browser, "canvas-wheel-pinch");
    try {
      await toCanvas(a, "a");
      const id = await seedShape(a, "a", { variant: "rect" }, { x: 0, y: 0, w: 120, h: 80 });
      expect(id).toBeTruthy();

      // The shape's on-screen center at the 100% zoom.
      const wrapper = a.locator(`[data-testid="doc-a"] [data-slot="docblocks/canvas-item"][data-block-id="${id}"]`);
      const before = (await wrapper.boundingBox())!;
      const center = { x: before.x + before.width / 2, y: before.y + before.height / 2 };
      await a.mouse.move(center.x, center.y);

      // The pinch's notch: the zoom stands the CONTINUOUS scale (1 →
      // exp(0.005 * 120) ≈ 1.8221 — the smooth stand, no step) and the
      // shape's screen center stands fixed (the pan compensates the zoom).
      await a.keyboard.down("Control");
      await a.mouse.wheel(0, -120);
      await a.keyboard.up("Control");
      const after = (await wrapper.boundingBox())!;
      const zoom = await worldTransform(a, "a");
      expect(zoom.scale).toBeCloseTo(1.8221, 3);
      expect(await zoomToolbar(a, "a").getByLabel("Reset zoom").textContent()).toBe("182%");
      expect(Math.abs(after.x + after.width / 2 - center.x)).toBeLessThanOrEqual(2);
      expect(Math.abs(after.y + after.height / 2 - center.y)).toBeLessThanOrEqual(2);

      // The doc stands (the zoom is the view state).
      const shapes = await blockShapes(a, "a");
      expect(shapes[id]?.geometry).toEqual({ x: 0, y: 0, w: 120, h: 80 });
    } finally {
      await close();
    }
  });
});

test.describe("the canvas pan", () => {
  test("the hand mode drags the canvas (view state, no data write)", async ({ browser }) => {
    const { a, close } = await twoPanes(browser, "canvas-pan");
    try {
      await toCanvas(a, "a");
      const before = await blockShapes(a, "a");
      const center = await canvasCenter(a, "a");

      // The hand toggle (the dock's first button).
      await dock(a, "a").getByLabel("Switch to the pan mode").click();
      expect(await dock(a, "a").getByLabel("Switch to the select mode").getAttribute("aria-pressed")).toBe("true");

      // Drag from the page miniature's empty lower area (outside the
      // dock's band, not an editing surface): a +120/+50 screen delta.
      await a.mouse.move(center.x - 200, center.y + 100);
      await a.mouse.down();
      await a.mouse.move(center.x - 80, center.y + 150, { steps: 5 });
      await a.mouse.up();
      const moved = await worldTransform(a, "a");
      expect(moved.tx).toBeCloseTo(120);
      expect(moved.ty).toBeCloseTo(50);
      expect(moved.scale).toBe(1);

      // The pan is view state: the doc stands untouched.
      expect(await blockShapes(a, "a")).toEqual(before);
    } finally {
      await close();
    }
  });

  test("the plain moves never chase the world (the lost release's contract)", async ({ browser }) => {
    const { a, close } = await twoPanes(browser, "canvas-pan-stale");
    try {
      await toCanvas(a, "a");
      const center = await canvasCenter(a, "a");
      await dock(a, "a").getByLabel("Switch to the pan mode").click();

      // The pan drag (a +100/+40 delta), then the lost release: the
      // synthetic lostpointercapture (a real mouse drops the capture
      // without a pointerup when the pointer leaves the window — the
      // headless mouse stands the button, so this is the browser pin
      // of the plain-moves contract; the gate's stale drop is
      // unit-pinned over the button-less move).
      await a.mouse.move(center.x + 250, center.y + 200);
      await a.mouse.down();
      await a.mouse.move(center.x + 150, center.y + 160, { steps: 5 });
      await a.evaluate(() => {
        const view = document.querySelector('[data-testid="doc-a"] [data-slot="docblocks/canvas-view"]');
        view?.dispatchEvent(new Event("lostpointercapture"));
      });
      const panned = await worldTransform(a, "a");
      await a.mouse.up();
      await a.mouse.move(center.x, center.y, { steps: 3 });

      // The button-less moves stand the world (the stale session is
      // dropped — the world must not chase the cursor).
      await a.mouse.move(center.x + 80, center.y + 40, { steps: 4 });
      const after = await worldTransform(a, "a");
      expect(after.tx).toBeCloseTo(panned.tx);
      expect(after.ty).toBeCloseTo(panned.ty);
      await a.mouse.move(center.x + 200, center.y + 120, { steps: 4 });
      const after2 = await worldTransform(a, "a");
      expect(after2.tx).toBeCloseTo(panned.tx);
      expect(after2.ty).toBeCloseTo(panned.ty);
    } finally {
      await close();
    }
  });

  test("the hand pans from the page miniature's text (no caret, no text selection)", async ({ browser }) => {
    const { a, close } = await twoPanes(browser, "canvas-pan-text");
    try {
      await toCanvas(a, "a");
      const center = await canvasCenter(a, "a");
      // The 25% zoom: the page miniature's text stands on screen (at
      // 100% the page's top stands above the viewport). The 10% step's
      // eight outs stand the 25% floor.
      for (let i = 0; i < 8; i += 1) await zoomToolbar(a, "a").getByLabel("Zoom out").click();
      await a.waitForTimeout(300);
      await dock(a, "a").getByLabel("Switch to the pan mode").click();

      // The grab stands on the page miniature's text (the starter
      // paragraph's editable): the hand's contract — a grab anywhere
      // pans (the press is prevented: no caret, no text selection).
      const text = a.locator(
        '[data-testid="doc-a"] [data-slot="docblocks/page-card"] [data-slot="docblocks/block-content"]'
      );
      const box = (await text.boundingBox())!;
      await a.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await a.mouse.down();
      await a.mouse.move(center.x + 150, center.y + 120, { steps: 5 });
      await a.mouse.up();
      const moved = await worldTransform(a, "a");
      expect(Math.abs(moved.tx) + Math.abs(moved.ty)).toBeGreaterThan(30);
      // No text selection stood on the surface (the drag was the pan).
      expect(await a.evaluate(() => window.getSelection()?.type)).not.toBe("Range");
    } finally {
      await close();
    }
  });
});
