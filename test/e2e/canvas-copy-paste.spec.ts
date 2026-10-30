// The canvas copy/paste: the Ctrl/Cmd+C
// copies the selection's canvas items (the deep data — the copy stands the
// original's later edits out; the frame stands the copy out), the
// Ctrl/Cmd+V pastes the copy's union center at the pointer (the container
// rides the copy — the membership remaps; the connector's endpoints
// internal → the copy's ids, external → the free points at the offset
// position with the frozen side). The paste is one commit (one undo step,
// one wire update — the undo drops the whole copy); the copy keeps the
// selection, the paste seats the selection on the pasted (the undo stands
// the previous selection back, the redo re-seats the pasted).
import { type Page, expect, test } from "@playwright/test";

import { SETTLE, canvasCenter, canvasView, toCanvas, twoPanes } from "./helpers";

/** The pane's zoom (the shapes stand the 100% viewport — the 50% stand). */
const ZOOM = 0.5;

type BlockJson = {
  type: string;
  geometry?: { x: number; y: number; w: number; h: number };
  attrs?: Record<string, unknown>;
  content?: unknown[];
};

const zoomToolbar = (page: Page, client: "a" | "b") =>
  canvasView(page, client).getByRole("toolbar", { name: "Canvas zoom" });

/** Zoom the pane to 50% (five 10% steps down from 100%). */
async function zoomTo50(page: Page, client: "a" | "b"): Promise<void> {
  const zoom = zoomToolbar(page, client);
  for (let i = 0; i < 5; i += 1) await zoom.getByLabel("Zoom out").click();
  expect(await zoom.getByLabel("Reset zoom").textContent()).toBe("50%");
}

/** The pane's doc blocks (the JSON snapshot — the type / geometry / attrs). */
async function blocks(page: Page, client: "a" | "b"): Promise<Record<string, BlockJson>> {
  return page.evaluate(
    ({ client }) => {
      const docs = window.__paneDocs;
      const doc = (client === "a" ? docs?.a : docs?.b) ?? null;
      if (doc === null) return {};
      const json = doc.toJSON();
      const out: Record<string, BlockJson> = {};
      for (const [id, block] of Object.entries(json.blocks)) {
        const entry = block as BlockJson;
        out[id] = { type: entry.type, geometry: entry.geometry, attrs: entry.attrs, content: entry.content };
      }
      return out;
    },
    { client }
  );
}

/**
 * Seeds the deterministic scene: the two shapes (A at (-300, 0), B at
 * (300, 0)) and the page miniature moved off the origin (the line's
 * midpoint click stands free). Returns the ids.
 */
async function seedScene(
  page: Page,
  client: "a" | "b"
): Promise<{ a: string; b: string; connector?: string; group?: string }> {
  return page.evaluate(
    ({ client }) => {
      const docs = window.__paneDocs;
      const doc = (client === "a" ? docs?.a : docs?.b) ?? null;
      if (doc === null) throw new Error("the pane's doc is not mounted");
      const json = doc.toJSON();
      const surfaceId = Object.entries(json.blocks).find(([, block]) => block.type === "surface")?.[0];
      const surface = surfaceId !== undefined ? surfaceId : doc.insertBlock("surface");
      const a = doc.insertBlock("shape", { variant: "rect" }, { parent: surface });
      doc.setGeometry(a, { x: -300, y: 0, w: 100, h: 100 });
      const b = doc.insertBlock("shape", { variant: "ellipse" }, { parent: surface });
      doc.setGeometry(b, { x: 300, y: 0, w: 100, h: 100 });
      // The page miniature off the origin (the line's midpoint click) —
      // the default page size (the root's fresh geometry is complete).
      doc.setGeometry(doc.meta.id, { x: 0, y: -900, w: 720, h: 960 });
      return { a, b };
    },
    { client }
  );
}

/** The pane's selected canvas item ids. */
async function selectedIds(page: Page, client: "a" | "b"): Promise<string[]> {
  return page
    .locator(`[data-testid="doc-${client}"] [data-slot="docblocks/canvas-item"][data-selected]`)
    .evaluateAll((els) => els.map((el) => el.dataset.blockId ?? ""));
}

/** The world → screen point (the pane's zoom / the container center). */
async function worldPoint(page: Page, client: "a" | "b", x: number, y: number): Promise<{ x: number; y: number }> {
  const center = await canvasCenter(page, client);
  return { x: center.x + x * ZOOM, y: center.y + y * ZOOM };
}

