// The canvas move session (the pointer drag over a canvas item): the press
// selects (group-aware), the drag previews and commits one setGeometry
// per item in one transact on release (one undo step), and a no-op press
// writes nothing. Every test zooms out to 25% so the empty canvas around
// the seeded shapes stands free.
import { type Page, expect, test } from "@playwright/test";

import { SETTLE, blockShapes, canvasCenter, canvasView, seedShape, toCanvas, twoPanes } from "./helpers";

// The two-pane's settle stands the default 30s budget at its edge (the 15s
// SETTLE's panes + the page loads): the raised budget keeps the timeout
// class out of the loaded machine's flake zone (a true stall stays visible).
test.setTimeout(45_000);

const ZOOM = 0.25;

const zoomToolbar = (page: Page, client: "a" | "b") =>
  canvasView(page, client).getByRole("toolbar", { name: "Canvas zoom" });

/** Zoom the pane out to 25% (four steps down from 100%). */
async function zoomTo25(page: Page, client: "a" | "b"): Promise<void> {
  const zoom = zoomToolbar(page, client);
  for (let i = 0; i < 8; i += 1) await zoom.getByLabel("Zoom out").click();
  expect(await zoom.getByLabel("Reset zoom").textContent()).toBe("25%");
}

/** The selected canvas item ids on the pane. */
async function selectedIds(page: Page, client: "a" | "b"): Promise<string[]> {
  return page
    .locator(`[data-testid="doc-${client}"] [data-slot="docblocks/canvas-item"][data-selected]`)
    .evaluateAll((els) => els.map((el) => el.dataset.blockId ?? ""));
}

