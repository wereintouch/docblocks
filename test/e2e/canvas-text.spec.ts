// The canvas-text (the reworked interaction) — the entry's stands: the
// ghost's blur's cancel (nothing is written), the press's contract (the
// selection over the move session, the caret stands off — the typing stands
// off; the drag moves the block over the wire; the release's selection over
// the moved block), the double-click's caret's entry (the typing lands in
// the block over the wire), the m's letter over the live edit (the hotkey's
// stand off), and the Escape over the empty real block (the text's deletion
// over the wire).
import { type Locator, type Page, expect, test } from "@playwright/test";

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

/** The block's text (the runs' flatten; "" over the absent content). */
function textOf(block: CanvasBlock | undefined): string {
  return (block?.content ?? []).map((run) => run.text).join("");
}

/** Seed a canvas-text (the geometry's center anchor) with the text (the absent stand is the empty block) and return its id. */
async function seedText(
  page: Page,
  client: "a" | "b",
  text: string,
  geometry: { x: number; y: number; w: number; h: number } = { x: 0, y: 0, w: 200, h: 40 }
): Promise<string> {
  return page.evaluate(
    ({ client, text, geometry }) => {
      const docs = window.__paneDocs;
      const doc = (client === "a" ? docs?.a : docs?.b) ?? null;
      if (doc === null) throw new Error("the pane's doc is not mounted");
      const json = doc.toJSON();
      const surfaceId = Object.entries(json.blocks).find(
        ([, block]) => (block as { type: string }).type === "surface"
      )?.[0];
      const surface = surfaceId !== undefined ? surfaceId : doc.insertBlock("surface");
      const id = doc.insertBlock("canvas-text", undefined, { parent: surface });
      doc.setGeometry(id, geometry);
      if (text !== "") doc.insertText(id, 0, text);
      return id;
    },
    { client, text, geometry }
  );
}

/** Wait for pane B's doc to carry the id over the wire. */
async function wireSynced(page: Page, client: "a" | "b", id: string): Promise<void> {
  await expect.poll(async () => (await docBlocks(page, client))[id] !== undefined, SETTLE).toBe(true);
}

/** The active element's stand (the caret's seat / the focus's park). */
async function activeStand(page: Page): Promise<{ slot: string | null; blockId: string | null; editable: boolean }> {
  return page.evaluate(() => {
    const active = document.activeElement;
    return {
      slot: active?.getAttribute("data-slot") ?? null,
      blockId: active?.getAttribute("data-block-id") ?? null,
      editable: active instanceof HTMLElement ? active.isContentEditable : false,
    };
  });
}

/** Wait for the DOM caret to stand in the block's inner (the release's seat's settle — the selectionchange's mapping's clobber stands in the same event's stand). */
async function caretIn(page: Page, blockId: string): Promise<void> {
  await page.waitForFunction(
    (id) => {
      const anchor = window.getSelection()?.anchorNode ?? null;
      const element = anchor instanceof Element ? anchor : (anchor?.parentElement ?? null);
      return element?.closest(`[data-block-id="${id}"]`) !== null;
    },
    blockId,
    { timeout: 5000 }
  );
}

/** The selection's stand over the presses (the retry stands the clobber's race — the press's focus's move's spurious selectionchange's clobber): a same-point press over the standing caret re-stands the stable selection (the release's no-op's seat over the same point's stand stands no clobber). */
async function pressForSelection(page: Page, item: Locator, x: number, y: number): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await page.mouse.click(x, y);
    await page.waitForTimeout(120);
    if ((await item.getAttribute("data-selected")) === "true") return;
  }
  await page.mouse.click(x, y);
  await expect(item).toHaveAttribute("data-selected", "true");
}

