// The canvas's transparent figures: a figure set to no fill (`fill: "none"`)
// stands its OUTLINE's band as the press zone — its interior passes the press
// through to what lies beneath — and the band follows the figure's own
// geometry (the rect's edge, the ellipse's arc, the freehand stroke's
// polyline), not its bounding box. A figure with an absent fill stays a
// normal figure (the whole box is its zone).
import { type Page, expect, test } from "@playwright/test";

import { SETTLE, canvasCenter, canvasView, toCanvas, twoPanes } from "./helpers";

interface CanvasBlock {
  type: string;
  geometry?: { x: number; y: number; w: number; h: number };
  attrs?: Record<string, unknown>;
}

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

/** The block's wrapper (the positioned item). */
const item = (page: Page, client: "a" | "b", id: string) =>
  canvasView(page, client).locator(`[data-slot="docblocks/canvas-item"][data-block-id="${id}"]`);

/**
 * A screen point for the block's block-local px (the wrapper's screen box
 * over the geometry's size stands the zoom / pan's mapping — the local
 * coordinates are the figure's own).
 */
async function pointOf(
  page: Page,
  client: "a" | "b",
  id: string,
  localX: number,
  localY: number
): Promise<{ x: number; y: number }> {
  const block = (await docBlocks(page, client))[id]!;
  const geometry = block.geometry!;
  const box = (await item(page, client, id).boundingBox())!;
  const zoom = box.width / geometry.w;
  return { x: box.x + localX * zoom, y: box.y + localY * zoom };
}

/** The selected canvas item ids. */
async function selectedIds(page: Page, client: "a" | "b"): Promise<string[]> {
  return page
    .locator(`[data-testid="doc-${client}"] [data-slot="docblocks/canvas-item"][data-selected]`)
    .evaluateAll((elements) => elements.map((element) => element.dataset.blockId ?? ""));
}

