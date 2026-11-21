import { type Page, expect, test } from "@playwright/test";

import { SETTLE, blockShapes, canvasCenter, canvasView, seedShape, toCanvas, twoPanes } from "./helpers";

// The two-pane's settle stands the default 30s budget at its edge (the 15s
// SETTLE's panes + the page loads): the raised budget keeps the timeout
// class out of the loaded machine's flake zone (a true stall stays visible).
test.setTimeout(45_000);

/** Switch the pane to the canvas view (the harness's view toggle). */

/** The canvas-view container (the viewport's chrome root). */

/** The dock (scoped to the pane's canvas view). */
const dock = (page: Page, client: "a" | "b") => canvasView(page, client).getByRole("toolbar", { name: "Canvas tools" });

/** The canvas-view center in page coordinates. */

/** Seed one canvas shape on the pane's doc (the first surface, created when absent). */

/** The shape ids on the pane's live doc. */
async function shapeIds(page: Page, client: "a" | "b"): Promise<string[]> {
  return page.evaluate(
    ({ client }) => {
      const docs = window.__paneDocs;
      const doc = (client === "a" ? docs?.a : docs?.b) ?? null;
      if (doc === null) return [];
      const json = doc.toJSON();
      return Object.entries(json.blocks)
        .filter(([, block]) => block.type === "shape")
        .map(([id]) => id);
    },
    { client }
  );
}

/** The pane's doc JSON blocks (the type + the geometry per id). */

