// The canvas container / frame title chip over the screen layer: the chip
// stands above the world's paint order (a filled figure covering the box —
// and the chip's own seat above its top edge — does not take the chip's
// press), the press keeps the item's contract (the selection + the move
// over the wire), the chip keeps its on-screen size over the zoom and rides
// the camera, and an off-viewport chip renders no DOM (the culling's stand).
import { type Page, expect, test } from "@playwright/test";

import { SETTLE, canvasCenter, canvasView, toCanvas, twoPanes } from "./helpers";

interface CanvasBlock {
  type: string;
  geometry?: { x: number; y: number; w: number; h: number };
  attrs?: Record<string, unknown>;
}

/** Steps the zoom over the toolbar until the readout stands the target. */
async function zoomTo(page: Page, action: "Zoom in" | "Zoom out", target: string): Promise<void> {
  const toolbar = page.getByRole("toolbar", { name: "Canvas zoom" });
  const readout = toolbar.getByLabel("Reset zoom");
  for (let i = 0; i < 60 && (await readout.textContent()) !== target; i += 1) {
    await toolbar.getByLabel(action).click();
  }
  await expect(readout).toHaveText(target);
}

/** The chip's seat (the screen layer's positioned box per block). */
const seat = (page: Page, id: string) =>
  page.locator(`[data-slot="docblocks/canvas-title-chip"][data-block-id="${id}"]`);

/** The block's canvas-item wrapper. */
const item = (page: Page, client: "a" | "b", id: string) =>
  canvasView(page, client).locator(`[data-slot="docblocks/canvas-item"][data-block-id="${id}"]`);

async function docBlocks(page: Page, client: "a" | "b"): Promise<Record<string, CanvasBlock>> {
  return page.evaluate(
    ({ client }) => {
      const doc = (client === "a" ? window.__paneDocs?.a : window.__paneDocs?.b) ?? null;
      if (doc === null) return {};
      const json = doc.toJSON();
      const out: Record<string, CanvasBlock> = {};
      for (const [id, block] of Object.entries(json.blocks)) out[id] = block as CanvasBlock;
      return out;
    },
    { client }
  );
}

/**
 * The covered scene: the titled container at the canvas's center and a
 * filled figure painted over the whole box — including the chip's seat
 * above the box's top edge, which is the occlusion the screen layer has to
 * survive.
 */
async function seedCovered(page: Page, client: "a" | "b"): Promise<{ group: string; cover: string }> {
  return page.evaluate(
    ({ client }) => {
      const doc = (client === "a" ? window.__paneDocs?.a : window.__paneDocs?.b) ?? null;
      if (doc === null) throw new Error("the pane's doc is not mounted");
      const json = doc.toJSON();
      const surfaceId = Object.entries(json.blocks).find(
        ([, block]) => (block as { type: string }).type === "surface"
      )?.[0];
      const surface = surfaceId !== undefined ? surfaceId : doc.insertBlock("surface");
      const group = doc.insertBlock("group", { members: [], title: "covered" }, { parent: surface });
      doc.setGeometry(group, { x: 0, y: 0, w: 240, h: 160 });
      const cover = doc.insertBlock("shape", { variant: "rect", fill: "#dbeafe" }, { parent: surface });
      doc.setGeometry(cover, { x: 0, y: 0, w: 320, h: 240 });
      return { group, cover };
    },
    { client }
  );
}

