import { type Browser, type Page, expect, test } from "@playwright/test";

import { switchPaneView } from "./helpers";

// Each test gets its own room via ?syncUrl= — the relay keeps rooms for
// the dev server's lifetime, so a shared room would be polluted by other
// spec files (and by manually opened tabs).
const RELAY = "ws://localhost:5199";
const SETTLE = { timeout: 15_000 };

async function openPane(page: Page, client: "a" | "b", room: string): Promise<void> {
  await page.goto(`/?client=${client}&syncUrl=${RELAY}/${room}`);
  await expect(page.getByTestId(`status-${client}`)).toHaveText("connected");
}

async function twoPanes(browser: Browser, room: string): Promise<{ a: Page; b: Page; close: () => Promise<void> }> {
  const contextA = await browser.newContext();
  const contextB = await browser.newContext();
  const a = await contextA.newPage();
  const b = await contextB.newPage();
  const uniqueRoom = `${room}-${Math.random().toString(36).slice(2, 8)}`;
  await openPane(a, "a", uniqueRoom);
  await openPane(b, "b", uniqueRoom);
  return {
    a,
    b,
    close: async () => {
      await contextA.close();
      await contextB.close();
    },
  };
}

/** Switch the pane to the canvas view (the harness's view toggle). */
async function toCanvas(page: Page, client: "a" | "b"): Promise<void> {
  await switchPaneView(page, client, "canvas");
}

/** The canvas-view container (the viewport's chrome root). */
const canvasView = (page: Page, client: "a" | "b") =>
  page.locator(`[data-testid="doc-${client}"] [data-slot="docblocks/canvas-view"]`);

/** The world wrapper (the zoom/pan transform carrier). */
const world = (page: Page, client: "a" | "b") =>
  canvasView(page, client).locator('[data-slot="docblocks/canvas-world"]');

/** The zoom toolbar (scoped to the pane's canvas view). */
const zoomToolbar = (page: Page, client: "a" | "b") =>
  canvasView(page, client).getByRole("toolbar", { name: "Canvas zoom" });

/** The dock (scoped to the pane's canvas view). */
const dock = (page: Page, client: "a" | "b") => canvasView(page, client).getByRole("toolbar", { name: "Canvas tools" });