test.describe("the canvas dock", () => {
  test("the click-to-place lands the block at the click point and resets the tool", async ({ browser }) => {
    const { a, b, close } = await twoPanes(browser, "canvas-dock-place");
    try {
      await toCanvas(a, "a");
      await toCanvas(b, "b");
      const center = await canvasCenter(a, "a");

      // The shape tools are picked through the dock's shapes menu.
      const shapes = dock(a, "a").getByLabel("Shapes");
      await shapes.click();
      const menu = a.locator('[data-slot="docblocks/canvas-shapes-menu"]');
      await expect(menu).toBeVisible();
      expect(await menu.getAttribute("class")).toContain("flex flex-row");
      await menu.getByLabel("Rectangle", { exact: true }).click();
      expect(await shapes.getAttribute("aria-pressed")).toBe("true");
      expect((await canvasView(a, "a").getAttribute("class")) ?? "").toContain("cursor-crosshair");

      // The click lands the shape at the canvas center (zoom 1, pan 0:
      // the screen point IS the canvas point).
      await a.mouse.click(center.x, center.y);
      const blocks = await blockShapes(a, "a");
      const placed = Object.entries(blocks).find(([, block]) => block.type === "shape");
      expect(placed).toBeDefined();
      const geometry = placed![1].geometry as { x: number; y: number; w: number; h: number };
      expect(Math.abs(geometry.x)).toBeLessThan(2);
      expect(Math.abs(geometry.y)).toBeLessThan(2);
      expect(geometry).toMatchObject({ w: 160, h: 80 });

      // The tool resets after the placement; the shape syncs to the other pane.
      expect(await shapes.getAttribute("aria-pressed")).toBe("false");
      await expect.poll(async () => (await shapeIds(b, "b")).includes(placed![0]), SETTLE).toBe(true);
    } finally {
      await close();
    }
  });

  test("the drag-to-size lands the dragged box at the drag's midpoint (the click stands the default)", async ({
    browser,
  }) => {
    const { a, b, close } = await twoPanes(browser, "canvas-dock-dragsize");
    try {
      await toCanvas(a, "a");
      await toCanvas(b, "b");
      const viewBox = (await canvasView(a, "a").boundingBox())!;
      const center = await canvasCenter(a, "a");
      // The rightward reach stays inside the view (the e2e viewport is
      // narrow: the release may stand outside the view — the pointer
      // capture carries the session; the click's press must not).
      const dx = Math.min(380, viewBox.width / 2 - 60);

      const shapes = dock(a, "a").getByLabel("Shapes");
      await shapes.click();
      const menu = a.locator('[data-slot="docblocks/canvas-shapes-menu"]');
      await expect(menu).toBeVisible();
      await menu.getByLabel("Ellipse").click();

      // The drag: the preview stands during the drag, the release
      // commits the dragged box (zoom 1, pan 0: the screen delta IS the
      // canvas size).
      const start = { x: center.x + dx - 70, y: center.y - 80 };
      const end = { x: center.x + dx + 70, y: center.y + 40 };
      await a.mouse.move(start.x, start.y);
      await a.mouse.down();
      await a.mouse.move(end.x, end.y, { steps: 8 });
      const preview = a.locator('[data-slot="docblocks/canvas-place-preview"]');
      await expect(preview).toBeVisible();
      await a.mouse.up();
      await expect(preview).toBeHidden();

      const blocks = await blockShapes(a, "a");
      const placed = Object.entries(blocks).find(([id, block]) => {
        void id;
        const geometry = block.geometry as { w?: number; h?: number } | undefined;
        return block.type === "shape" && geometry?.w === 140 && geometry?.h === 120;
      });
      expect(placed).toBeDefined();
      const geometry = placed![1].geometry as { x: number; y: number; w: number; h: number };
      expect(geometry).toMatchObject({ x: dx, y: -20, w: 140, h: 120 });
      // One undo step reverts the placement (the focus stands on the
      // canvas container from the press).
      await a.keyboard.press("Control+z");
      await expect.poll(async () => Object.keys(await blockShapes(a, "a")).includes(placed![0]), SETTLE).toBe(false);

      // The shape (before the undo) synced to the other pane; the undo
      // syncs the removal.
      await expect.poll(async () => (await shapeIds(b, "b")).includes(placed![0]), SETTLE).toBe(false);

      // The click (the sub-threshold drag) stands the default-size
      // place (the closed menu's exit animation unmounts first).
      await expect.poll(async () => a.locator('[data-slot="docblocks/canvas-shapes-menu"]').count(), SETTLE).toBe(0);
      await shapes.click();
      await a.locator('[data-slot="docblocks/canvas-shapes-menu"]').getByLabel("Diamond").click();
      const clickX = center.x + Math.min(300, viewBox.width / 2 - 60);
      const clickY = center.y + Math.min(200, viewBox.height / 2 - 120);
      await a.mouse.click(clickX, clickY);
      const clicked = await a.evaluate(() => {
        const doc = window.__paneDocs?.a;
        if (doc === null || doc === undefined) return null;
        const entry = Object.entries(doc.toJSON().blocks).find(
          ([, block]) => block.type === "shape" && block.attrs?.variant === "diamond"
        );
        if (entry === undefined) return null;
        const geometry = (entry[1] as { geometry?: { x: number; y: number; w: number; h: number } }).geometry;
        return geometry ?? null;
      });
      expect(clicked).not.toBeNull();
      expect(clicked!.w).toBe(90);
      expect(clicked!.h).toBe(90);
      expect(clicked!.x).toBeCloseTo(clickX - center.x, 1);
      expect(clicked!.y).toBeCloseTo(clickY - center.y, 1);
    } finally {
      await close();
    }
  });

  test("the text and the frame land with their defaults (the frame is childless — the window's content is the surface's layer, not nested blocks)", async ({
    browser,
  }) => {
    const { a, close } = await twoPanes(browser, "canvas-dock-text-frame");
    try {
      await toCanvas(a, "a");
      const center = await canvasCenter(a, "a");

      await dock(a, "a").getByLabel("Text").click();
      await a.mouse.click(center.x - 100, center.y - 50);
      let blocks = await blockShapes(a, "a");
      const text = Object.entries(blocks).find(([, block]) => block.type === "canvas-text");
      expect(text).toBeDefined();
      expect(text![1].geometry).toMatchObject({ x: -100, y: -50, w: 200, h: 40 });

      await dock(a, "a").getByLabel("Frame").click();
      await a.mouse.click(center.x + 100, center.y + 80);
      blocks = await blockShapes(a, "a");
      const frame = Object.entries(blocks).find(([, block]) => block.type === "frame");
      expect(frame).toBeDefined();
      expect(frame![1].geometry).toMatchObject({ x: 100, y: 80, w: 320, h: 240 });
      // The frame carries no children of its own (the former starter
      // paragraph's stand is gone over the reworked frame — the window's
      // content is the surface's layer rendered as inert copies).
      const frameChildren = await a.evaluate((frameId) => {
        const doc = window.__paneDocs?.a ?? null;
        if (doc === null) return null;
        const block = doc.getBlock(frameId as string);
        return block?.type === "frame" ? (doc.getChildren(frameId as string) ?? []) : null;
      }, frame![0]);
      expect(frameChildren).toEqual([]);
    } finally {
      await close();
    }
  });

  test("the connector picks two items (a third click on the empty canvas cancels)", async ({ browser }) => {
    const { a, b, close } = await twoPanes(browser, "canvas-dock-connector");
    try {
      await toCanvas(a, "a");
      await toCanvas(b, "b");
      const start = await seedShape(a, "a", { variant: "rect" }, { x: -80, y: 0, w: 100, h: 60 });
      const end = await seedShape(a, "a", { variant: "ellipse" }, { x: 80, y: 0, w: 100, h: 60 });

      await dock(a, "a").getByLabel("Connector").click();
      const startItem = a.locator(`[data-slot="docblocks/canvas-item"][data-block-id="${start}"]`);
      const endItem = a.locator(`[data-slot="docblocks/canvas-item"][data-block-id="${end}"]`);
      await startItem.click();
      expect(await startItem.getAttribute("data-connector-pending")).toBe("true");

      // The cancel path first: a click on the empty canvas drops the pick.
      const center = await canvasCenter(a, "a");
      await a.mouse.click(center.x + 240, center.y);
      expect(await dock(a, "a").getByLabel("Connector").getAttribute("aria-pressed")).toBe("false");
      expect(await shapeIds(a, "a").then((ids) => ids.length)).toBe(2);

      // The success path: the two picks create the connector (the overlay
      // line stands in both panes).
      await dock(a, "a").getByLabel("Connector").click();
      await startItem.click();
      await endItem.click();
      const blocks = await blockShapes(a, "a");
      const connector = Object.entries(blocks).find(([, block]) => block.type === "connector");
      expect(connector).toBeDefined();
      // The overlay line stands in the other pane (synced).
      await expect.poll(async () => b.locator(`[data-connector-id="${connector![0]}"]`).count(), SETTLE).toBe(1);
    } finally {
      await close();
    }
  });

  test("the pen stroke lands a freehand shape (a click without a drag creates nothing)", async ({ browser }) => {
    const { a, b, close } = await twoPanes(browser, "canvas-dock-pen");
    try {
      await toCanvas(a, "a");
      await toCanvas(b, "b");
      const center = await canvasCenter(a, "a");

      // The degenerate stroke: a click without a drag.
      await dock(a, "a").getByLabel("Pen").click();
      await a.mouse.click(center.x, center.y);
      expect(await shapeIds(a, "a")).toEqual([]);
      expect(await dock(a, "a").getByLabel("Pen").getAttribute("aria-pressed")).toBe("false");

      // The real stroke: the shape's points + the bbox geometry.
      await dock(a, "a").getByLabel("Pen").click();
      await a.mouse.move(center.x, center.y);
      await a.mouse.down();
      await a.mouse.move(center.x + 50, center.y, { steps: 3 });
      await a.mouse.move(center.x + 100, center.y + 20, { steps: 3 });
      await a.mouse.up();
      const blocks = await blockShapes(a, "a");
      const stroke = Object.entries(blocks).find(([, block]) => block.type === "shape");
      expect(stroke).toBeDefined();
      const geometry = stroke![1].geometry as { x: number; y: number; w: number; h: number };
      expect(geometry.w).toBeGreaterThan(90);
      expect(geometry.w).toBeLessThan(110);
      expect(geometry.h).toBeGreaterThanOrEqual(1);
      expect(geometry.h).toBeLessThanOrEqual(30);

      // The stroke syncs to the other pane (the points stand in its JSON).
      await expect
        .poll(async () => {
          const remote = await blockShapes(b, "b");
          return Object.values(remote).some((block) => block.type === "shape");
        }, SETTLE)
        .toBe(true);
    } finally {
      await close();
    }
  });
});
