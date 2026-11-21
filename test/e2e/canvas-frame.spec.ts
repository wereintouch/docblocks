// The canvas frame (the region boundary): the boundary's render (the
// transparent region marker — the border over the canvas's own background,
// no content copy: the canvas's own figures stand at their own positions,
// the frame is a region marker, not a window), the interior's transparency
// (the figure under the frame takes the press, the border takes the frame),
// the move's stand (the frame's geometry stands the delta, the figures'
// stand — the content does not ride the box's slide), and the delete's
// no-cascade stand (the frame goes, the figures stand).
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

/**
 * The frame's scene (the one surface): a rect + an ellipse fully inside
 * the frame's box region and the frame over the figures' region (the
 * boundary's stand — the childless box; the figures stand at their own
 * positions, the frame is a region marker, not a container).
 */
async function seedScene(page: Page, client: "a" | "b"): Promise<{ rect: string; ellipse: string; frame: string }> {
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
      const rect = doc.insertBlock("shape", { variant: "rect" }, { parent: surface });
      doc.setGeometry(rect, { x: -60, y: -40, w: 120, h: 80 });
      const ellipse = doc.insertBlock("shape", { variant: "ellipse" }, { parent: surface });
      doc.setGeometry(ellipse, { x: 60, y: 20, w: 80, h: 60 });
      const frame = doc.insertBlock("frame", undefined, { parent: surface });
      doc.setGeometry(frame, { x: 0, y: -20, w: 240, h: 160 });
      return { rect, ellipse, frame };
    },
    { client }
  );
}

/** Wait for pane B's doc to carry the id over the wire. */
async function wireSynced(page: Page, client: "a" | "b", id: string): Promise<void> {
  await expect.poll(async () => (await docBlocks(page, client))[id] !== undefined, SETTLE).toBe(true);
}