test.describe("the canvas move session", () => {
  test("the marquee skips the connector (its wrapper is an empty box); the group moves without it", async ({
    browser,
  }) => {
    const { a, close } = await twoPanes(browser, "canvas-move-connector");
    try {
      await toCanvas(a, "a");
      const s1 = await seedShape(a, "a", { variant: "rect" }, { x: -500, y: 0, w: 120, h: 80 });
      const s2 = await seedShape(a, "a", { variant: "ellipse" }, { x: 500, y: 0, w: 120, h: 80 });
      const connector = await a.evaluate(
        ({ client, s1, s2 }) => {
          const docs = window.__paneDocs;
          const doc = (client === "a" ? docs?.a : docs?.b) ?? null;
          if (doc === null) throw new Error("the pane's doc is not mounted");
          const json = doc.toJSON();
          const surface = Object.entries(json.blocks).find(([, block]) => block.type === "surface")?.[0];
          if (surface === undefined) throw new Error("no surface");
          return doc.insertBlock("connector", { start: { blockId: s1 }, end: { blockId: s2 } }, { parent: surface });
        },
        { client: "a" as const, s1, s2 }
      );
      await zoomTo25(a, "a");
      const center = await canvasCenter(a, "a");

      // The marquee crosses the center (the connector's phantom box) — the
      // connector is not selectable (no own box).
      await a.mouse.move(center.x - 170, center.y - 70);
      await a.mouse.down();
      await a.mouse.move(center.x, center.y, { steps: 3 });
      await a.mouse.move(center.x + 170, center.y + 70, { steps: 3 });
      await a.mouse.up();
      expect((await selectedIds(a, "a")).sort()).toEqual([s1, s2].sort());

      // The drag moves the two shapes; the connector keeps no geometry.
      await a.mouse.move(center.x - 500 * ZOOM, center.y);
      await a.mouse.down();
      await a.mouse.move(center.x - 500 * ZOOM + 40, center.y + 20, { steps: 8 });
      await a.mouse.up();

      const shapes = await blockShapes(a, "a");
      expect(shapes[s1]?.geometry?.x).toBe(-340);
      expect(shapes[s2]?.geometry?.x).toBe(660);
      expect(shapes[connector]?.geometry).toBeUndefined();
    } finally {
      await close();
    }
  });

  test("a pointer drag moves the shape (one setGeometry; the peer syncs)", async ({ browser }) => {
    const { a, b, close } = await twoPanes(browser, "canvas-move-single");
    try {
      await toCanvas(a, "a");
      await toCanvas(b, "b");
      const s1 = await seedShape(a, "a", { variant: "rect" }, { x: 300, y: 0, w: 120, h: 80 });
      await zoomTo25(a, "a");

      // The item's screen center: the canvas center + the canvas position
      // scaled by the zoom (the pan is 0).
      const center = await canvasCenter(a, "a");
      const start = { x: center.x + 300 * ZOOM, y: center.y + 0 };

      await a.mouse.move(start.x, start.y);
      await a.mouse.down();
      await a.mouse.move(start.x + 30, start.y - 15, { steps: 8 });
      await a.mouse.up();

      // The screen delta (30, -15) is the canvas delta (120, -60) at 25%.
      const shapes = await blockShapes(a, "a");
      expect(shapes[s1]?.geometry).toEqual({ x: 420, y: -60, w: 120, h: 80 });
      await expect
        .poll(async () => (await blockShapes(b, "b"))[s1]?.geometry, SETTLE)
        .toEqual({ x: 420, y: -60, w: 120, h: 80 });

      // One undo step reverts the move (the focus parked on the canvas
      // container at the press).
      expect(await a.evaluate(() => document.activeElement?.getAttribute("data-slot"))).toBe("docblocks/canvas-view");
      await a.keyboard.press("Control+z");
      await expect
        .poll(async () => (await blockShapes(a, "a"))[s1]?.geometry, SETTLE)
        .toEqual({ x: 300, y: 0, w: 120, h: 80 });
    } finally {
      await close();
    }
  });

  test("a click selects the item (no drag: nothing is written)", async ({ browser }) => {
    const { a, close } = await twoPanes(browser, "canvas-move-click");
    try {
      await toCanvas(a, "a");
      const s1 = await seedShape(a, "a", { variant: "rect" }, { x: 300, y: 0, w: 120, h: 80 });
      const s2 = await seedShape(a, "a", { variant: "ellipse" }, { x: -300, y: 0, w: 120, h: 80 });
      await zoomTo25(a, "a");

      const center = await canvasCenter(a, "a");
      await a.mouse.click(center.x + 300 * ZOOM, center.y);
      expect(await selectedIds(a, "a")).toEqual([s1]);

      // The other item stands unselected.
      await a.mouse.click(center.x - 300 * ZOOM, center.y);
      expect(await selectedIds(a, "a")).toEqual([s2]);
    } finally {
      await close();
    }
  });

  test("a no-op drag (below the threshold) writes nothing", async ({ browser }) => {
    const { a, close } = await twoPanes(browser, "canvas-move-noop");
    try {
      await toCanvas(a, "a");
      await seedShape(a, "a", { variant: "rect" }, { x: 300, y: 0, w: 120, h: 80 });
      await zoomTo25(a, "a");
      const before = await blockShapes(a, "a");

      const center = await canvasCenter(a, "a");
      await a.mouse.move(center.x + 300 * ZOOM, center.y);
      await a.mouse.down();
      await a.mouse.move(center.x + 300 * ZOOM + 1, center.y + 1, { steps: 2 });
      await a.mouse.up();

      expect(await blockShapes(a, "a")).toEqual(before);
    } finally {
      await close();
    }
  });

  test("a marquee group moves by one delta (every item in the group)", async ({ browser }) => {
    const { a, b, close } = await twoPanes(browser, "canvas-move-group");
    try {
      await toCanvas(a, "a");
      await toCanvas(b, "b");
      const s1 = await seedShape(a, "a", { variant: "rect" }, { x: -500, y: 0, w: 120, h: 80 });
      const s2 = await seedShape(a, "a", { variant: "ellipse" }, { x: 500, y: 0, w: 120, h: 80 });
      await zoomTo25(a, "a");
      const center = await canvasCenter(a, "a");

      // The marquee: an empty-canvas drag covering both shapes (the page
      // miniature shrinks to the center box at 25%).
      await a.mouse.move(center.x - 170, center.y - 70);
      await a.mouse.down();
      await a.mouse.move(center.x, center.y, { steps: 3 });
      await a.mouse.move(center.x + 170, center.y + 70, { steps: 3 });
      await a.mouse.up();
      expect((await selectedIds(a, "a")).sort()).toEqual([s1, s2].sort());

      // Drag one of the selected: the whole group moves. The screen delta
      // (40, 20) is the canvas delta (160, 80) at 25%.
      await a.mouse.move(center.x - 500 * ZOOM, center.y);
      await a.mouse.down();
      await a.mouse.move(center.x - 500 * ZOOM + 40, center.y + 20, { steps: 8 });
      await a.mouse.up();

      const shapes = await blockShapes(a, "a");
      expect(shapes[s1]?.geometry).toEqual({ x: -340, y: 80, w: 120, h: 80 });
      expect(shapes[s2]?.geometry).toEqual({ x: 660, y: 80, w: 120, h: 80 });
      await expect
        .poll(
          async () =>
            (await blockShapes(b, "b"))[s1]?.geometry?.x === -340 &&
            (await blockShapes(b, "b"))[s2]?.geometry?.x === 660,
          SETTLE
        )
        .toBe(true);
    } finally {
      await close();
    }
  });
});
