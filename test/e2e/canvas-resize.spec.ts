import { type Browser, type Page, expect, test } from "@playwright/test";

// The canvas resize sessions (the selection's handles): the e/w/n/s and
// corner handles resize the box (one setGeometry per release, one undo
// step), the shift corner keeps the aspect, and a sub-threshold handle
// drag writes nothing. The tests zoom to 50% (two steps down) so the
// seeded boxes stand at half their canvas size on screen.
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

async function toCanvas(page: Page, client: "a" | "b"): Promise<void> {
  await page.getByTestId(`view-${client}-canvas`).click();
}

const canvasView = (page: Page, client: "a" | "b") =>
  page.locator(`[data-testid="doc-${client}"] [data-slot="docblocks/canvas-view"]`);

const zoomToolbar = (page: Page, client: "a" | "b") =>
  canvasView(page, client).getByRole("toolbar", { name: "Canvas zoom" });

async function canvasCenter(page: Page, client: "a" | "b"): Promise<{ x: number; y: number }> {
  const box = (await canvasView(page, client).boundingBox())!;
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

async function blockShapes(
  page: Page,
  client: "a" | "b"
): Promise<Record<string, { type: string; geometry: { x: number; y: number; w: number; h: number } | undefined }>> {
  return page.evaluate(
    ({ client }) => {
      const docs = window.__paneDocs;
      const doc = (client === "a" ? docs?.a : docs?.b) ?? null;
      if (doc === null) return {};
      const json = doc.toJSON();
      const out: Record<
        string,
        { type: string; geometry: { x: number; y: number; w: number; h: number } | undefined }
      > = {};
      for (const [id, block] of Object.entries(json.blocks)) {
        const entry = block as {
          type: string;
          geometry?: { x: number; y: number; w: number; h: number };
        };
        out[id] = { type: entry.type, geometry: entry.geometry };
      }
      return out;
    },
    { client }
  );
}

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

async function zoomTo50(page: Page, client: "a" | "b"): Promise<void> {
  const zoom = zoomToolbar(page, client);
  for (let i = 0; i < 5; i += 1) await zoom.getByLabel("Zoom out").click();
  expect(await zoom.getByLabel("Reset zoom").textContent()).toBe("50%");
}

/** Click the seeded shape's center (selects it; the no-op press writes nothing). */
async function selectShape(page: Page, client: "a" | "b", center: { x: number; y: number }): Promise<void> {
  await page.mouse.click(center.x, center.y);
}

const handles = (page: Page, client: "a" | "b") =>
  canvasView(page, client).locator('[data-slot="docblocks/canvas-handles"]');

const handle = (page: Page, client: "a" | "b", id: string) => handles(page, client).locator(`[data-handle="${id}"]`);

/** The handle's on-screen center. */
async function handleCenter(page: Page, client: "a" | "b", id: string): Promise<{ x: number; y: number }> {
  const box = (await handle(page, client, id).boundingBox())!;
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

test.describe("the canvas resize handles", () => {
  test("the e handle grows the width (the center re-derives); the other pane syncs", async ({ browser }) => {
    const { a, b, close } = await twoPanes(browser, "canvas-resize-e");
    try {
      await toCanvas(a, "a");
      await toCanvas(b, "b");
      await zoomTo50(a, "a");
      const shape = await seedShape(a, "a", "rect", { x: 0, y: 0, w: 200, h: 100 });
      await zoomTo50(b, "b");

      // The shape's center is the canvas origin (the pane center).
      const center = await canvasCenter(a, "a");
      await selectShape(a, "a", center);
      expect(await handles(a, "a").count()).toBe(1);

      // The e handle stands at the east edge (w/2 * zoom right of the
      // center); a +40px screen drag is +80 canvas at 50%.
      const start = await handleCenter(a, "a", "e");
      await a.mouse.move(start.x, start.y);
      await a.mouse.down();
      await a.mouse.move(start.x + 40, start.y, { steps: 6 });
      await a.mouse.up();

      expect((await blockShapes(a, "a"))[shape]?.geometry).toEqual({ x: 40, y: 0, w: 280, h: 100 });
      await expect
        .poll(async () => (await blockShapes(b, "b"))[shape]?.geometry, SETTLE)
        .toEqual({ x: 40, y: 0, w: 280, h: 100 });
    } finally {
      await close();
    }
  });

  test("the shift corner keeps the aspect (the dominant axis decides)", async ({ browser }) => {
    const { a, close } = await twoPanes(browser, "canvas-resize-aspect");
    try {
      await toCanvas(a, "a");
      await zoomTo50(a, "a");
      const shape = await seedShape(a, "a", "ellipse", { x: 0, y: 0, w: 200, h: 100 });
      const center = await canvasCenter(a, "a");
      await selectShape(a, "a", center);

      // The se corner (the opposite nw corner is the anchor); the screen
      // delta (+100, +50) is the canvas delta (+200, +100) at 50%: both
      // axes at 2x (the width 400, the height 200, the anchor stands).
      const start = await handleCenter(a, "a", "se");
      await a.keyboard.down("Shift");
      await a.mouse.move(start.x, start.y);
      await a.mouse.down();
      await a.mouse.move(start.x + 100, start.y + 50, { steps: 8 });
      await a.mouse.up();
      await a.keyboard.up("Shift");

      expect((await blockShapes(a, "a"))[shape]?.geometry).toEqual({ x: 100, y: 50, w: 400, h: 200 });
    } finally {
      await close();
    }
  });

  test("the w handle's floor clamps the width at 20 (the e edge stands)", async ({ browser }) => {
    const { a, close } = await twoPanes(browser, "canvas-resize-floor");
    try {
      await toCanvas(a, "a");
      await zoomTo50(a, "a");
      const shape = await seedShape(a, "a", "rect", { x: 0, y: 0, w: 200, h: 100 });
      const center = await canvasCenter(a, "a");
      await selectShape(a, "a", center);

      // The w handle dragged far right (past the center): the moving edge
      // clamps at the floor against the standing e edge.
      const start = await handleCenter(a, "a", "w");
      await a.mouse.move(start.x, start.y);
      await a.mouse.down();
      await a.mouse.move(start.x + 300, start.y, { steps: 10 });
      await a.mouse.up();

      expect((await blockShapes(a, "a"))[shape]?.geometry).toEqual({ x: 90, y: 0, w: 20, h: 100 });
    } finally {
      await close();
    }
  });

  test("a sub-threshold handle drag writes nothing", async ({ browser }) => {
    const { a, close } = await twoPanes(browser, "canvas-resize-noop");
    try {
      await toCanvas(a, "a");
      await zoomTo50(a, "a");
      const shape = await seedShape(a, "a", "rect", { x: 0, y: 0, w: 200, h: 100 });
      const center = await canvasCenter(a, "a");
      await selectShape(a, "a", center);
      const before = await blockShapes(a, "a");

      const start = await handleCenter(a, "a", "n");
      await a.mouse.move(start.x, start.y);
      await a.mouse.down();
      await a.mouse.move(start.x, start.y + 2, { steps: 2 });
      await a.mouse.up();

      const after = await blockShapes(a, "a");
      expect(after[shape]?.geometry).toEqual(before[shape]?.geometry);
    } finally {
      await close();
    }
  });

  test("the handles stand only for a single selection (a marquee group hides them)", async ({ browser }) => {
    const { a, close } = await twoPanes(browser, "canvas-resize-handles");
    try {
      await toCanvas(a, "a");
      await zoomTo50(a, "a");
      const s1 = await seedShape(a, "a", "rect", { x: -400, y: 0, w: 120, h: 80 });
      const s2 = await seedShape(a, "a", "ellipse", { x: 400, y: 0, w: 120, h: 80 });
      const center = await canvasCenter(a, "a");

      // The marquee crosses both shapes (at 50% they stand at ±200px).
      await a.mouse.move(center.x - 260, center.y - 60);
      await a.mouse.down();
      await a.mouse.move(center.x + 260, center.y + 60, { steps: 8 });
      await a.mouse.up();
      expect(await handles(a, "a").count()).toBe(0);

      // A single click selection stands the eight box handles. The
      // empty-canvas click first: a group-member click keeps the group
      // (the group-aware selection), so the selection must be cleared
      // before the single pick.
      await a.mouse.click(center.x + 300, center.y);
      await a.mouse.click(center.x - 200, center.y);
      expect(await handles(a, "a").count()).toBe(1);
      expect(await handles(a, "a").locator('[data-slot="docblocks/canvas-handle"]').count()).toBe(8);
      expect(await handle(a, "a", "nw").count()).toBe(1);
      expect(s1).toBeTruthy();
      expect(s2).toBeTruthy();
    } finally {
      await close();
    }
  });

  test("the page miniature stands the box handles", async ({ browser }) => {
    const { a, close } = await twoPanes(browser, "canvas-page-handles");
    try {
      await toCanvas(a, "a");
      // The page card is large: zoom to 25% so its box handles stand on
      // screen (the card's half-height is 120px at 25%).
      const zoom = zoomToolbar(a, "a");
      for (let i = 0; i < 8; i += 1) await zoom.getByLabel("Zoom out").click();
      expect(await zoom.getByLabel("Reset zoom").textContent()).toBe("25%");

      const root = await a.evaluate(() => {
        const docs = window.__paneDocs;
        return docs?.a?.meta.id ?? null;
      });
      expect(root).toBeTruthy();

      // The card's bottom padding (non-contenteditable) click selects the
      // page (the no-op press writes nothing) and stands the eight box
      // handles.
      const center = await canvasCenter(a, "a");
      await a.mouse.click(center.x, center.y + 100);
      expect(await handles(a, "a").count()).toBe(1);
      expect(await handles(a, "a").locator('[data-slot="docblocks/canvas-handle"]').count()).toBe(8);
      expect(await handle(a, "a", "nw").count()).toBe(1);
    } finally {
      await close();
    }
  });

  test("the resize drag stands no native text selection (the shape's text overlay)", async ({ browser }) => {
    const { a, close } = await twoPanes(browser, "canvas-resize-noselection");
    try {
      await toCanvas(a, "a");
      await zoomTo50(a, "a");
      // The seeded shape carries text (the HTML overlay stands the
      // selectable text the drag would otherwise sweep).
      const shape = await a.evaluate(() => {
        const doc = window.__paneDocs?.a ?? null;
        if (doc === null) throw new Error("the pane's doc is not mounted");
        const json = doc.toJSON();
        const surfaceId = Object.entries(json.blocks).find(([, block]) => block.type === "surface")?.[0];
        const surface = surfaceId !== undefined ? surfaceId : doc.insertBlock("surface");
        const id = doc.insertBlock("shape", { variant: "rect", text: "resize me" }, { parent: surface });
        doc.setGeometry(id, { x: 0, y: 0, w: 200, h: 100 });
        return id;
      });

      const center = await canvasCenter(a, "a");
      await selectShape(a, "a", center);
      const selText = () => a.evaluate(() => window.getSelection()?.toString() ?? "");

      // The e handle dragged INWARD (left): the pointer runs over the
      // shape's text overlay. The native text selection must stand none
      // (the press is prevented — no caret / selection on the overlay).
      const start = await handleCenter(a, "a", "e");
      await a.mouse.move(start.x, start.y);
      await a.mouse.down();
      await a.mouse.move(start.x - 40, start.y, { steps: 6 });
      expect(await selText()).toBe("");
      await a.mouse.up();
      expect(await selText()).toBe("");
      // The resize still commits (the width shrank, the center re-derived).
      expect((await blockShapes(a, "a"))[shape]?.geometry).toEqual({ x: -40, y: 0, w: 120, h: 100 });
    } finally {
      await close();
    }
  });

  test("the resize preview redraws the figure box-proportional in real time (the viewBox follows the live box)", async ({
    browser,
  }) => {
    const { a, close } = await twoPanes(browser, "canvas-resize-liveredraw");
    try {
      await toCanvas(a, "a");
      await zoomTo50(a, "a");
      const shape = await a.evaluate(() => {
        const doc = window.__paneDocs?.a ?? null;
        if (doc === null) throw new Error("the pane's doc is not mounted");
        const json = doc.toJSON();
        const surfaceId = Object.entries(json.blocks).find(([, block]) => block.type === "surface")?.[0];
        const surface = surfaceId !== undefined ? surfaceId : doc.insertBlock("surface");
        const id = doc.insertBlock("shape", { variant: "rect", text: "resize me" }, { parent: surface });
        doc.setGeometry(id, { x: 0, y: 0, w: 200, h: 100 });
        return id;
      });

      const center = await canvasCenter(a, "a");
      await selectShape(a, "a", center);
      const shapeSvg = a.locator(`[data-slot="docblocks/shape"][data-block-id="${shape}"]`);

      // The e handle dragged OUTWARD (enlarge): mid-drag the figure's
      // viewBox stands the LIVE box (not the committed one) — the figure
      // redraws box-proportional (no letterbox freeze on the enlarge).
      const start = await handleCenter(a, "a", "e");
      await a.mouse.move(start.x, start.y);
      await a.mouse.down();
      await a.mouse.move(start.x + 40, start.y, { steps: 6 });
      await expect.poll(async () => await shapeSvg.getAttribute("viewBox")).toBe("0 0 280 100");
      await a.mouse.up();

      // The commit stands the same numbers (no jump on the release — the
      // preview and the commit stand from one number).
      expect((await blockShapes(a, "a"))[shape]?.geometry).toEqual({ x: 40, y: 0, w: 280, h: 100 });
    } finally {
      await close();
    }
  });
});
