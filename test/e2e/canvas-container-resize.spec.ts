import { type Browser, type Page, expect, test } from "@playwright/test";

import { switchPaneView } from "./helpers";

// The container's resize's per-edge union clamp (2026-10-22): a container's
// box shrinks only up to its members' union (each edge stops at the members'
// bounding shell), and grows unlimited. The preview = the commit (one source);
// the overshoot-release is the clamped box (not raw); both panes over the
// wire; the undo reverts to the previous box.
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
  await switchPaneView(page, client, "canvas");
}

const canvasView = (page: Page, client: "a" | "b") =>
  page.locator(`[data-testid="doc-${client}"] [data-slot="docblocks/canvas-view"]`);

async function canvasCenter(page: Page, client: "a" | "b"): Promise<{ x: number; y: number }> {
  const box = (await canvasView(page, client).boundingBox())!;
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** A canvas point at 100% zoom / no pan stands at the center + the offset. */
function screenAt(center: { x: number; y: number }, x: number, y: number): { x: number; y: number } {
  return { x: center.x + x, y: center.y + y };
}

interface CanvasBlock {
  type: string;
  geometry?: { x: number; y: number; w: number; h: number };
  attrs?: Record<string, unknown>;
}

async function docBlocks(page: Page, client: "a" | "b"): Promise<Record<string, CanvasBlock>> {
  return page.evaluate(
    ({ client }) => {
      const docs = window.__paneDocs;
      const doc = (client === "a" ? docs?.a : docs?.b) ?? null;
      if (doc === null) return {};
      const json = doc.toJSON();
      const out: Record<string, CanvasBlock> = {};
      for (const [id, block] of Object.entries(json.blocks)) out[id] = block as CanvasBlock;
      return out;
    },
    { client }
  );
}

const handles = (page: Page, client: "a" | "b") =>
  canvasView(page, client).locator('[data-slot="docblocks/canvas-handles"]');

const handle = (page: Page, client: "a" | "b", id: string) => handles(page, client).locator(`[data-handle="${id}"]`);

async function handleCenter(page: Page, client: "a" | "b", id: string): Promise<{ x: number; y: number }> {
  const box = (await handle(page, client, id).boundingBox())!;
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/**
 * The scene: a container (a group with its own free box) at the origin
 * containing two member shapes (the union's left edge -70, right edge 70,
 * top -20, bottom 20 → the union {x:0, y:0, w:140, h:40}). The container's
 * box {x:0, y:0, w:200, h:120} (left -100, right 100, top -60, bottom 60)
 * covers the union.
 */
async function seedScene(page: Page, client: "a" | "b"): Promise<{ group: string; a: string; b: string }> {
  return page.evaluate(
    ({ client }) => {
      const docs = window.__paneDocs;
      const doc = (client === "a" ? docs?.a : docs?.b) ?? null;
      if (doc === null) throw new Error("the pane's doc is not mounted");
      const json = doc.toJSON();
      const surfaceId = Object.entries(json.blocks).find(
        ([, block]) => (block as { type: string }).type === "surface"
      )?.[0];
      const surface = surfaceId !== undefined ? surfaceId : doc.insertBlock("surface");
      const group = doc.insertBlock("group", { members: [] }, { parent: surface });
      doc.setGeometry(group, { x: 0, y: 0, w: 200, h: 120 });
      const a = doc.insertBlock("shape", { variant: "rect" }, { parent: surface });
      doc.setGeometry(a, { x: -50, y: 0, w: 40, h: 40 });
      const b = doc.insertBlock("shape", { variant: "rect" }, { parent: surface });
      doc.setGeometry(b, { x: 50, y: 0, w: 40, h: 40 });
      doc.transact(() => {
        doc.updateBlock(group, { members: [a, b] });
      });
      return { group, a, b };
    },
    { client }
  );
}

/** Presses the container's top border (the interior is pointer-transparent). */
async function selectContainer(page: Page, client: "a" | "b", geometry: CanvasBlock["geometry"]): Promise<void> {
  const center = await canvasCenter(page, client);
  const border = screenAt(center, geometry!.x, geometry!.y - geometry!.h / 2);
  await page.mouse.move(border.x, border.y);
  await page.mouse.click(border.x, border.y);
}

test.describe("the container's resize's per-edge union clamp", () => {
  test("the w handle's shrink stops at the members' union (overshoot-release clamped, over the wire; the undo reverts)", async ({
    browser,
  }) => {
    const { a, b, close } = await twoPanes(browser, "container-resize-w");
    try {
      await toCanvas(a, "a");
      await toCanvas(b, "b");
      const { group } = await seedScene(a, "a");
      await expect.poll(async () => (await docBlocks(b, "b"))[group] !== undefined, SETTLE).toBe(true);

      const blocks = await docBlocks(a, "a");
      await selectContainer(a, "a", blocks[group]!.geometry);
      expect(await handles(a, "a").count()).toBe(1);

      // The w handle (the container's west edge, canvas x=-100): a +40px
      // screen drag (100% zoom) would move the left edge to -60 — past the
      // members' union left edge (-70). The clamp holds it at -70.
      const start = await handleCenter(a, "a", "w");
      await a.mouse.move(start.x, start.y);
      await a.mouse.down();
      await a.mouse.move(start.x + 40, start.y, { steps: 6 });
      await a.mouse.up();

      // The clamped box: the left edge stands at the union's left edge (-70),
      // the other edges stand → {x:15, y:0, w:170, h:120} (over the wire).
      const expected = { x: 15, y: 0, w: 170, h: 120 };
      expect((await docBlocks(a, "a"))[group]?.geometry).toEqual(expected);
      await expect.poll(async () => (await docBlocks(b, "b"))[group]?.geometry, SETTLE).toEqual(expected);

      // The undo reverts to the previous box (one setGeometry, one step).
      await a.keyboard.press("Control+z");
      await expect
        .poll(async () => (await docBlocks(b, "b"))[group]?.geometry, SETTLE)
        .toEqual({
          x: 0,
          y: 0,
          w: 200,
          h: 120,
        });
    } finally {
      await close();
    }
  });

  test("the e handle's grow is unlimited (the union clamp does not bind the outward edge)", async ({ browser }) => {
    const { a, close } = await twoPanes(browser, "container-resize-grow");
    try {
      await toCanvas(a, "a");
      const { group } = await seedScene(a, "a");
      const blocks = await docBlocks(a, "a");
      await selectContainer(a, "a", blocks[group]!.geometry);

      // The e handle (the container's east edge, canvas x=100): a +60px
      // screen drag grows the width past the members' union (no clamp).
      const start = await handleCenter(a, "a", "e");
      await a.mouse.move(start.x, start.y);
      await a.mouse.down();
      await a.mouse.move(start.x + 60, start.y, { steps: 6 });
      await a.mouse.up();

      // The right edge grows to 160 (100 + 60); the box stands {x:30, y:0,
      // w:260, h:120}.
      expect((await docBlocks(a, "a"))[group]?.geometry).toEqual({ x: 30, y: 0, w: 260, h: 120 });
    } finally {
      await close();
    }
  });
});
