// The canvas-text (the reworked interaction): the ghost's stands (the
// blur's cancel over the empty ghost — the creation's commit stands in
// the canvas-empty-dblclick's spec, no duplicate coverage), the
// two-click press's stands (the first press over the unselected block:
// the press's selection stands over the move session, the release's
// caret's stand wins over the settle (the cross-drag's release's seat +
// the selectionchange's mapping's clobber) — the typing lands in the
// block; the second press over the standing caret: the press's selection
// stands over the settle (the release's seat is a no-op over the standing
// DOM caret) — the typing stands off), the first-press's drag (the move's
// geometry's delta over the wire, the release's caret's stand over the
// moved block), the Escape over the empty real block (the removeBlock's
// no-orphan's stand), the container's membership (the drag-in / drag-out's
// indicators' stand, the release's commit over the wire), and the text
// toolbar (the single selection's "Text options" stand, the font family /
// color / style / size / align's applies — one updateBlock each over the
// wire — + the z-order menu's reorder's apply).
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

/** The surface's children's order (the z-order's stand over the doc). */
async function surfaceChildren(page: Page, client: "a" | "b"): Promise<string[]> {
  return page.evaluate(
    ({ client }) => {
      const docs = window.__paneDocs;
      const doc = (client === "a" ? docs?.a : docs?.b) ?? null;
      if (doc === null) return [];
      const json = doc.toJSON();
      const surfaceId = Object.keys(json.blocks).find((id) => json.blocks[id]!.type === "surface");
      if (surfaceId === undefined) return [];
      const block = json.blocks[surfaceId]!;
      return block.children ?? [];
    },
    { client }
  );
}

