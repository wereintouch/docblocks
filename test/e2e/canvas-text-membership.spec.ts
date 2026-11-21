// The canvas-text's box's stands: the side insets from the box's edges (the
// shape's text's parity — the wrapper's horizontal padding over the
// border-box) and the container's membership (the drag-in / drag-out's
// indicators' stand, the release's commit over the wire).
import { type Page, expect, test } from "@playwright/test";

import { SETTLE, canvasCenter, canvasView, screenAt, toCanvas, twoPanes } from "./helpers";

interface CanvasBlock {
  type: string;
  geometry?: { x: number; y: number; w: number; h: number };
  attrs?: Record<string, unknown>;
  content?: { text: string; marks: Record<string, unknown> }[];
  children?: string[];
}

async function docBlocks(page: Page, client: "a" | "b"): Promise<Record<string, CanvasBlock>> {
  return page.evaluate(
    ({ client }) => {
      const docs = window.__paneDocs;
      const doc = (client === "a" ? docs?.a : docs?.b) ?? null;
      if (doc === null) return {};
      const json = doc.toJSON();
      const out: Record<string, CanvasBlock> = {};
      for (const [id, block] of Object.entries(json.blocks)) {
        out[id] = block as CanvasBlock;
      }
      return out;
    },
    { client }
  );
}

/** Wait for pane B's doc to carry the id over the wire. */
async function wireSynced(page: Page, client: "a" | "b", id: string): Promise<void> {
  await expect.poll(async () => (await docBlocks(page, client))[id] !== undefined, SETTLE).toBe(true);
}

/** The group's members from the doc. */
async function groupMembers(page: Page, client: "a" | "b", group: string): Promise<string[]> {
  const blocks = await docBlocks(page, client);
  return (blocks[group]?.attrs?.members as string[]) ?? [];
}