test.describe("the canvas copy/paste", () => {
  test("the copy keeps the selection, the paste seats at the pointer (the one undo step, the wire, the selection contract)", async ({
    browser,
  }) => {
    const { a, b, close } = await twoPanes(browser, "canvas-copy-paste");
    try {
      await toCanvas(a, "a");
      await toCanvas(b, "b");
      const { a: aId, b: bId } = await seedScene(a, "a");
      await zoomTo50(a, "a");

      // The selection: the click (the focus parks on the container) + the
      // shift-click (the additive toggle).
      const pA = await worldPoint(a, "a", -300, 0);
      await a.mouse.click(pA.x, pA.y);
      expect(await selectedIds(a, "a")).toEqual([aId]);
      const pB = await worldPoint(a, "a", 300, 0);
      // The shift-click's additive toggle (the real keyboard's Shift — the
      // Playwright's mouse modifiers do not reach the pointerdown).
      await a.keyboard.down("Shift");
      await a.mouse.click(pB.x, pB.y);
      await a.keyboard.up("Shift");
      expect(await selectedIds(a, "a")).toEqual([aId, bId]);

      // The copy: the selection stands (the copy clears nothing).
      await a.keyboard.press("Control+c");
      expect(await selectedIds(a, "a")).toEqual([aId, bId]);

      // The paste at the pointer (the world (100, 0) over the 50% zoom):
      // the copy's union center (0, 0) lands at the pointer — the delta
      // (100, 0).
      const paste = await worldPoint(a, "a", 100, 0);
      await a.mouse.move(paste.x, paste.y);
      await a.keyboard.press("Control+v");
      const afterPaste = await blocks(a, "a");
      const copies = Object.entries(afterPaste).filter(
        ([id, block]) => block.type === "shape" && id !== aId && id !== bId
      );
      expect(copies).toHaveLength(2);
      const aCopy = copies.find(([, block]) => block.attrs?.variant === "rect")![0];
      const bCopy = copies.find(([, block]) => block.attrs?.variant === "ellipse")![0];
      expect(afterPaste[aCopy]?.geometry).toEqual({ x: -200, y: 0, w: 100, h: 100 });
      expect(afterPaste[bCopy]?.geometry).toEqual({ x: 400, y: 0, w: 100, h: 100 });
      // The paste seats the selection on the pasted.
      expect(await selectedIds(a, "a")).toEqual([aCopy, bCopy]);

      // The wire: the other pane's JSON carries the copies.
      await expect.poll(async () => (await blocks(b, "b"))[aCopy] !== undefined, SETTLE).toBe(true);
      const bBlocks = await blocks(b, "b");
      expect(bBlocks[aCopy]?.geometry).toEqual({ x: -200, y: 0, w: 100, h: 100 });
      expect(bBlocks[bCopy]?.geometry).toEqual({ x: 400, y: 0, w: 100, h: 100 });

      // The one undo step: the whole copy drops, the previous selection
      // stands back.
      await a.keyboard.press("Control+z");
      const afterUndo = await blocks(a, "a");
      expect(afterUndo[aCopy]).toBeUndefined();
      expect(afterUndo[bCopy]).toBeUndefined();
      expect(await selectedIds(a, "a")).toEqual([aId, bId]);

      // The redo re-seats the selection on the pasted.
      await a.keyboard.press("Control+Shift+z");
      const afterRedo = await blocks(a, "a");
      expect(afterRedo[aCopy]?.geometry).toEqual({ x: -200, y: 0, w: 100, h: 100 });
      expect(afterRedo[bCopy]?.geometry).toEqual({ x: 400, y: 0, w: 100, h: 100 });
      expect(await selectedIds(a, "a")).toEqual([aCopy, bCopy]);
    } finally {
      await close();
    }
  });

  test("the connector's copy: the external endpoints stand the free points at the original position (the frozen side)", async ({
    browser,
  }) => {
    const { a, b, close } = await twoPanes(browser, "canvas-copy-paste-connector");
    try {
      await toCanvas(a, "a");
      await toCanvas(b, "b");
      const { a: aId, b: bId } = await seedScene(a, "a");
      // The connector A → B (the legacy refs — the edge anchors).
      const connId = await a.evaluate(
        ({ a, b }) => {
          const docs = window.__paneDocs;
          const doc = docs?.a;
          if (doc === null || doc === undefined) throw new Error("the pane's doc is not mounted");
          const json = doc.toJSON();
          const surfaceId = Object.entries(json.blocks).find(([, block]) => block.type === "surface")?.[0];
          return doc.insertBlock("connector", { start: { blockId: a }, end: { blockId: b } }, { parent: surfaceId! });
        },
        { a: aId, b: bId }
      );
      await zoomTo50(a, "a");

      // The line's click selects it (the hit path — the midpoint over the
      // clear origin, the page miniature stands off).
      const mid = await worldPoint(a, "a", 0, 0);
      await a.mouse.click(mid.x, mid.y);
      expect(await selectedIds(a, "a")).toEqual([connId]);

      // The copy + the paste at the pointer: the connector-only copy
      // stands no box → the delta stands zero (the copy stands its
      // original position — the endpoints' free points).
      await a.keyboard.press("Control+c");
      const paste = await worldPoint(a, "a", 100, 0);
      await a.mouse.move(paste.x, paste.y);
      await a.keyboard.press("Control+v");
      const after = await blocks(a, "a");
      const connCopy = Object.entries(after).find(([id, block]) => block.type === "connector" && id !== connId)?.[0];
      expect(connCopy).toBeDefined();
      const copied = after[connCopy!]!;
      // The endpoints: the external refs stand the free points (the
      // original's edge anchors — A's east point (-250, 0) → the frozen
      // side "east", B's west point (250, 0) → "west").
      expect(copied.attrs?.start).toEqual({ x: -250, y: 0, port: "east" });
      expect(copied.attrs?.end).toEqual({ x: 250, y: 0, port: "west" });
      // The paste seats the selection on the pasted; the undo stands the
      // previous selection back.
      expect(await selectedIds(a, "a")).toEqual([connCopy!]);
      await a.keyboard.press("Control+z");
      expect((await blocks(a, "a"))[connCopy!]).toBeUndefined();
      expect(await selectedIds(a, "a")).toEqual([connId]);

      // The wire: the other pane carries the copy over the redo.
      await a.keyboard.press("Control+Shift+z");
      await expect.poll(async () => (await blocks(b, "b"))[connCopy!] !== undefined, SETTLE).toBe(true);
      const bBlocks = await blocks(b, "b");
      expect(bBlocks[connCopy!]?.attrs?.start).toEqual({ x: -250, y: 0, port: "east" });
      expect(bBlocks[connCopy!]?.attrs?.end).toEqual({ x: 250, y: 0, port: "west" });
    } finally {
      await close();
    }
  });

  test("the container's copy: the membership remaps onto the copy's ids (the members' geometry shifts)", async ({
    browser,
  }) => {
    const { a, b, close } = await twoPanes(browser, "canvas-copy-paste-group");
    try {
      await toCanvas(a, "a");
      await toCanvas(b, "b");
      const { a: aId, b: bId } = await seedScene(a, "a");
      // The group over A + B (the own box — the members' band stands free
      // at the border's press).
      const groupId = await a.evaluate(
        ({ a, b }) => {
          const docs = window.__paneDocs;
          const doc = docs?.a;
          if (doc === null || doc === undefined) throw new Error("the pane's doc is not mounted");
          const json = doc.toJSON();
          const surfaceId = Object.entries(json.blocks).find(([, block]) => block.type === "surface")?.[0];
          const id = doc.insertBlock("group", { members: [a, b], title: "scene" }, { parent: surfaceId! });
          doc.setGeometry(id, { x: 0, y: 0, w: 700, h: 200 });
          return id;
        },
        { a: aId, b: bId }
      );
      await zoomTo50(a, "a");

      // The border's press selects the container (the wide hit band — the
      // bottom border's world (0, 100)).
      const pG = await worldPoint(a, "a", 0, 100);
      await a.mouse.click(pG.x, pG.y);
      expect(await selectedIds(a, "a")).toEqual([groupId]);

      // The copy rides the members (the membership remaps at the paste);
      // the union center (the group's box) lands at the pointer — the
      // delta (100, 0).
      await a.keyboard.press("Control+c");
      const paste = await worldPoint(a, "a", 100, 0);
      await a.mouse.move(paste.x, paste.y);
      await a.keyboard.press("Control+v");
      const after = await blocks(a, "a");
      const groupCopy = Object.entries(after).find(([id, block]) => block.type === "group" && id !== groupId)?.[0];
      expect(groupCopy).toBeDefined();
      const copied = after[groupCopy!]!;
      expect(copied.geometry).toEqual({ x: 100, y: 0, w: 700, h: 200 });
      expect(copied.attrs?.title).toBe("scene");
      // The membership remaps onto the copy's ids (the fresh shapes).
      const members = copied.attrs?.members as string[];
      expect(members).toHaveLength(2);
      const aCopy = members.find((id) => after[id]?.attrs?.variant === "rect")!;
      const bCopy = members.find((id) => after[id]?.attrs?.variant === "ellipse")!;
      expect(aCopy).not.toBe(aId);
      expect(bCopy).not.toBe(bId);
      expect(after[aCopy]?.geometry).toEqual({ x: -200, y: 0, w: 100, h: 100 });
      expect(after[bCopy]?.geometry).toEqual({ x: 400, y: 0, w: 100, h: 100 });
      // The paste seats the selection on the container's copy; the undo
      // drops the whole copy (the members with it) and stands the
      // previous selection back.
      expect(await selectedIds(a, "a")).toEqual([groupCopy!]);
      await a.keyboard.press("Control+z");
      const afterUndo = await blocks(a, "a");
      expect(afterUndo[groupCopy!]).toBeUndefined();
      expect(afterUndo[aCopy]).toBeUndefined();
      expect(afterUndo[bCopy]).toBeUndefined();
      expect(await selectedIds(a, "a")).toEqual([groupId]);

      // The wire: the other pane carries the copy over the redo.
      await a.keyboard.press("Control+Shift+z");
      await expect.poll(async () => (await blocks(b, "b"))[groupCopy!] !== undefined, SETTLE).toBe(true);
      const bBlocks = await blocks(b, "b");
      expect(bBlocks[groupCopy!]?.geometry).toEqual({ x: 100, y: 0, w: 700, h: 200 });
      expect(bBlocks[groupCopy!]?.attrs?.members).toEqual([aCopy, bCopy]);
    } finally {
      await close();
    }
  });
});