/** The group's members from the doc. */
async function groupMembers(page: Page, client: "a" | "b", group: string): Promise<string[]> {
  const blocks = await docBlocks(page, client);
  return (blocks[group]?.attrs?.members as string[]) ?? [];
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

  test("the two-click press: the first click's caret's stand (the typing lands in the block over the wire, the canvas selection stands no stand over the settle), the second click's selection's stand (the typing stands off)", async ({
    browser,
  }) => {
    const { a, b, close } = await twoPanes(browser, "text-two-click");
    try {
      await toCanvas(a, "a");
      await toCanvas(b, "b");
      const id = await seedText(a, "a", "note");
      await wireSynced(b, "b", id);
      const center = await canvasCenter(a, "a");
      // The block's center (the geometry's center anchor at the world's
      // origin — the view's center).
      const point = screenAt(center, 0, 0);

      // The first press (unselected): the press's selection stands over the
      // move session, and the release's caret's stand wins over it (the
      // cross-drag's release's stand + the selectionchange's mapping's
      // clobber — the blocks' view stands over the editable's caret). The
      // settle's stand: the caret in the block, the canvas selection's no
      // stand. The wait pins the release's seat's settle (the DOM caret's
      // stand in the block's inner — the clobber's settle stands in the
      // same event's stand; the press's transient selection stands no
      // settle stand over the fast click's batched renders, so the
      // settle's read stands on the DOM stand, not on the attribute).
      await a.mouse.click(point.x, point.y);
      await caretIn(a, id);
      const item = canvasView(a, "a").locator(`[data-slot="docblocks/canvas-item"][data-block-id="${id}"]`);
      await expect(item).not.toHaveAttribute("data-selected");
      const caretStand = await activeStand(a);
      expect(caretStand.slot).toBe("docblocks/block-content");
      expect(caretStand.blockId).toBe(id);
      expect(caretStand.editable).toBe(true);
      // The typing lands in the block (over the wire to pane B).
      await a.keyboard.type("X");
      expect(textOf((await docBlocks(a, "a"))[id])).toBe("noteX");
      await expect.poll(async () => textOf((await docBlocks(b, "b"))[id]), SETTLE).toBe("noteX");

      // The second press (the caret's stand over the block): the press's
      // selection stands (the move session's select) and stands over the
      // settle (the release's caret's stand is a no-op over the standing
      // DOM caret — no selectionchange, the blocks' view stands; the
      // retry stands the press's focus's move's spurious clobber — the
      // same-point's press over the settled stand re-stands it). The
      // focus's park stands on the container (the typing stands off the
      // block — the doc stands).
      await pressForSelection(a, item, point.x, point.y);
      const secondStand = await activeStand(a);
      expect(secondStand.editable).toBe(false);
      expect(secondStand.blockId).not.toBe(id);
      await a.keyboard.type("Y");
      expect(textOf((await docBlocks(a, "a"))[id])).toBe("noteX");
      expect(textOf((await docBlocks(b, "b"))[id])).toBe("noteX");
    } finally {
      await close();
    }
  });

  test("the first-press's drag = the move (the geometry's delta over the wire; the release's caret's stand over the moved block)", async ({
    browser,
  }) => {
    const { a, b, close } = await twoPanes(browser, "text-press-drag");
    try {
      await toCanvas(a, "a");
      await toCanvas(b, "b");
      const id = await seedText(a, "a", "move me");
      await wireSynced(b, "b", id);
      const before = await docBlocks(a, "a");
      const center = await canvasCenter(a, "a");
      // The first press (unselected) starts the move session (the press's
      // select + the drag's commit — a press-drag from the unselected's
      // stand, the selected's second press's caret's stand stands off).
      const start = screenAt(center, 0, 0);
      await a.mouse.move(start.x, start.y);
      await a.mouse.down();
      await a.mouse.move(start.x + 30, start.y + 15, { steps: 4 });
      await a.mouse.up();
      // The geometry's delta stands the +30/+15 (over the wire to pane B)
      // — the text stands (the move's parity).
      await expect
        .poll(async () => (await docBlocks(b, "b"))[id]?.geometry, SETTLE)
        .toEqual({
          x: before[id]!.geometry!.x + 30,
          y: before[id]!.geometry!.y + 15,
          w: before[id]!.geometry!.w,
          h: before[id]!.geometry!.h,
        });
      expect(textOf((await docBlocks(a, "a"))[id])).toBe("move me");
      // The release's stand: the caret stands in the moved block (the
      // cross-drag's release's seat over the drag's endpoints — the
      // selectionchange's mapping's clobber stands the canvas selection
      // off).
      const item = canvasView(a, "a").locator(`[data-slot="docblocks/canvas-item"][data-block-id="${id}"]`);
      expect(await item.getAttribute("data-selected")).toBeNull();
      const stand = await activeStand(a);
      expect(stand.slot).toBe("docblocks/block-content");
      expect(stand.blockId).toBe(id);
      expect(stand.editable).toBe(true);
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
      // The single click's caret's stand (the release's seat over the
      // block — the caret's stand in the block's inner's settle: the
      // clobber stands in the same event's stand, the canvas selection
      // stands off). The press-drag's stand stands off (the sub-threshold's
      // click — the move session's no-op).
      await a.mouse.click(center.x, center.y);
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
      // stand, the release leaves the container (over the wire). The press
      // stands over the UNSELECTED block (the selected block's press stands
      // the caret — the two-click's contract), so the empty canvas's click
      // clears the selection first.
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

  test("the toolbar: the single selection's 'Text options' stand; the font family / color / style / size / align's applies over the wire (one updateBlock each); the z-order menu's reorder's apply", async ({
    browser,
  }) => {
    const { a, b, close } = await twoPanes(browser, "text-toolbar");
    try {
      await toCanvas(a, "a");
      await toCanvas(b, "b");
      // Two canvas-texts (the z-order's reorder's stand — the two's
      // siblings' order).
      const idA = await seedText(a, "a", "toolbar note", { x: 0, y: -60, w: 200, h: 40 });
      const idB = await seedText(a, "a", "second note", { x: 0, y: 60, w: 200, h: 40 });
      await wireSynced(b, "b", idA);
      await wireSynced(b, "b", idB);
      const center = await canvasCenter(a, "a");
      // The two-click's selection's stand (the first click's caret's stand
      // over the settle — the caret's stand in the block's inner — the
      // second click's selection's stand over the settled stand): the
      // toolbar's single selection's stand.
      const point = screenAt(center, 0, -60);
      const itemA = canvasView(a, "a").locator(`[data-slot="docblocks/canvas-item"][data-block-id="${idA}"]`);
      await a.mouse.click(point.x, point.y);
      await caretIn(a, idA);
      await pressForSelection(a, itemA, point.x, point.y);
      // The leftover DOM caret's stand off (the first click's seat): the
      // selectionchange's mapping's clobber stands the blocks' view over
      // the editable's caret — the clear's stand keeps the selection over
      // the toolbar's applies' focus roundtrips (the empty selection's
      // stand: no clobber).
      await a.evaluate(() => {
        window.getSelection()?.removeAllRanges();
        (document.activeElement as HTMLElement | null)?.blur?.();
      });
      // The toolbar stands (the single canvas-text selection's stand —
      // the "Text options" aria over the box).
      const toolbar = canvasView(a, "a").locator('[data-slot="docblocks/canvas-text-toolbar"]');
      await expect(toolbar).toHaveCount(1);
      await expect(toolbar).toHaveAttribute("aria-label", "Text options");

      // The font family's apply (the self-hosted set's pick — one
      // updateBlock over the wire).
      await toolbar.locator('[data-slot="docblocks/canvas-text-toolbar-font-family"]').click();
      await a.getByRole("menuitemcheckbox", { name: "Lora", exact: true }).click();
      await expect.poll(async () => (await docBlocks(b, "b"))[idA]?.attrs?.fontFamily, SETTLE).toBe("Lora");

      // The text style's apply (the weight x the slant's pick).
      await toolbar.locator('[data-slot="docblocks/canvas-text-toolbar-text-style"]').click();
      await a.getByRole("menuitemcheckbox", { name: "Semibold", exact: true }).click();
      await expect.poll(async () => (await docBlocks(b, "b"))[idA]?.attrs?.textStyle, SETTLE).toBe("semibold");

      // The text color's apply (the section's hex's commit — the popover's
      // input over the trigger's stand).
      await toolbar.locator('[data-slot="docblocks/canvas-text-toolbar-text"]').click();
      const hex = a.locator('[data-slot="docblocks/canvas-text-text-hex"]');
      await expect(hex).toHaveCount(1);
      await hex.fill("#112233");
      await hex.press("Enter");
      await expect.poll(async () => (await docBlocks(b, "b"))[idA]?.attrs?.textColor, SETTLE).toBe("#112233");

      // The font size's apply (the numeric field's commit — any 8-512's
      // stand).
      const size = toolbar.locator('[data-slot="docblocks/canvas-text-toolbar-font-size"]');
      await size.fill("24");
      await size.press("Enter");
      await expect.poll(async () => (await docBlocks(b, "b"))[idA]?.attrs?.fontSize, SETTLE).toBe(24);

      // The alignment's apply (the left / center / right's buttons).
      await toolbar.locator('[data-slot="docblocks/canvas-text-toolbar-align-center"]').click();
      await expect.poll(async () => (await docBlocks(b, "b"))[idA]?.attrs?.textAlign, SETTLE).toBe("center");

      // The z-order menu's stand (the three-dot's trigger over the single
      // selection — the position's read over the surface's elements) + the
      // reorder's apply (the bring-forward's commit over the wire: the
      // block's z-order's stand moves up one over the siblings).
      const zMenu = toolbar.locator('[data-slot="docblocks/z-order-menu"]');
      await expect(zMenu).toHaveCount(1);
      await expect(zMenu).toHaveAttribute("aria-label", "Arrange text");
      const orderBefore = await surfaceChildren(b, "b");
      await zMenu.click();
      await a.getByRole("menuitem", { name: "Bring forward", exact: true }).click();
      await expect
        .poll(async () => (await surfaceChildren(b, "b")).indexOf(idA) > orderBefore.indexOf(idA), SETTLE)
        .toBe(true);
    } finally {
      await close();
    }
  });
});
