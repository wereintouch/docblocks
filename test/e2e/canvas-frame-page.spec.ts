// The page-frame block (the page context's window via the slash /frame):
// the picker's stand (the search over the document's canvas frames, the
// pick's commit over the wire) and the window's render (the figure's copy,
// the referenced frame's box standing out of its own window, the live's
// re-stand, the dangling placeholder).
import { type Page, expect, test } from "@playwright/test";

import { SETTLE, twoPanes } from "./helpers";

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