test.describe("the transparent figure's press zone (the outline's band)", () => {
  test("the transparent rect around a container: the interior passes through, the outline selects", async ({
    browser,
  }) => {
    const { a, close } = await twoPanes(browser, "canvas-nofill-rect");
    try {
      await toCanvas(a, "a");
      const { group, member, rect } = await a.evaluate(() => {
        const doc = window.__paneDocs?.a ?? null;
        if (doc === null) throw new Error("the pane's doc is not mounted");
        const json = doc.toJSON();
        const surfaceId = Object.entries(json.blocks).find(
          ([, block]) => (block as { type: string }).type === "surface"
        )?.[0];
        const surface = surfaceId !== undefined ? surfaceId : doc.insertBlock("surface");
        const group = doc.insertBlock("group", { members: [] }, { parent: surface });
        doc.setGeometry(group, { x: 300, y: 0, w: 240, h: 160 });
        const member = doc.insertBlock("shape", { variant: "rect", fill: "#dbeafe" }, { parent: surface });
        doc.setGeometry(member, { x: 300, y: 0, w: 100, h: 60 });
        doc.transact(() => {
          doc.updateBlock(group, { members: [member] });
        });
        // The annotation: the transparent rect over the container's box (the
        // paint order's tail — above the container).
        const rect = doc.insertBlock("shape", { variant: "rect", fill: "none" }, { parent: surface });
        doc.setGeometry(rect, { x: 300, y: 0, w: 320, h: 240 });
        return { group, member, rect };
      });
      await expect.poll(async () => (await docBlocks(a, "a"))[rect] !== undefined, SETTLE).toBe(true);
      // The member's face (the rect's interior): the press reaches the
      // figure under the annotation (the transparent interior passes it).
      const memberPoint = await pointOf(a, "a", member, 50, 30);
      await a.mouse.click(memberPoint.x, memberPoint.y);
      expect(await selectedIds(a, "a")).toEqual([member]);
      // The annotation's own outline: the press stands the rect.
      const outlinePoint = await pointOf(a, "a", rect, 1, 120);
      await a.mouse.click(outlinePoint.x, outlinePoint.y);
      expect(await selectedIds(a, "a")).toEqual([rect]);
      // The container stays reachable through its own border (the rect's
      // outline covers the container's top edge — the rect paints above).
      expect(await item(a, "a", group).getAttribute("data-selected")).toBeNull();
    } finally {
      await close();
    }
  });

  test("the transparent ellipse: the arc selects, the bounding box's corner passes through", async ({ browser }) => {
    const { a, close } = await twoPanes(browser, "canvas-nofill-ellipse");
    try {
      await toCanvas(a, "a");
      const ellipse = await a.evaluate(() => {
        const doc = window.__paneDocs?.a ?? null;
        if (doc === null) throw new Error("the pane's doc is not mounted");
        const json = doc.toJSON();
        const surfaceId = Object.entries(json.blocks).find(
          ([, block]) => (block as { type: string }).type === "surface"
        )?.[0];
        const surface = surfaceId !== undefined ? surfaceId : doc.insertBlock("surface");
        const ellipse = doc.insertBlock("shape", { variant: "ellipse", fill: "none" }, { parent: surface });
        doc.setGeometry(ellipse, { x: 0, y: 0, w: 240, h: 160 });
        return ellipse;
      });
      await expect.poll(async () => (await docBlocks(a, "a"))[ellipse] !== undefined, SETTLE).toBe(true);
      // The left vertex (the arc's point): the press stands the ellipse.
      const vertex = await pointOf(a, "a", ellipse, 1, 80);
      await a.mouse.click(vertex.x, vertex.y);
      expect(await selectedIds(a, "a")).toEqual([ellipse]);
      // The bounding box's top-left corner (inside the box, outside the
      // ellipse): the press passes through to the page miniature (the card's
      // move stands the root, not the ellipse).
      const corner = await pointOf(a, "a", ellipse, 20, 20);
      await a.mouse.click(corner.x, corner.y);
      expect(await selectedIds(a, "a")).not.toContain(ellipse);
    } finally {
      await close();
    }
  });

  test("the freehand stroke: the polyline selects, the box's inside passes through", async ({ browser }) => {
    const { a, close } = await twoPanes(browser, "canvas-nofill-freehand");
    try {
      await toCanvas(a, "a");
      const stroke = await a.evaluate(() => {
        const doc = window.__paneDocs?.a ?? null;
        if (doc === null) throw new Error("the pane's doc is not mounted");
        const json = doc.toJSON();
        const surfaceId = Object.entries(json.blocks).find(
          ([, block]) => (block as { type: string }).type === "surface"
        )?.[0];
        const surface = surfaceId !== undefined ? surfaceId : doc.insertBlock("surface");
        // The pen's stroke (the block-local points inside the bbox): a V.
        const stroke = doc.insertBlock(
          "shape",
          {
            variant: "rect",
            fill: "none",
            points: [
              [0, 0],
              [100, 100],
              [200, 0],
            ],
          },
          { parent: surface }
        );
        doc.setGeometry(stroke, { x: 0, y: 0, w: 200, h: 100 });
        return stroke;
      });
      await expect.poll(async () => (await docBlocks(a, "a"))[stroke] !== undefined, SETTLE).toBe(true);
      // A point of the stroke's line (the V's vertex).
      const line = await pointOf(a, "a", stroke, 100, 100);
      await a.mouse.click(line.x, line.y);
      expect(await selectedIds(a, "a")).toEqual([stroke]);
      // The box's upper area (inside the bbox, between the V's arms — far
      // from the stroke in screen px, whatever the zoom): the press passes
      // through.
      const field = await pointOf(a, "a", stroke, 100, 5);
      await a.mouse.click(field.x, field.y);
      expect(await selectedIds(a, "a")).not.toContain(stroke);
    } finally {
      await close();
    }
  });

  test("a figure with an absent fill stands the whole box (the normal figure)", async ({ browser }) => {
    const { a, close } = await twoPanes(browser, "canvas-nofill-absent");
    try {
      await toCanvas(a, "a");
      const shape = await a.evaluate(() => {
        const doc = window.__paneDocs?.a ?? null;
        if (doc === null) throw new Error("the pane's doc is not mounted");
        const json = doc.toJSON();
        const surfaceId = Object.entries(json.blocks).find(
          ([, block]) => (block as { type: string }).type === "surface"
        )?.[0];
        const surface = surfaceId !== undefined ? surfaceId : doc.insertBlock("surface");
        const shape = doc.insertBlock("shape", { variant: "rect" }, { parent: surface });
        doc.setGeometry(shape, { x: 0, y: 0, w: 240, h: 160 });
        return shape;
      });
      await expect.poll(async () => (await docBlocks(a, "a"))[shape] !== undefined, SETTLE).toBe(true);
      // The centre (the box's interior): an absent fill stands the box's
      // zone.
      const center = await canvasCenter(a, "a");
      await a.mouse.click(center.x, center.y);
      expect(await selectedIds(a, "a")).toEqual([shape]);
    } finally {
      await close();
    }
  });
});
