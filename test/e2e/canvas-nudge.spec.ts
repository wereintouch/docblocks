import { type Browser, type Page, expect, test } from "@playwright/test";

import { switchPaneView } from "./helpers";

// The canvas arrow-key nudge: the
// selection's canvas items shift by the world px step (the Arrow = 10,
// the Shift+Arrow = 50 — the zoom-blind data's space, the step stands the
// same over any zoom). Each press is a real move (one setGeometry per
// item in one transact — one undo step, one wire update), the selection
// stands on the same items, and the page never scrolls over the arrows.
const RELAY = "ws://localhost:5199";
const SETTLE = { timeout: 15_000 };

type BlockJson = {
  type: string;
  geometry?: { x: number; y: number; w: number; h: number };
  attrs?: Record<string, unknown>;
  content?: unknown[];
};

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
  await switchPaneView(page, client, "canvas");
}

const canvasView = (page: Page, client: "a" | "b") =>
  page.locator(`[data-testid="doc-${client}"] [data-slot="docblocks/canvas-view"]`);

const zoomToolbar = (page: Page, client: "a" | "b") =>
  canvasView(page, client).getByRole("toolbar", { name: "Canvas zoom" });

async function canvasCenter(page: Page, client: "a" | "b"): Promise<{ x: number; y: number }> {
  const box = (await canvasView(page, client).boundingBox())!;
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** Zoom the pane to 50% (five 10% steps down from 100%). */
async function zoomTo50(page: Page, client: "a" | "b"): Promise<void> {
  const zoom = zoomToolbar(page, client);
  for (let i = 0; i < 5; i += 1) await zoom.getByLabel("Zoom out").click();
  expect(await zoom.getByLabel("Reset zoom").textContent()).toBe("50%");
}

/** The pane's doc blocks (the JSON snapshot — the type / geometry / attrs). */
async function blocks(page: Page, client: "a" | "b"): Promise<Record<string, BlockJson>> {
  return page.evaluate(
    ({ client }) => {
      const docs = window.__paneDocs;
      const doc = (client === "a" ? docs?.a : docs?.b) ?? null;
      if (doc === null) return {};
      const json = doc.toJSON();
      const out: Record<string, BlockJson> = {};
      for (const [id, block] of Object.entries(json.blocks)) {
        const entry = block as BlockJson;
        out[id] = { type: entry.type, geometry: entry.geometry, attrs: entry.attrs, content: entry.content };
      }
      return out;
    },
    { client }
  );
}

/** The pane's selected canvas item ids. */
async function selectedIds(page: Page, client: "a" | "b"): Promise<string[]> {
  return page
    .locator(`[data-testid="doc-${client}"] [data-slot="docblocks/canvas-item"][data-selected]`)
    .evaluateAll((els) => els.map((el) => el.dataset.blockId ?? ""));
}

/** The world → screen point (the pane's zoom factor / the container center). */
async function worldPoint(
  page: Page,
  client: "a" | "b",
  x: number,
  y: number,
  zoom = 1
): Promise<{ x: number; y: number }> {
  const center = await canvasCenter(page, client);
  return { x: center.x + x * zoom, y: center.y + y * zoom };
}

/**
 * Seeds the deterministic scene: the two shapes (A at (-300, 0), B at
 * (300, 0)) and the page miniature moved off the origin. Returns the ids.
 */
async function seedScene(page: Page, client: "a" | "b"): Promise<{ a: string; b: string }> {
  return page.evaluate(
    ({ client }) => {
      const docs = window.__paneDocs;
      const doc = (client === "a" ? docs?.a : docs?.b) ?? null;
      if (doc === null) throw new Error("the pane's doc is not mounted");
      const json = doc.toJSON();
      const surfaceId = Object.entries(json.blocks).find(([, block]) => block.type === "surface")?.[0];
      const surface = surfaceId !== undefined ? surfaceId : doc.insertBlock("surface");
      const a = doc.insertBlock("shape", { variant: "rect" }, { parent: surface });
      doc.setGeometry(a, { x: -300, y: 0, w: 100, h: 100 });
      const b = doc.insertBlock("shape", { variant: "ellipse" }, { parent: surface });
      doc.setGeometry(b, { x: 300, y: 0, w: 100, h: 100 });
      // The page miniature off the origin (the default page size — the
      // root's fresh geometry is complete).
      doc.setGeometry(doc.meta.id, { x: 0, y: -900, w: 720, h: 960 });
      return { a, b };
    },
    { client }
  );
}

test.describe("the canvas arrow-key nudge", () => {
  test("the arrow stands the world px nudge (the one undo step, the wire, the selection stands, the page stands)", async ({
    browser,
  }) => {
    const { a, b, close } = await twoPanes(browser, "canvas-nudge");
    try {
      await toCanvas(a, "a");
      await toCanvas(b, "b");
      const { a: aId, b: bId } = await seedScene(a, "a");

      // The selection: the click (the focus parks on the container) + the
      // shift-click (the additive toggle — the real keyboard's Shift, the
      // Playwright's mouse modifiers do not reach the pointerdown).
      const pA = await worldPoint(a, "a", -300, 0);
      await a.mouse.click(pA.x, pA.y);
      expect(await selectedIds(a, "a")).toEqual([aId]);
      const pB = await worldPoint(a, "a", 300, 0);
      await a.keyboard.down("Shift");
      await a.mouse.click(pB.x, pB.y);
      await a.keyboard.up("Shift");
      expect(await selectedIds(a, "a")).toEqual([aId, bId]);

      // The page stands over the arrows (the preventDefault's contract).
      const scrollBefore = await a.evaluate(() => window.scrollY);

      // The ArrowLeft: both items shift the −10 x (the world px).
      await a.keyboard.press("ArrowLeft");
      await expect
        .poll(async () => (await blocks(a, "a"))[aId]?.geometry, SETTLE)
        .toEqual({ x: -310, y: 0, w: 100, h: 100 });
      expect((await blocks(a, "a"))[bId]?.geometry).toEqual({ x: 290, y: 0, w: 100, h: 100 });
      // The selection stands on the same items (the nudge clears nothing).
      expect(await selectedIds(a, "a")).toEqual([aId, bId]);

      // The Shift+ArrowUp: the −50 y (the multiplier's stand).
      await a.keyboard.press("Shift+ArrowUp");
      await expect
        .poll(async () => (await blocks(a, "a"))[aId]?.geometry, SETTLE)
        .toEqual({ x: -310, y: -50, w: 100, h: 100 });
      expect((await blocks(a, "a"))[bId]?.geometry).toEqual({ x: 290, y: -50, w: 100, h: 100 });

      // The wire: the other pane's JSON stands from the same attr.
      await expect
        .poll(async () => (await blocks(b, "b"))[aId]?.geometry, SETTLE)
        .toEqual({
          x: -310,
          y: -50,
          w: 100,
          h: 100,
        });
      expect((await blocks(b, "b"))[bId]?.geometry).toEqual({ x: 290, y: -50, w: 100, h: 100 });

      // The one undo step per press: the undo reverts the shift nudge (the
      // y stands back, the x stands), the next undo the arrow's; the redo
      // stands the arrow's nudge back.
      await a.keyboard.press("Control+z");
      await expect
        .poll(async () => (await blocks(a, "a"))[aId]?.geometry, SETTLE)
        .toEqual({ x: -310, y: 0, w: 100, h: 100 });
      await a.keyboard.press("Control+z");
      await expect
        .poll(async () => (await blocks(a, "a"))[aId]?.geometry, SETTLE)
        .toEqual({ x: -300, y: 0, w: 100, h: 100 });
      await a.keyboard.press("Control+Shift+z");
      await expect
        .poll(async () => (await blocks(a, "a"))[aId]?.geometry, SETTLE)
        .toEqual({ x: -310, y: 0, w: 100, h: 100 });

      // The page stood (the arrows never scrolled it).
      expect(await a.evaluate(() => window.scrollY)).toBe(scrollBefore);
    } finally {
      await close();
    }
  });

  test("the zoom-blind step (the 50% zoom's stand — the world px stands)", async ({ browser }) => {
    const { a, close } = await twoPanes(browser, "canvas-nudge-zoom");
    try {
      await toCanvas(a, "a");
      const { a: aId } = await seedScene(a, "a");
      await zoomTo50(a, "a");
      const pA = await worldPoint(a, "a", -300, 0, 0.5);
      await a.mouse.click(pA.x, pA.y);
      expect(await selectedIds(a, "a")).toEqual([aId]);
      await a.keyboard.press("ArrowLeft");
      // The step stands the world px (the 10), not the screen px (the 5
      // at the 50% zoom).
      await expect
        .poll(async () => (await blocks(a, "a"))[aId]?.geometry, SETTLE)
        .toEqual({ x: -310, y: 0, w: 100, h: 100 });
    } finally {
      await close();
    }
  });

  test("the in-flight move session owns the keys (the arrow over the held press stands no nudge)", async ({
    browser,
  }) => {
    const { a, b, close } = await twoPanes(browser, "canvas-nudge-drag");
    try {
      await toCanvas(a, "a");
      await toCanvas(b, "b");
      const { a: aId } = await seedScene(a, "a");
      const pA = await worldPoint(a, "a", -300, 0);
      // The click stands the selection + the container's focus (the
      // hotkey's context).
      await a.mouse.click(pA.x, pA.y);
      expect(await selectedIds(a, "a")).toEqual([aId]);

      // The in-flight move: the second press over the selected item keeps
      // the group and stands the session (the focus parks on the
      // container); the arrow stands over the held press.
      await a.mouse.move(pA.x, pA.y);
      await a.mouse.down();
      await a.keyboard.press("ArrowLeft");
      // The no-op release (below the threshold — the session stands no
      // transact either).
      await a.mouse.up();

      // The session stood the keys: no nudge on either pane.
      expect((await blocks(a, "a"))[aId]?.geometry).toEqual({ x: -300, y: 0, w: 100, h: 100 });
      expect((await blocks(b, "b"))[aId]?.geometry).toEqual({ x: -300, y: 0, w: 100, h: 100 });
    } finally {
      await close();
    }
  });
});