test.describe("the canvas title chip over the screen layer", () => {
  test("the covered container's chip stands over the figure and drags the box", async ({ browser }) => {
    const { a, b, close } = await twoPanes(browser, "chip-covered");
    try {
      await toCanvas(a, "a");
      await toCanvas(b, "b");
      const { group, cover } = await seedCovered(a, "a");
      await expect.poll(async () => (await docBlocks(b, "b"))[group] !== undefined, SETTLE).toBe(true);
      const chip = seat(a, group).locator("[data-slot='docblocks/group-title']");
      await expect(chip).toHaveCount(1);
      await expect(chip).toHaveText("covered");
      const chipBox = (await chip.boundingBox())!;
      // The chip is the topmost element at its own center: the covering
      // figure paints over the box, the chip's layer does not lose the
      // press.
      const topmost = await a.evaluate(
        ({ x, y }) => {
          const element = document.elementFromPoint(x, y);
          return element?.closest("[data-slot='docblocks/group-title']") !== null;
        },
        { x: chipBox.x + chipBox.width / 2, y: chipBox.y + chipBox.height / 2 }
      );
      expect(topmost, "the chip stands over the covering figure").toBe(true);
      // The press selects the container (not the figure under the pointer).
      await a.mouse.click(chipBox.x + chipBox.width / 2, chipBox.y + chipBox.height / 2);
      expect(await item(a, "a", group).getAttribute("data-selected")).not.toBeNull();
      expect(await item(a, "a", cover).getAttribute("data-selected")).toBeNull();
      // The drag over the chip moves the box (the item's press contract):
      // the container's geometry stands the delta over the wire, the
      // figure's stands.
      const before = await docBlocks(a, "a");
      await a.mouse.move(chipBox.x + chipBox.width / 2, chipBox.y + chipBox.height / 2);
      await a.mouse.down();
      await a.mouse.move(chipBox.x + chipBox.width / 2 + 40, chipBox.y + chipBox.height / 2 + 20, { steps: 4 });
      await a.mouse.up();
      await expect
        .poll(async () => (await docBlocks(b, "b"))[group]?.geometry, SETTLE)
        .toEqual({
          x: before[group]!.geometry!.x + 40,
          y: before[group]!.geometry!.y + 20,
          w: 240,
          h: 160,
        });
      expect((await docBlocks(b, "b"))[cover]?.geometry).toEqual(before[cover]!.geometry);
    } finally {
      await close();
    }
  });

  test("the chip keeps its on-screen size over the zoom and rides the camera", async ({ browser }) => {
    const { a, close } = await twoPanes(browser, "chip-zoom-pan");
    try {
      await toCanvas(a, "a");
      const { group, cover } = await seedCovered(a, "a");
      const chip = seat(a, group).locator("[data-slot='docblocks/group-title']");
      await expect(chip).toHaveCount(1);
      const h100 = (await chip.boundingBox())!.height;
      // The seat maps the box through the zoom (the chip's own offsets stay
      // screen px, so the chip's size does not follow the world's scale).
      await zoomTo(a, "Zoom in", "400%");
      expect((await chip.boundingBox())!.height).toBeCloseTo(h100, 1);
      const seat400 = (await seat(a, group).boundingBox())!;
      expect(seat400.width).toBeCloseTo(240 * 4, 0);
      expect(seat400.height).toBeCloseTo(160 * 4, 0);
      await zoomTo(a, "Zoom out", "25%");
      expect((await chip.boundingBox())!.height).toBeCloseTo(h100, 1);
      const seat25 = (await seat(a, group).boundingBox())!;
      expect(seat25.width).toBeCloseTo(240 * 0.25, 0);
      // The camera: the wheel's pan moves the chip with the world (the
      // figure's box stands the same delta — the seat is the box's screen
      // projection, not a fixed screen anchor).
      const center = await canvasCenter(a, "a");
      await a.mouse.move(center.x, center.y);
      const chipBefore = (await chip.boundingBox())!;
      const figureBefore = (await item(a, "a", cover).boundingBox())!;
      await a.mouse.wheel(0, 120);
      const chipAfter = (await chip.boundingBox())!;
      const figureAfter = (await item(a, "a", cover).boundingBox())!;
      expect(figureBefore.y - figureAfter.y).toBeCloseTo(120, 1);
      expect(chipBefore.y - chipAfter.y).toBeCloseTo(120, 1);
    } finally {
      await close();
    }
  });

  test("an off-viewport chip renders no DOM (the culling's stand)", async ({ browser }) => {
    const { a, close } = await twoPanes(browser, "chip-culling");
    try {
      await toCanvas(a, "a");
      const { group, cover } = await seedCovered(a, "a");
      const chip = seat(a, group).locator("[data-slot='docblocks/group-title']");
      await expect(chip).toHaveCount(1);
      // Pan the world far off the viewport (the wheel's pan moves 1:1): the
      // culled block's chip stands no DOM, the block itself stays in the
      // document.
      const center = await canvasCenter(a, "a");
      await a.mouse.move(center.x, center.y);
      for (let i = 0; i < 15; i += 1) await a.mouse.wheel(0, 120);
      await expect.poll(async () => await item(a, "a", cover).count(), SETTLE).toBe(0);
      expect(await seat(a, group).count()).toBe(0);
      expect((await docBlocks(a, "a"))[group]?.type).toBe("group");
      // The camera's return stands the chip back.
      for (let i = 0; i < 15; i += 1) await a.mouse.wheel(0, -120);
      await expect(seat(a, group).locator("[data-slot='docblocks/group-title']")).toHaveCount(1);
    } finally {
      await close();
    }
  });
});
