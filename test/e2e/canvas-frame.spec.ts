// The canvas frame (the region boundary): the dock's Frame tool (the
// click's default-size place, the drag-to-size), the boundary's render (the
// transparent region marker — the border over the canvas's own background,
// no content copy: the canvas's own figures stand at their own positions,
// the frame is a region marker, not a window), the move's stand (the
// frame's geometry stands the delta, the figures' stand — the content does
// not ride the box's slide), the title's idiom (the set-title menu over the
// selected title-less frame, the chip's double-click inline edit, the empty
// commit's removal), the delete's no-cascade stand (the frame goes, the
// figures stand), and the page-frame block via the slash /frame command (the
// picker's stand — the search over the document's canvas frames, the pick's
// commit over the wire, the window's render — the figure's copy, the
// referenced frame's box standing out of its own window, the live's
// re-stand, the dangling placeholder).
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
      // The frame's INTERIOR press (the boundary's box is the press's
      // target — a spot with no figure under the point) selects the frame
      // + starts the move.
      const start = screenAt(center, 20, -80);
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
      // The frame's INTERIOR press (the boundary's box's stand) selects the
      // frame (the title-less frame's selected stand).
      const start = screenAt(center, 20, -80);
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
      // The frame's INTERIOR press selects the frame; the Delete removes
      // it (the boundary's childless's stand — the removal's no-cascade).
      const start = screenAt(center, 20, -80);
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

/** The page-frame block (the page context's window via the slash /frame). */
const pageFrameWindow = (page: Page, client: "a" | "b") =>
  page.locator(`[data-testid="doc-${client}"] [data-slot="docblocks/frame-page-window"]`);

/** Seed the page-frame's scene (the one surface: a titled frame + a rect inside the frame's box region) over pane A and wait for pane B's wire. */
async function seedPageScene(a: Page, b: Page): Promise<{ frame: string; rect: string }> {
  const ids = await a.evaluate(() => {
    const doc = window.__paneDocs?.a ?? null;
    if (doc === null) throw new Error("the pane's doc is not mounted");
    const surface = doc.insertBlock("surface");
    const frame = doc.insertBlock("frame", { title: "alpha" }, { parent: surface });
    doc.setGeometry(frame, { x: 0, y: -20, w: 240, h: 160 });
    const rect = doc.insertBlock("shape", { variant: "rect" }, { parent: surface });
    doc.setGeometry(rect, { x: -40, y: -30, w: 100, h: 60 });
    return { frame, rect };
  });
  await wireSynced(b, "b", ids.frame);
  return ids;
}

/** The pane's root's children (the page sequence's stand). */
async function rootChildren(page: Page, client: "a" | "b"): Promise<string[]> {
  return page.evaluate(
    ({ client }) => {
      const docs = window.__paneDocs;
      const doc = (client === "a" ? docs?.a : docs?.b) ?? null;
      if (doc === null) return [];
      return doc.getChildren(doc.meta.id);
    },
    { client }
  );
}