test.describe("the canvas-text (the reworked interaction)", () => {
  test("the side insets from the box's edges (the shape's text's parity: the wrapper's horizontal padding, the border-box's stand, the inner's shrink)", async ({
    browser,
  }) => {
    const { a, b, close } = await twoPanes(browser, "text-side-insets");
    try {
      await toCanvas(a, "a");
      await toCanvas(b, "b");
      // The 50% zoom (the empty canvas's stand — the card's screen's half-
      // span stands 180x240, the point's (±450, ±300) stands clear of it).
      const zoomToolbar = canvasView(a, "a").getByRole("toolbar", { name: "Canvas zoom" });
      for (let i = 0; i < 5; i += 1) await zoomToolbar.getByLabel("Zoom out").click();
      const zoom = parseInt((await zoomToolbar.getByLabel("Reset zoom").textContent()) ?? "50", 10) / 100;
      const center = await canvasCenter(a, "a");
      const point = screenAt(center, 450 * zoom, 300 * zoom);

      await a.mouse.dblclick(point.x, point.y);
      // The ghost's inner stands the same side inset (the commit's visual
      // continuity: the typed text stands where the committed text stands).
      const ghost = a.locator('[data-slot="docblocks/canvas-text-ghost-inner"]');
      expect(await ghost.count()).toBe(1);
      expect(await ghost.evaluate((el) => getComputedStyle(el).paddingLeft)).toBe("8px");

      // The commit's stand (the ghost's close, the real block's stand).
      await a.keyboard.type("Inset", { delay: 20 });
      const blocks = await docBlocks(a, "a");
      const textId = Object.entries(blocks).find(([, block]) => block.type === "canvas-text");
      expect(textId).not.toBeUndefined();
      const item = a.locator(`[data-slot="docblocks/canvas-item"][data-block-id="${textId![0]}"]`);
      // The border-box's stand (the preflight): the item's border box stands
      // the geometry — the selection's frame and the position are unmoved;
      // the horizontal padding (the rect's 8 px x) shrinks the text's wrap
      // width inside the box's edges.
      const box = await item.evaluate((el) => {
        const itemEl = el as HTMLElement;
        const cs = getComputedStyle(itemEl);
        const inner = itemEl.querySelector<HTMLElement>("[data-slot='docblocks/block-content']");
        return {
          padding: cs.padding,
          boxSizing: cs.boxSizing,
          itemWidth: itemEl.offsetWidth,
          innerWidth: inner !== null && "offsetWidth" in inner ? inner.offsetWidth : null,
        };
      });
      expect(box.padding).toBe("0px 8px");
      expect(box.boxSizing).toBe("border-box");
      expect(box.innerWidth).toBe(box.itemWidth - 16);
      await expect.poll(async () => await docBlocks(b, "b"), SETTLE).toEqual(blocks);
    } finally {
      await close();
    }
  });

  test("the container's membership: the drag-in's indicator + the release's commit over the wire; the drag-out's removal", async ({
    browser,
  }) => {
    const { a, b, close } = await twoPanes(browser, "text-membership");
    try {
      await toCanvas(a, "a");
      await toCanvas(b, "b");
      // The container (the right of the origin — the 240x160's box over the
      // text's 200x40: the text's box lands strictly inside) + the
      // canvas-text fully outside (the drag-in's source).
      const { group, text } = await a.evaluate(() => {
        const doc = window.__paneDocs?.a ?? null;
        if (doc === null) throw new Error("the pane's doc is not mounted");
        const surface = doc.insertBlock("surface");
        const group = doc.insertBlock("group", { members: [] }, { parent: surface });
        doc.setGeometry(group, { x: 200, y: 0, w: 240, h: 160 });
        const text = doc.insertBlock("canvas-text", undefined, { parent: surface });
        doc.setGeometry(text, { x: -100, y: 0, w: 200, h: 40 });
        doc.insertText(text, 0, "member");
        return { group, text };
      });
      await wireSynced(b, "b", group);
      await wireSynced(b, "b", text);
      const center = await canvasCenter(a, "a");

      // The drag-in: the first press's drag (the unselected's stand — the
      // canvas-text's inner's press stands the move session, not the
      // caret). The figure's box fully inside the container's box.
      const start = screenAt(center, -100, 0);
      await a.mouse.move(start.x, start.y);
      await a.mouse.down();
      // The text's center at the container's center (the box's strictly-
      // inside's stand over the container's larger box).
      const inside = screenAt(center, 200, -20);
      await a.mouse.move(inside.x, inside.y, { steps: 6 });
      // The green drop indicator stands over the text.
      await expect
        .poll(async () => a.locator('[data-slot="docblocks/canvas-drop-indicator"][data-drop="in"]').count())
        .toBe(1);
      await a.mouse.up();
      // The release joins the container (over the wire to pane B) + the
      // geometry's landing's stand.
      await expect.poll(async () => (await groupMembers(b, "b", group)).includes(text), SETTLE).toBe(true);
      const blocksA = await docBlocks(a, "a");
      expect(blocksA[text]?.geometry).toEqual({ x: 200, y: -20, w: 200, h: 40 });

      // The drag-out: the figure's box fully outside — the red indicator's
      // stand, the release leaves the container (over the wire). The
      // press stands over the block's selection (the shape's parity — the
      // selected block's press starts the move session too), so the empty
      // canvas's click clears the selection first.
      await a.mouse.click(screenAt(center, 0, 200).x, screenAt(center, 0, 200).y);
      const outStart = screenAt(center, 200, -20);
      await a.mouse.move(outStart.x, outStart.y);
      await a.mouse.down();
      const outside = screenAt(center, -150, -20);
      await a.mouse.move(outside.x, outside.y, { steps: 6 });
      await expect
        .poll(async () => a.locator('[data-slot="docblocks/canvas-drop-indicator"][data-drop="out"]').count())
        .toBe(1);
      await a.mouse.up();
      await expect.poll(async () => (await groupMembers(b, "b", group)).includes(text), SETTLE).toBe(false);
      const blocksAAfter = await docBlocks(a, "a");
      expect(blocksAAfter[text]?.geometry).toEqual({ x: -150, y: -20, w: 200, h: 40 });
    } finally {
      await close();
    }
  });
});
