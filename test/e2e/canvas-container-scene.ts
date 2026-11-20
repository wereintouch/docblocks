// The canvas container (the reworked group)'s shared kit: the dock's
// container tool's locator, the zoom-out's stepper, the pane docs' block
// snapshots, the standard scene's seed (a group box at the right of the
// origin + a member fully inside + a figure outside), and the group's
// members' read.
import { type Page } from "@playwright/test";

import { canvasView } from "./helpers";

const dock = (page: Page, client: "a" | "b") => canvasView(page, client).getByRole("toolbar", { name: "Canvas tools" });

/** Steps the zoom down (10% per step) to the target percent; returns the factor. */
async function zoomOut(page: Page, client: "a" | "b", targetPercent: number): Promise<number> {
  const toolbar = page.getByRole("toolbar", { name: "Canvas zoom" });
  let label = (await toolbar.getByLabel("Reset zoom").textContent()) ?? "100%";
  let current = parseInt(label, 10);
  while (current > targetPercent) {
    await toolbar.getByLabel("Zoom out").click();
    label = (await toolbar.getByLabel("Reset zoom").textContent()) ?? label;
    current = parseInt(label, 10);
  }
  return parseInt(label ?? `${targetPercent}%`, 10) / 100;
}

interface CanvasBlock {
  type: string;
  geometry?: { x: number; y: number; w: number; h: number };
  attrs?: Record<string, unknown>;
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

async function seedScene(page: Page, client: "a" | "b"): Promise<{ group: string; inside: string; outside: string }> {
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
      // The container (a group with its own free box) at the right of the
      // origin, a member fully inside, and a figure outside (the drag-in's
      // source).
      const group = doc.insertBlock("group", { members: [] }, { parent: surface });
      doc.setGeometry(group, { x: 120, y: 0, w: 240, h: 160 });
      const inside = doc.insertBlock("shape", { variant: "rect" }, { parent: surface });
      doc.setGeometry(inside, { x: 100, y: 0, w: 80, h: 60 });
      const outside = doc.insertBlock("shape", { variant: "ellipse" }, { parent: surface });
      doc.setGeometry(outside, { x: -160, y: 0, w: 80, h: 60 });
      doc.transact(() => {
        doc.updateBlock(group, { members: [inside] });
      });
      return { group, inside, outside };
    },
    { client }
  );
}

/** The group's members from the doc. */
async function groupMembers(page: Page, client: "a" | "b", group: string): Promise<string[]> {
  const blocks = await docBlocks(page, client);
  return (blocks[group]?.attrs?.members as string[]) ?? [];
}

export { dock, zoomOut, docBlocks, seedScene, groupMembers };
export type { CanvasBlock };