test.describe("the canvas frame (the region boundary)", () => {
  test("the boundary: the frame renders the region marker (the transparent box, the border, no content copy; the figures stand once)", async ({
    browser,
  }) => {
    const { a, close } = await twoPanes(browser, "frame-boundary");
    try {
      await toCanvas(a, "a");
      const { rect, frame } = await seedScene(a, "a");
      const frameItem = canvasView(a, "a").locator(`[data-slot="docblocks/canvas-item"][data-block-id="${frame}"]`);
      await frameItem.waitFor({ state: "visible" });
      // The boundary: the transparent region marker (no content copy, no
      // canvas background — the canvas's own figures stand behind it).
      const boundary = frameItem.locator('[data-slot="docblocks/frame-boundary"]');
      await expect(boundary).toHaveCount(1);
      const style = await boundary.evaluate((el) => {
        const cs = getComputedStyle(el);
        return { backgroundColor: cs.backgroundColor, boxShadow: cs.boxShadow };
      });
      expect(style.backgroundColor).toBe("rgba(0, 0, 0, 0)");
      expect(style.boxShadow).toContain("inset");
      // The content copy is absent (the canvas frame is a region marker —
      // the mirror's render stands on the page-frame block).
      expect(await frameItem.locator('[data-slot="docblocks/frame-window-content"]').count()).toBe(0);
      // The figures stand once (the originals, no copy — the boundary does
      // not duplicate the content).
      await expect
        .poll(async () =>
          canvasView(a, "a").locator(`[data-slot="docblocks/canvas-item"][data-block-id="${rect}"]`).count()
        )
        .toBe(1);
    } finally {
      await close();
    }
  });

  test("the frame's interior is transparent: the figure under the frame takes the press; the border takes the frame", async ({
    browser,
  }) => {
    const { a, close } = await twoPanes(browser, "frame-transparent");
    try {
      await toCanvas(a, "a");
      const { rect, frame } = await seedScene(a, "a");
      const center = await canvasCenter(a, "a");
      const rectItem = canvasView(a, "a").locator(`[data-slot="docblocks/canvas-item"][data-block-id="${rect}"]`);
      const frameItem = canvasView(a, "a").locator(`[data-slot="docblocks/canvas-item"][data-block-id="${frame}"]`);
      await frameItem.waitFor({ state: "visible" });
      // The rect's center (the figure under the frame's region, the frame
      // over in the z's order): the press falls through the frame's
      // transparent interior to the rect.
      const interior = screenAt(center, -60, -40);
      await a.mouse.click(interior.x, interior.y);
      expect(await rectItem.getAttribute("data-selected"), "the rect's selection").not.toBeNull();
      expect(await frameItem.getAttribute("data-selected"), "the frame's stand").toBeNull();
      // The frame's top border's midpoint (the hit band's stand, no figure
      // under the band): the press takes the frame, not the rect.
      const border = screenAt(center, 0, -100);
      await a.mouse.click(border.x, border.y);
      expect(await frameItem.getAttribute("data-selected"), "the frame's selection").not.toBeNull();
      expect(await rectItem.getAttribute("data-selected"), "the rect's stand").toBeNull();
    } finally {
      await close();
    }
  });

  test("the move: the frame's geometry stands the delta, the figures' stand (the boundary's move — the content does not ride the box's slide)", async ({
    browser,
  }) => {
    const { a, b, close } = await twoPanes(browser, "frame-move");
    try {
      await toCanvas(a, "a");
      await toCanvas(b, "b");
      const { rect, ellipse, frame } = await seedScene(a, "a");
      await wireSynced(b, "b", frame);
      const before = await docBlocks(a, "a");
      const center = await canvasCenter(a, "a");
      // The frame's top border's press (the border's hit band is the
      // frame's press target — the interior stands transparent over the
      // figures' own press) selects the frame + starts the move.
      const start = screenAt(center, 0, -100);
      await a.mouse.move(start.x, start.y);
      await a.mouse.down();
      await a.mouse.move(start.x + 40, start.y + 20, { steps: 4 });
      await a.mouse.up();
      // The frame's geometry stands the +40/+20 delta (over the wire to
      // pane B) — the move's stand.
      await expect
        .poll(async () => (await docBlocks(b, "b"))[frame]?.geometry, SETTLE)
        .toEqual({ x: before[frame]!.geometry!.x + 40, y: before[frame]!.geometry!.y + 20, w: 240, h: 160 });
      // …and the figures' geometries STAND (the boundary's move does not
      // move the figures — the content does not ride the box's slide).
      for (const id of [rect, ellipse]) {
        await expect.poll(async () => (await docBlocks(b, "b"))[id]?.geometry, SETTLE).toEqual(before[id]!.geometry);
      }
    } finally {
      await close();
    }
  });

  test("the delete: the frame's select + Delete — the frame goes, the figures stand (no cascade, over the wire)", async ({
    browser,
  }) => {
    const { a, b, close } = await twoPanes(browser, "frame-delete");
    try {
      await toCanvas(a, "a");
      await toCanvas(b, "b");
      const { rect, ellipse, frame } = await seedScene(a, "a");
      await wireSynced(b, "b", frame);
      const before = await docBlocks(a, "a");
      const center = await canvasCenter(a, "a");
      // The frame's top border's press selects the frame; the Delete
      // removes it (the boundary's childless's stand — the removal's
      // no-cascade).
      const start = screenAt(center, 0, -100);
      await a.mouse.click(start.x, start.y);
      await a.keyboard.press("Delete");
      // The frame goes (over the wire to pane B) — and the figures STAND
      // (their geometries + their types stand — the no-cascade's stand).
      await expect.poll(async () => (await docBlocks(b, "b"))[frame], SETTLE).toBeUndefined();
      const blocksB = await docBlocks(b, "b");
      expect(blocksB[rect]?.type).toBe("shape");
      expect(blocksB[rect]?.geometry).toEqual(before[rect]!.geometry);
      expect(blocksB[ellipse]?.type).toBe("shape");
      expect(blocksB[ellipse]?.geometry).toEqual(before[ellipse]!.geometry);
    } finally {
      await close();
    }
  });
});
