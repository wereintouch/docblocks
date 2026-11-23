// The canvas frame (the region boundary) — the dock's Frame tool (the
// click's default-size place, the drag-to-size over the wire) and the
// title's idiom (the set-title menu over the selected title-less frame, the
// chip's double-click inline edit, the empty commit's removal).
import { type Page, expect, test } from "@playwright/test";

import { SETTLE, canvasCenter, canvasView, screenAt, toCanvas, twoPanes } from "./helpers";

const dock = (page: Page, client: "a" | "b") => canvasView(page, client).getByRole("toolbar", { name: "Canvas tools" });

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
  test("the dock's Frame tool: the click's default-size place over the wire (the childless box)", async ({
    browser,
  }) => {
    const { a, b, close } = await twoPanes(browser, "frame-place");
    try {
      await toCanvas(a, "a");
      await toCanvas(b, "b");
      // The dock's Frame tool (the label's stand + the click's default
      // 320x240 place, the center anchor at the click's point).
      await dock(a, "a").getByLabel("Frame").click();
      const center = await canvasCenter(a, "a");
      await a.mouse.click(center.x + 10, center.y - 10);
      await expect
        .poll(
          async () => Object.values(await docBlocks(b, "b")).filter((block) => block.type === "frame").length,
          SETTLE
        )
        .toBe(1);
      const blocksB = await docBlocks(b, "b");
      const frame = Object.values(blocksB).find((block) => block.type === "frame")!;
      // The childless box's stand: the default geometry over the wire, no
      // children (the frame is a region marker — not a container).
      expect(frame.geometry).toEqual({ x: 10, y: -10, w: 320, h: 240 });
      expect(frame.children).toBeUndefined();
    } finally {
      await close();
    }
  });

  test("the dock's Frame tool: the drag-to-size place over the wire", async ({ browser }) => {
    const { a, b, close } = await twoPanes(browser, "frame-size");
    try {
      await toCanvas(a, "a");
      await toCanvas(b, "b");
      await dock(a, "a").getByLabel("Frame").click();
      const center = await canvasCenter(a, "a");
      // The drag-to-size: a +80/+50 canvas box (100% zoom), the center at
      // the drag's midpoint.
      const from = screenAt(center, -40, -25);
      const to = screenAt(center, 40, 25);
      await a.mouse.move(from.x, from.y);
      await a.mouse.down();
      await a.mouse.move(to.x, to.y, { steps: 4 });
      await a.mouse.up();
      await expect
        .poll(
          async () => Object.values(await docBlocks(b, "b")).filter((block) => block.type === "frame").length,
          SETTLE
        )
        .toBe(1);
      const blocksB = await docBlocks(b, "b");
      const frame = Object.values(blocksB).find((block) => block.type === "frame")!;
      expect(frame.geometry).toEqual({ x: 0, y: 0, w: 80, h: 50 });
      expect(frame.children).toBeUndefined();
    } finally {
      await close();
    }
  });

  test("the title: the set-title menu over the title-less frame's select, the chip's inline edit's commit, the empty commit's removal (over the wire)", async ({
    browser,
  }) => {
    const { a, b, close } = await twoPanes(browser, "frame-title");
    try {
      await toCanvas(a, "a");
      await toCanvas(b, "b");
      const { frame } = await seedScene(a, "a");
      await wireSynced(b, "b", frame);
      const center = await canvasCenter(a, "a");
      // The frame's top border's press (the border's hit band's stand)
      // selects the frame (the title-less frame's selected stand).
      const start = screenAt(center, 0, -100);
      await a.mouse.click(start.x, start.y);
      const frameItem = canvasView(a, "a").locator(`[data-slot="docblocks/canvas-item"][data-block-id="${frame}"]`);
      expect(await frameItem.getAttribute("data-selected")).not.toBeNull();
      // The title-less frame's selected stand: the set-title menu's
      // trigger (the container's idiom's parity).
      const trigger = a.locator('[data-slot="docblocks/frame-title-menu"]');
      expect(await trigger.count()).toBe(1);
      await trigger.click();
      const input = a.locator('[data-slot="docblocks/frame-title-menu-input"]');
      await input.fill("viewport");
      await input.press("Enter");
      // The commit stands the title over the wire (one updateBlock) + the
      // chip's stand.
      await expect.poll(async () => (await docBlocks(b, "b"))[frame]?.attrs?.title, SETTLE).toBe("viewport");
      const chip = a.locator("[data-slot='docblocks/frame-title']");
      await expect(chip).toHaveCount(1);
      expect(await chip.textContent()).toBe("viewport");
      // The chip's double-click inline edit (the select-all + the type
      // replaces the title; the commit is one updateBlock over the wire).
      await chip.dblclick();
      const edit = a.locator('[data-slot="docblocks/frame-title-edit"]');
      await expect(edit).toHaveCount(1);
      await edit.fill("wide viewport");
      await edit.press("Enter");
      await expect.poll(async () => (await docBlocks(b, "b"))[frame]?.attrs?.title, SETTLE).toBe("wide viewport");
      // The empty commit stands the removed state (the chip stands off —
      // the container's idiom's parity over the wire).
      await chip.dblclick();
      await edit.fill("");
      await edit.press("Escape");
      await expect.poll(async () => (await docBlocks(b, "b"))[frame]?.attrs?.title, SETTLE).toBe("");
      await expect(a.locator("[data-slot='docblocks/frame-title']")).toHaveCount(0);
    } finally {
      await close();
    }
  });
});
