// The canvas zoom's stands: the zoom controls (in / out / reset over the
// world's transform, the per-pane's view state, the 25% floor's clamp), the
// wheel's zoom over the pan / tool's modes (the cursor's point stands fixed),
// the M key's mode's switch over the dock, and the zoom toolbar's width's
// stand over the percentage's digit change.
import { type Page, expect, test } from "@playwright/test";

import {
  blockShapes,
  canvasCenter,
  canvasView,
  editorContext,
  openPane,
  seedShape,
  toCanvas,
  twoPanes,
} from "./helpers";

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

/** The box's center (the screen-px geometry). */
function centerOf(box: { x: number; y: number; width: number; height: number }): { x: number; y: number } {
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

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

test.describe("the canvas zoom controls", () => {
  test("zoom in/out/reset change the world transform (view state, per pane)", async ({ browser }) => {
    const { a, b, close } = await twoPanes(browser, "canvas-zoom");
    try {
      await toCanvas(a, "a");
      await toCanvas(b, "b");
      const before = await blockShapes(a, "a");

      expect((await worldTransform(a, "a")).scale).toBe(1);
      await zoomToolbar(a, "a").getByLabel("Zoom in").click();
      expect((await worldTransform(a, "a")).scale).toBeCloseTo(1.1);
      expect(await zoomToolbar(a, "a").getByLabel("Reset zoom").textContent()).toBe("110%");
      await zoomToolbar(a, "a").getByLabel("Reset zoom").click();
      expect((await worldTransform(a, "a")).scale).toBe(1);
      await zoomToolbar(a, "a").getByLabel("Zoom out").click();
      expect(await zoomToolbar(a, "a").getByLabel("Reset zoom").textContent()).toBe("90%");

      // The zoom clamps at the 25% floor (the 10% step's eight outs).
      for (let i = 0; i < 8; i += 1) await zoomToolbar(a, "a").getByLabel("Zoom out").click();
      expect(await zoomToolbar(a, "a").getByLabel("Reset zoom").textContent()).toBe("25%");

      // The zoom is the pane's view state: the other pane stands at 100%,
      // and no zoom write reaches the doc.
      expect((await worldTransform(b, "b")).scale).toBe(1);
      expect(await blockShapes(a, "a")).toEqual(before);
    } finally {
      await close();
    }
  });
});

test.describe("the wheel's gesture", () => {
  test("the pan mode: the wheel stands the zoom at the cursor (the old stand)", async ({ browser }) => {
    const { a, close } = await twoPanes(browser, "canvas-wheel-zoom");
    try {
      await toCanvas(a, "a");
      const id = await seedShape(a, "a", { variant: "rect" }, { x: 0, y: 0, w: 120, h: 80 });
      expect(id).toBeTruthy();

      // The hand's toggle: the pan mode.
      await dock(a, "a").getByLabel("Switch to the pan mode").click();

      // The shape's on-screen center at the 100% zoom.
      const wrapper = a.locator(`[data-testid="doc-a"] [data-slot="docblocks/canvas-item"][data-block-id="${id}"]`);
      const before = (await wrapper.boundingBox())!;
      const center = { x: before.x + before.width / 2, y: before.y + before.height / 2 };
      await a.mouse.move(center.x, center.y);

      // The wheel's notch (negative deltaY): the zoom steps and the
      // shape's screen center stands fixed (the pan compensates the
      // zoom — the cursor's canvas point keeps; the box grows with the
      // zoom around the center anchor).
      await a.mouse.wheel(0, -120);
      expect(await zoomToolbar(a, "a").getByLabel("Reset zoom").textContent()).toBe("110%");
      const after = centerOf((await wrapper.boundingBox())!);
      expect(Math.abs(after.x - center.x)).toBeLessThanOrEqual(2);
      expect(Math.abs(after.y - center.y)).toBeLessThanOrEqual(2);

      // The doc stands (the zoom is the view state).
      const shapes = await blockShapes(a, "a");
      expect(shapes[id]?.geometry).toEqual({ x: 0, y: 0, w: 120, h: 80 });
    } finally {
      await close();
    }
  });

  test("the active tool: the wheel stands the zoom (the tool's stand over the pan)", async ({ browser }) => {
    const { a, close } = await twoPanes(browser, "canvas-wheel-tool-zoom");
    try {
      await toCanvas(a, "a");
      const id = await seedShape(a, "a", { variant: "rect" }, { x: 0, y: 0, w: 120, h: 80 });
      expect(id).toBeTruthy();

      // The dock's shapes' menu: the rect's pick stands the active tool.
      await dock(a, "a").getByLabel("Shapes").click();
      await a.getByLabel("Rectangle", { exact: true }).click();

      // The wheel over the canvas: the zoom stands (the tool's old
      // behavior), not the pointer mode's pan.
      const cursor = await canvasCenter(a, "a");
      const shapeCountBefore = Object.keys(await blockShapes(a, "a")).length;
      await a.mouse.move(cursor.x, cursor.y);
      await a.mouse.wheel(0, -120);
      const after = await worldTransform(a, "a");
      expect(after.scale).toBeCloseTo(1.1, 5);
      expect(await zoomToolbar(a, "a").getByLabel("Reset zoom").textContent()).toBe("110%");

      // The doc stands (no shape placed: the wheel is not a click).
      const shapes = await blockShapes(a, "a");
      expect(shapes[id]?.geometry).toEqual({ x: 0, y: 0, w: 120, h: 80 });
      expect(Object.keys(shapes).length).toBe(shapeCountBefore);
    } finally {
      await close();
    }
  });

  test("the M key stands the select mode (the dock's mode icon stands the current mode)", async ({ browser }) => {
    const { a, close } = await twoPanes(browser, "canvas-wheel-mode");
    try {
      await toCanvas(a, "a");

      // The select mode: the pointer's icon.
      const modeButton = a.locator('[data-slot="docblocks/canvas-dock"]').first();
      const iconPath = async () => modeButton.locator("button").first().locator("svg path").first().getAttribute("d");
      const pointerPath = await iconPath();
      expect(pointerPath).toContain("M4.037 4.688");
      expect(await modeButton.locator("button").first().getAttribute("aria-label")).toBe("Switch to the pan mode");

      // The hand's toggle: the pan mode stands the hand's icon.
      await modeButton.locator("button").first().click();
      expect(await iconPath()).toContain("M18 11V6");
      expect(await modeButton.locator("button").first().getAttribute("aria-label")).toBe("Switch to the select mode");

      // The M key: back to the select mode (the pointer's icon). The
      // focus parks on the canvas container (the keydown reach — the
      // dock's mousedown preventDefault keeps the focus off the button).
      await a.locator('[data-slot="docblocks/canvas-view"]').evaluate((el) => el.focus());
      await a.keyboard.press("m");
      expect(await modeButton.locator("button").first().getAttribute("aria-label")).toBe("Switch to the pan mode");
      expect(await iconPath()).toContain("M4.037 4.688");
    } finally {
      await close();
    }
  });
});

test("the zoom toolbar's width stands fixed over the percentage's digit change (the fit/zoom-out/zoom-in buttons stand put; the 25%–400% steps + the reset stand)", async ({
  browser,
}) => {
  const context = await editorContext(browser);
  const a = await context.newPage();
  const room = `zoomfixed-${Math.random().toString(36).slice(2, 8)}`;
  try {
    await openPane(a, "a", room);
    await toCanvas(a, "a");

    const toolbar = zoomToolbar(a, "a");
    const fit = toolbar.getByRole("button", { name: "Fit to screen" });
    const zoomOut = toolbar.getByRole("button", { name: "Zoom out" });
    const zoomIn = toolbar.getByRole("button", { name: "Zoom in" });
    const reset = toolbar.getByRole("button", { name: "Reset zoom" });

    // The fixed-width contract: the toolbar's width and the fit / zoom
    // out / zoom in buttons' x-positions stand identical over the
    // percentage's digit change (25% / 90% / 100% / 400%).
    interface Stand {
      toolbarWidth: number;
      fitX: number;
      zoomOutX: number;
      zoomInX: number;
    }
    const stand = async (): Promise<Stand> => {
      const [t, f, o, i] = await Promise.all([
        toolbar.boundingBox(),
        fit.boundingBox(),
        zoomOut.boundingBox(),
        zoomIn.boundingBox(),
      ]);
      if (t === null || f === null || o === null || i === null) throw new Error("the box stands none");
      return { toolbarWidth: t.width, fitX: f.x, zoomOutX: o.x, zoomInX: i.x };
    };

    // The step's stand: click until the display's value (the step's
    // clamp over the 25%–400% range — the stops stand 0.3, …, 0.25,
    // so the value's stand, not the click count, is the contract).
    const stepUntil = async (button: import("@playwright/test").Locator, value: string): Promise<void> => {
      for (let step = 0; step < 50 && (await reset.textContent()) !== value; step += 1) {
        await button.click();
      }
      expect(await reset.textContent()).toBe(value);
    };

    // The 100% stand (the canvas entry over the empty doc: the fit's
    // no-op, the zoom stands the default 1).
    expect(await reset.textContent()).toBe("100%");
    const at100 = await stand();

    // 90% (one step down): the display's digit count changes (4 → 3
    // signs) — the toolbar stands no reflow.
    await stepUntil(zoomOut, "90%");
    const at90 = await stand();
    expect(at90.toolbarWidth).toBeCloseTo(at100.toolbarWidth, 1);
    expect(at90.fitX).toBeCloseTo(at100.fitX, 1);
    expect(at90.zoomOutX).toBeCloseTo(at100.zoomOutX, 1);
    expect(at90.zoomInX).toBeCloseTo(at100.zoomInX, 1);

    // The reset stands (the 100% stand, the step's regression).
    await reset.click();
    expect(await reset.textContent()).toBe("100%");

    // 400% (the max clamp — the step stands to the clamp): the 3-digit
    // stand stands no reflow over the 4-digit stand's position.
    await stepUntil(zoomIn, "400%");
    const at400 = await stand();
    expect(at400.toolbarWidth).toBeCloseTo(at100.toolbarWidth, 1);
    expect(at400.fitX).toBeCloseTo(at100.fitX, 1);
    expect(at400.zoomInX).toBeCloseTo(at100.zoomInX, 1);

    // 25% (the min clamp — the step stands to the clamp): the 2-digit
    // stand stands no reflow.
    await stepUntil(zoomOut, "25%");
    const at25 = await stand();
    expect(at25.toolbarWidth).toBeCloseTo(at100.toolbarWidth, 1);
    expect(at25.fitX).toBeCloseTo(at100.fitX, 1);
    expect(at25.zoomOutX).toBeCloseTo(at100.zoomOutX, 1);
    expect(at25.zoomInX).toBeCloseTo(at100.zoomInX, 1);
  } finally {
    await context.close();
  }
});
