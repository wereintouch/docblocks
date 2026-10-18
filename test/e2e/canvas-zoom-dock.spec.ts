import { type Browser, type Page, expect, test } from "@playwright/test";

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
  await page.getByTestId(`view-${client}-canvas`).click();
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
  variant: "rect" | "ellipse" | "diamond" | "line",
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
      expect((await worldTransform(a, "a")).scale).toBeCloseTo(1.25);
      expect(await zoomToolbar(a, "a").getByLabel("Reset zoom").textContent()).toBe("125%");
      await zoomToolbar(a, "a").getByLabel("Reset zoom").click();
      expect((await worldTransform(a, "a")).scale).toBe(1);
      await zoomToolbar(a, "a").getByLabel("Zoom out").click();
      expect(await zoomToolbar(a, "a").getByLabel("Reset zoom").textContent()).toBe("75%");

      // The zoom clamps at the 25% floor.
      for (let i = 0; i < 4; i += 1) await zoomToolbar(a, "a").getByLabel("Zoom out").click();
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

test.describe("the canvas pan", () => {
  test("the hand mode drags the canvas (view state, no data write)", async ({ browser }) => {
    const { a, close } = await twoPanes(browser, "canvas-pan");
    try {
      await toCanvas(a, "a");
      const before = await blockShapes(a, "a");
      const center = await canvasCenter(a, "a");

      // The hand toggle (the dock's first button).
      await dock(a, "a").getByLabel("Switch to the pan mode").click();
      expect(await dock(a, "a").getByLabel("Switch to the default pointer").getAttribute("aria-pressed")).toBe("true");

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
      // 100% the page's top stands above the viewport).
      for (let i = 0; i < 3; i += 1) await zoomToolbar(a, "a").getByLabel("Zoom out").click();
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
      for (let i = 0; i < 3; i += 1) await zoom.getByLabel("Zoom out").click();
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
      await menu.getByLabel("Rectangle").click();
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