test.describe("the page-frame block (the slash /frame command)", () => {
  test("the /frame slash command: the command stands in the menu, the picker's stand (the search + the list over the document's frames, the search's filter), the pick's commit over the wire", async ({
    browser,
  }) => {
    const { a, b, close } = await twoPanes(browser, "page-frame-slash");
    try {
      // The page mode (the default view — the slash command's stand over
      // the page's text block).
      const { frame } = await seedPageScene(a, b);
      // The starter paragraph's inner (the slash's trigger block).
      const inner = a.locator('[data-testid="doc-a"] [data-slot="docblocks/block-content"]').first();
      await inner.click();
      // The "/" opens the menu; the typed query filters the commands.
      await a.keyboard.type("/frame");
      const menu = a.locator('[data-slot="docblocks/slash-menu"]');
      await expect(menu).toHaveCount(1);
      // The command's option stands (the "Frame" command's label).
      const frameOption = menu.getByRole("menuitem", { name: "Frame", exact: true });
      await expect(frameOption).toHaveCount(1);
      await frameOption.click();
      // The picker stands (the search input + the list over the document's
      // canvas frames — the frame's title's stand).
      const picker = a.locator('[data-slot="docblocks/slash-frame-picker"]');
      await expect(picker).toHaveCount(1);
      const search = a.locator('[data-slot="docblocks/slash-frame-search"]');
      await expect(search).toHaveCount(1);
      expect(await a.evaluate(() => document.activeElement?.getAttribute("data-slot"))).toBe(
        "docblocks/slash-frame-search"
      );
      const list = a.locator('[data-slot="docblocks/slash-frame-list"]');
      await expect.poll(async () => list.locator('[data-slot="docblocks/slash-frame-option"]').count()).toBe(1);
      expect(await list.locator('[data-slot="docblocks/slash-frame-option"]').textContent()).toBe("alpha");
      expect(await list.locator('[data-slot="docblocks/slash-frame-option"]').getAttribute("data-frame-id")).toBe(
        frame
      );
      // The search's filter (the query over the frames' names).
      await search.fill("zzz");
      await expect(a.locator('[data-slot="docblocks/slash-frame-empty"]')).toHaveCount(1);
      expect(await a.locator('[data-slot="docblocks/slash-frame-empty"]').textContent()).toBe("No frames match");
      await expect(list.locator('[data-slot="docblocks/slash-frame-option"]')).toHaveCount(0);
      await search.fill("");
      await expect(list.locator('[data-slot="docblocks/slash-frame-option"]')).toHaveCount(1);
      // The pick's commit (ONE transact: the phrase's strip + the frame
      // block's insert + the trailing paragraph's seat).
      await list.locator('[data-slot="docblocks/slash-frame-option"]').click();
      // The pane A's stand: the page-frame block (the frameId's weak
      // reference — the surface's canvas frame's title's stand out of the
      // page sequence's read) after the caret's block + the trailing
      // paragraph at the end.
      const blocksA = await docBlocks(a, "a");
      const frameBlock = Object.entries(blocksA).find(
        ([, block]) => block.type === "frame" && block.attrs?.frameId !== undefined
      );
      expect(frameBlock).toBeDefined();
      expect(frameBlock![1].attrs?.frameId).toBe(frame);
      const rootA = await rootChildren(a, "a");
      // The frame block stands after the caret's block (the surface's canvas
      // layer stands in the root's sequence too — the page's render's stand
      // filters it out, the sequence's read keeps it) + the trailing
      // paragraph at the end.
      const caretBlock = rootA[0]!;
      expect(rootA[rootA.indexOf(caretBlock) + 1]).toBe(frameBlock![0]);
      expect(rootA[rootA.length - 1]).not.toBe(frameBlock![0]); // the trailing paragraph
      expect(blocksA[rootA[rootA.length - 1]!]!.type).toBe("paragraph");
      // …and the phrase stands stripped (the caret's block's text is empty
      // — the trigger's "/" + the query's "frame" stand removed).
      expect(blocksA[caretBlock]!.type).toBe("paragraph");
      expect((blocksA[caretBlock]!.content ?? []).map((run) => run.text).join("")).toBe("");
      // Pane B's stand over the wire (the whole commit's parity). The
      // page-frame block's read (the frameId's stand — the canvas frame's
      // title's read stands out of the page sequence's read).
      await expect
        .poll(async () => {
          const blocksB = await docBlocks(b, "b");
          const frameBlockB = Object.entries(blocksB).find(
            ([, block]) => block.type === "frame" && block.attrs?.frameId !== undefined
          );
          if (frameBlockB === undefined) return null;
          const rootB = await rootChildren(b, "b");
          return {
            frameId: frameBlockB[1].attrs?.frameId,
            frameAt: frameBlockB[0],
            trailing: rootB[rootB.length - 1],
            trailingType: blocksB[rootB[rootB.length - 1]!]?.type,
          };
        }, SETTLE)
        .toEqual({
          frameId: frame,
          frameAt: frameBlock![0],
          trailing: rootA[rootA.length - 1],
          trailingType: "paragraph",
        });
    } finally {
      await close();
    }
  });
  test("the page-frame window: the figure's copy stands inside the window (the referenced frame's box stands out); the live's re-stand over the wire; the dangling's placeholder", async ({
    browser,
  }) => {
    const { a, b, close } = await twoPanes(browser, "page-frame-window");
    try {
      const { frame, rect } = await seedPageScene(a, b);
      // The pick (the same commit's stand as the slash's test).
      const inner = a.locator('[data-testid="doc-a"] [data-slot="docblocks/block-content"]').first();
      await inner.click();
      await a.keyboard.type("/frame");
      await a
        .locator('[data-slot="docblocks/slash-menu"]')
        .getByRole("menuitem", { name: "Frame", exact: true })
        .click();
      await a
        .locator('[data-slot="docblocks/slash-frame-list"]')
        .locator('[data-slot="docblocks/slash-frame-option"]')
        .click();
      // The window's render (the inline window's stand: the row's wrapper +
      // the box over the canvas's background + the reference's title's
      // aria).
      const win = pageFrameWindow(a, "a");
      await expect(win).toHaveCount(1);
      expect(await win.getAttribute("aria-label")).toBe("Frame: alpha");
      expect(await a.locator('[data-slot="docblocks/frame-page"]').count()).toBe(1);
      // The figure's copy stands inside the window (the rect's stand over
      // the frame's region — the window's content's inert copy).
      await expect.poll(async () => win.locator('[data-slot="docblocks/shape"]').count()).toBe(1);
      // The referenced frame's OWN box does not stand inside its own page
      // window (the reference stands out of its own window).
      expect(await win.locator('[data-slot="docblocks/frame"]').count()).toBe(0);
      // The live's stand: pane B moves the figure — pane A's page window's
      // copy re-stands over the wire (the copy's position's re-stand).
      await b.evaluate(
        ({ rect }) => {
          window.__paneDocs?.b?.setGeometry(rect, { x: 0, y: -30 });
        },
        { rect }
      );
      // The copy's box re-stands at the new world's position (the window's
      // offset's re-derivation — the 1:1 world's parity over the wire): the
      // frame's center stands at the window's center, the figure's center at
      // the frame's center + the world's delta (the move's +40/0 stands the
      // figure's center over the frame's center's x, 10 over the frame's
      // center's y), and the copy's box stands 1:1 (the figure's own
      // 100x60).
      await expect
        .poll(async () => {
          const box = (await win.locator('[data-slot="docblocks/shape"]').boundingBox()) ?? null;
          const winBox = (await win.boundingBox()) ?? null;
          if (box === null || winBox === null) return null;
          return {
            x: box.x - winBox.x - (winBox.width / 2 - 50),
            y: box.y - winBox.y - (winBox.height / 2 - 40),
          };
        }, SETTLE)
        .toEqual({ x: 0, y: 0 });
      // The dangling's stand: pane B removes the referenced canvas frame —
      // pane A's page block stands the placeholder (the weak reference's
      // lenient's stand).
      await b.evaluate(
        ({ frame }) => {
          window.__paneDocs?.b?.removeBlock(frame);
        },
        { frame }
      );
      await expect.poll(async () => a.locator('[data-slot="docblocks/frame-page-missing"]').count(), SETTLE).toBe(1);
      expect(await pageFrameWindow(a, "a").count()).toBe(0);
      expect(await a.locator('[data-slot="docblocks/frame-page-missing"]').textContent()).toContain("Frame not found");
    } finally {
      await close();
    }
  });
});