test.describe("the canvas-text (the reworked interaction)", () => {
  test("the blur without input cancels the ghost (nothing is written — the ghost's view-state's stand)", async ({
    browser,
  }) => {
    const { a, b, close } = await twoPanes(browser, "text-ghost-blur");
    try {
      await toCanvas(a, "a");
      await toCanvas(b, "b");
      // The 50% zoom (the empty canvas's stand — the card's screen's half-
      // span stands 180x240, the point's (±450, ±300) stands clear of it).
      const zoomToolbar = canvasView(a, "a").getByRole("toolbar", { name: "Canvas zoom" });
      for (let i = 0; i < 5; i += 1) await zoomToolbar.getByLabel("Zoom out").click();
      const zoom = parseInt((await zoomToolbar.getByLabel("Reset zoom").textContent()) ?? "50", 10) / 100;
      const center = await canvasCenter(a, "a");
      const pointA = screenAt(center, 450 * zoom, 300 * zoom);
      const pointB = screenAt(center, -450 * zoom, -300 * zoom);
      const jsonBefore = await docBlocks(a, "a");

      await a.mouse.dblclick(pointA.x, pointA.y);
      expect(await a.locator('[data-slot="docblocks/canvas-text-ghost"]').count()).toBe(1);

      // The blur's cancel (a press over the empty canvas blurs the ghost's
      // inner — the nothing-written's stand).
      await a.mouse.click(pointB.x, pointB.y);
      expect(await a.locator('[data-slot="docblocks/canvas-text-ghost"]').count()).toBe(0);
      expect(await docBlocks(a, "a")).toEqual(jsonBefore);
      await expect.poll(async () => await docBlocks(b, "b"), SETTLE).toEqual(jsonBefore);
    } finally {
      await close();
    }
  });

  test("the single click's selection's stand (the shape's press parity: the selection stands over the move session, the caret stands off — the typing stands off; the drag moves the block over the wire; the release's selection stands over the moved block)", async ({
    browser,
  }) => {
    const { a, b, close } = await twoPanes(browser, "text-press-select");
    try {
      await toCanvas(a, "a");
      await toCanvas(b, "b");
      const id = await seedText(a, "a", "note");
      await wireSynced(b, "b", id);
      const center = await canvasCenter(a, "a");
      // The block's center (the geometry's center anchor at the world's
      // origin — the view's center).
      const point = screenAt(center, 0, 0);
      const item = canvasView(a, "a").locator(`[data-slot="docblocks/canvas-item"][data-block-id="${id}"]`);

      // The press (the shape's parity): the selection stands (the press's
      // preventDefault's stand + the focus's park on the container — the
      // caret stands off, the typing stands off the block; the retry
      // stands the press's focus's move's spurious clobber).
      await pressForSelection(a, item, point.x, point.y);
      const stand = await activeStand(a);
      expect(stand.editable).toBe(false);
      expect(stand.blockId).not.toBe(id);
      await a.keyboard.type("Y");
      expect(textOf((await docBlocks(a, "a"))[id])).toBe("note");
      expect(textOf((await docBlocks(b, "b"))[id])).toBe("note");

      // The drag = the move (the geometry's delta over the wire to pane B
      // — the text stands, the move's parity).
      const before = await docBlocks(a, "a");
      await a.mouse.move(point.x, point.y);
      await a.mouse.down();
      await a.mouse.move(point.x + 30, point.y + 15, { steps: 4 });
      await a.mouse.up();
      await expect
        .poll(async () => (await docBlocks(b, "b"))[id]?.geometry, SETTLE)
        .toEqual({
          x: before[id]!.geometry!.x + 30,
          y: before[id]!.geometry!.y + 15,
          w: before[id]!.geometry!.w,
          h: before[id]!.geometry!.h,
        });
      expect(textOf((await docBlocks(a, "a"))[id])).toBe("note");

      // The release's stand: the selection stands over the moved block
      // (the press's contract — no caret, the focus's park on the
      // container).
      await expect(item).toHaveAttribute("data-selected", "true");
      const releaseStand = await activeStand(a);
      expect(releaseStand.editable).toBe(false);
      expect(releaseStand.blockId).not.toBe(id);
    } finally {
      await close();
    }
  });

  test("the double-click's caret's stand (the shape's text entry's parity: the caret in the block, the typing lands over the wire)", async ({
    browser,
  }) => {
    const { a, b, close } = await twoPanes(browser, "text-dblclick-caret");
    try {
      await toCanvas(a, "a");
      await toCanvas(b, "b");
      const id = await seedText(a, "a", "note");
      await wireSynced(b, "b", id);
      const center = await canvasCenter(a, "a");
      const point = screenAt(center, 0, 0);

      // The double-click enters the edit: the caret stands in the block's
      // inner (the point's offset — the caret-position API's stand), the
      // typing lands in the block (over the wire to pane B).
      await a.mouse.dblclick(point.x, point.y);
      await caretIn(a, id);
      const stand = await activeStand(a);
      expect(stand.slot).toBe("docblocks/block-content");
      expect(stand.blockId).toBe(id);
      expect(stand.editable).toBe(true);
      await a.keyboard.type("X");
      expect(textOf((await docBlocks(a, "a"))[id])).toBe("noteX");
      await expect.poll(async () => textOf((await docBlocks(b, "b"))[id]), SETTLE).toBe("noteX");
    } finally {
      await close();
    }
  });

  test("the letters stand no hotkey over the edit (the m's typing's stand: the character lands, the caret stands, the mode stands)", async ({
    browser,
  }) => {
    const { a, close } = await twoPanes(browser, "text-m-letter");
    try {
      await toCanvas(a, "a");
      const id = await seedText(a, "a", "note");
      const center = await canvasCenter(a, "a");
      // The double-click's edit's entry (the caret's stand over the inner).
      await a.mouse.dblclick(center.x, center.y);
      await caretIn(a, id);

      // The m over the edit: the character lands (the hotkey stands off —
      // no mode switch, no blur, no canvas-wide stand), the caret stands
      // in the block.
      await a.keyboard.type("m");
      const stand = await activeStand(a);
      expect(stand.slot).toBe("docblocks/block-content");
      expect(stand.blockId).toBe(id);
      expect(stand.editable).toBe(true);
      expect(textOf((await docBlocks(a, "a"))[id])).toContain("m");
    } finally {
      await close();
    }
  });

  test("the Escape over the empty real block (the text's deletion's stand) removes the block (over the wire)", async ({
    browser,
  }) => {
    const { a, b, close } = await twoPanes(browser, "text-esc-empty");
    try {
      await toCanvas(a, "a");
      await toCanvas(b, "b");
      const id = await seedText(a, "a", "");
      await wireSynced(b, "b", id);
      const center = await canvasCenter(a, "a");
      // The double-click's caret's stand (the press's contract — the single
      // click stands the selection, no caret): the caret stands in the
      // empty block's inner's settle.
      await a.mouse.dblclick(center.x, center.y);
      await caretIn(a, id);
      const caretStand = await activeStand(a);
      expect(caretStand.slot).toBe("docblocks/block-content");
      expect(caretStand.blockId).toBe(id);
      expect(caretStand.editable).toBe(true);
      // The Escape over the empty block (the no-orphan's stand): the block
      // goes (over the wire to pane B), the focus stands off the block.
      await a.keyboard.press("Escape");
      await expect.poll(async () => (await docBlocks(a, "a"))[id], SETTLE).toBeUndefined();
      await expect.poll(async () => (await docBlocks(b, "b"))[id], SETTLE).toBeUndefined();
      expect((await activeStand(a)).blockId).not.toBe(id);
    } finally {
      await close();
    }
  });
});