/** The canvas-view center in page coordinates. */
async function canvasCenter(page: Page, client: "a" | "b"): Promise<{ x: number; y: number }> {
  const box = (await canvasView(page, client).boundingBox())!;
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

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
async function seedShape(
  page: Page,
  client: "a" | "b",
  variant: "rect" | "rounded" | "ellipse" | "diamond",
  geometry: { x: number; y: number; w: number; h: number }
): Promise<string> {
  return page.evaluate(
    ({ client, variant, geometry }) => {
      const docs = window.__paneDocs;
      const doc = (client === "a" ? docs?.a : docs?.b) ?? null;
      if (doc === null) throw new Error("the pane's doc is not mounted");
      const json = doc.toJSON();
      const surfaceId = Object.entries(json.blocks).find(([, block]) => block.type === "surface")?.[0];
      const surface = surfaceId !== undefined ? surfaceId : doc.insertBlock("surface");
      const id = doc.insertBlock("shape", { variant }, { parent: surface });
      doc.setGeometry(id, geometry);
      return id;
    },
    { client, variant, geometry }
  );
}

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
async function blockShapes(
  page: Page,
  client: "a" | "b"
): Promise<Record<string, { type: string; geometry: unknown }>> {
  return page.evaluate(
    ({ client }) => {
      const docs = window.__paneDocs;
      const doc = (client === "a" ? docs?.a : docs?.b) ?? null;
      if (doc === null) return {};
      const json = doc.toJSON();
      const out: Record<string, { type: string; geometry: unknown }> = {};
      for (const [id, block] of Object.entries(json.blocks)) {
        const entry = block as { type: string; geometry?: unknown };
        out[id] = { type: entry.type, geometry: entry.geometry };
      }
      return out;
    },
    { client }
  );
}

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
  test("the select mode: the wheel pans the canvas (the 1:1 screen px, the doc stands)", async ({ browser }) => {
    const { a, close } = await twoPanes(browser, "canvas-wheel-pan");
    try {
      await toCanvas(a, "a");
      const id = await seedShape(a, "a", "rect", { x: 0, y: 0, w: 120, h: 80 });
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
      const id = await seedShape(a, "a", "rect", { x: 0, y: 0, w: 120, h: 80 });
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
      const id = await seedShape(a, "a", "rect", { x: 0, y: 0, w: 120, h: 80 });
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

  test("the pan mode: the wheel stands the zoom at the cursor (the old stand)", async ({ browser }) => {
    const { a, close } = await twoPanes(browser, "canvas-wheel-zoom");
    try {
      await toCanvas(a, "a");
      const id = await seedShape(a, "a", "rect", { x: 0, y: 0, w: 120, h: 80 });
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
      const id = await seedShape(a, "a", "rect", { x: 0, y: 0, w: 120, h: 80 });
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

  test("the M key over the live caret stands the view (no m character, the focus parks)", async ({ browser }) => {
    const { a, close } = await twoPanes(browser, "canvas-wheel-m-caret");
    try {
      await toCanvas(a, "a");
      // The 25% zoom: the page miniature's text stands on screen (at
      // 100% the page's top stands above the viewport). The 10% step's
      // eight outs stand the 25% floor.
      for (let i = 0; i < 8; i += 1) await zoomToolbar(a, "a").getByLabel("Zoom out").click();
      await a.waitForTimeout(300);
      // Seed the paragraph and stand the caret over it (the two-click
      // contract's second press).
      const pid = await a.evaluate(() => {
        const doc = window.__paneDocs?.a;
        if (doc === null || doc === undefined) throw new Error("the pane's doc is not mounted");
        const p = doc.insertBlock("paragraph");
        doc.insertText(p, 0, "the line");
        return p;
      });
      expect(pid).toBeTruthy();
      const text = a.locator(
        `[data-testid="doc-a"] [data-slot="docblocks/page-card"] [data-block-id="${pid}"] [data-slot="docblocks/block-content"]`
      );
      const box = (await text.boundingBox())!;
      const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
      await a.mouse.click(point.x, point.y);
      await a.mouse.click(point.x, point.y);
      expect(await a.evaluate(() => (document.activeElement as HTMLElement | null)?.isContentEditable ?? false)).toBe(
        true
      );

      // The M key from the editing state: the caret drops (the focus
      // parks on the canvas view, the selection clears), the "m" stands
      // no character, and the mode stands the select.
      await a.keyboard.press("m");
      const state = await a.evaluate(() => ({
        editable: (document.activeElement as HTMLElement | null)?.isContentEditable ?? false,
        focus: document.activeElement?.getAttribute("data-slot") ?? null,
        ranges: document.getSelection()?.rangeCount ?? 0,
      }));
      expect(state).toEqual({ editable: false, focus: "docblocks/canvas-view", ranges: 0 });
      const value = await a.evaluate((id) => {
        const block = window.__paneDocs?.a?.getBlock(id) as { content?: { text: string }[] } | null | undefined;
        return (block?.content ?? []).map((r) => r.text).join("");
      }, pid);
      expect(value).toBe("the line");
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

test.describe("the canvas marquee selection", () => {
  test("a marquee over the shapes selects them; Delete removes them in both panes", async ({ browser }) => {
    const { a, b, close } = await twoPanes(browser, "canvas-marquee");
    try {
      await toCanvas(a, "a");
      await toCanvas(b, "b");
      const s1 = await seedShape(a, "a", "rect", { x: -500, y: 0, w: 120, h: 80 });
      const s2 = await seedShape(a, "a", "ellipse", { x: 500, y: 0, w: 120, h: 80 });

      // Zoom out to 25%: the shapes stand at screen (±125, 0), the page
      // miniature shrinks to the (±45, ±60) center box — the marquee's
      // corners are the empty canvas around them.
      const zoom = zoomToolbar(a, "a");
      for (let i = 0; i < 8; i += 1) await zoom.getByLabel("Zoom out").click();
      expect(await zoom.getByLabel("Reset zoom").textContent()).toBe("25%");

      const center = await canvasCenter(a, "a");
      await a.mouse.move(center.x - 170, center.y - 70);
      await a.mouse.down();
      await a.mouse.move(center.x, center.y, { steps: 3 });
      await a.mouse.move(center.x + 170, center.y + 70, { steps: 3 });
      await a.mouse.up();

      // Both shapes carry the selection (the data-selected indicator);
      // the marquee rect is gone.
      const selected = await a
        .locator('[data-slot="docblocks/canvas-item"][data-selected]')
        .evaluateAll((els) => els.map((el) => el.dataset.blockId ?? ""));
      expect(selected.sort()).toEqual([s1, s2].sort());
      expect(await canvasView(a, "a").locator('[data-slot="docblocks/canvas-marquee"]').count()).toBe(0);

      // The selection is the pane's view state: the other pane is untouched.
      expect(await b.locator('[data-slot="docblocks/canvas-item"][data-selected]').count()).toBe(0);

      // The focus parks on the canvas container (the Delete reach — the
      // container's keydown handler owns the canvas items' removal).
      expect(await a.evaluate(() => document.activeElement?.getAttribute("data-slot"))).toBe("docblocks/canvas-view");

      await a.keyboard.press("Delete");
      await expect
        .poll(async () => shapeIds(b, "b").then((ids) => !ids.includes(s1) && !ids.includes(s2)), SETTLE)
        .toBe(true);
    } finally {
      await close();
    }
  });
});

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

  test("the text and the frame land with their defaults (the frame carries the starter paragraph)", async ({
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
      const frameDoc = await a.evaluate((frameId) => {
        const docs = window.__paneDocs;
        const doc = docs?.a ?? null;
        if (doc === null) return null;
        const block = doc.getBlock(frameId as string);
        return block?.type === "frame"
          ? (doc.getChildren(frameId as string) ?? []).map((childId) => doc.getBlock(childId)?.type)
          : null;
      }, frame![0]);
      expect(frameDoc).toEqual(["paragraph"]);
    } finally {
      await close();
    }
  });

  test("the connector picks two items (a third click on the empty canvas cancels)", async ({ browser }) => {
    const { a, b, close } = await twoPanes(browser, "canvas-dock-connector");
    try {
      await toCanvas(a, "a");
      await toCanvas(b, "b");
      const start = await seedShape(a, "a", "rect", { x: -80, y: 0, w: 100, h: 60 });
      const end = await seedShape(a, "a", "ellipse", { x: 80, y: 0, w: 100, h: 60 });

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

test("the zoom toolbar's width stands fixed over the percentage's digit change (the fit/zoom-out/zoom-in buttons stand put; the 25%–400% steps + the reset stand)", async ({
  browser,
}) => {
  const context = await browser.newContext();
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
