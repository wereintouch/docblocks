// The container's copy over the canvas copy/paste: the membership remaps
// onto the copy's ids (the fresh shapes at the shifted position, the
// group's box + the title stand), the one undo step drops the whole copy,
// the other pane carries the copy over the wire.
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
