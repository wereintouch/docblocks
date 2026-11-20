// The canvas auto-membership over the wire: a figure created by the dock's
// tool (or the paste) whose centre stands inside a container's box joins the
// top-most container in the same transaction (the same undo step), while the
// pasted original keeps its own membership.
import { type Page, expect, test } from "@playwright/test";

import { SETTLE, canvasCenter, canvasView, toCanvas, twoPanes } from "./helpers";

interface CanvasBlock {
  type: string;
  geometry?: { x: number; y: number; w: number; h: number };
  attrs?: Record<string, unknown>;
}

async function docBlocks(page: Page, client: "a" | "b"): Promise<Record<string, CanvasBlock>> {
  return page.evaluate(
    ({ client }) => {
      const doc = (client === "a" ? window.__paneDocs?.a : window.__paneDocs?.b) ?? null;
      if (doc === null) return {};
      const json = doc.toJSON();
      const out: Record<string, CanvasBlock> = {};
      for (const [id, block] of Object.entries(json.blocks)) out[id] = block as CanvasBlock;
      return out;
    },
    { client }
  );
}

/** The container's members over the wire. */
async function membersOf(page: Page, client: "a" | "b", group: string): Promise<string[]> {
  const block = (await docBlocks(page, client))[group];
  const members = block?.attrs?.members;
  return Array.isArray(members) ? (members as string[]) : [];
}

/** The container at the pane's canvas centre (the press's seat). */
async function seedContainer(page: Page, client: "a" | "b", at: { x: number; y: number }): Promise<string> {
  return page.evaluate(
    ({ client, at }) => {
      const doc = (client === "a" ? window.__paneDocs?.a : window.__paneDocs?.b) ?? null;
      if (doc === null) throw new Error("the pane's doc is not mounted");
      const json = doc.toJSON();
      const surfaceId = Object.entries(json.blocks).find(
        ([, block]) => (block as { type: string }).type === "surface"
      )?.[0];
      const surface = surfaceId !== undefined ? surfaceId : doc.insertBlock("surface");
      const group = doc.insertBlock("group", { members: [] }, { parent: surface });
      doc.setGeometry(group, { x: at.x, y: at.y, w: 400, h: 300 });
      return group;
    },
    { client, at }
  );
}

test.describe("the canvas auto-membership", () => {
  test("the dock's figure placed inside the container joins it over the wire", async ({ browser }) => {
    const { a, b, close } = await twoPanes(browser, "auto-membership-place");
    try {
      await toCanvas(a, "a");
      await toCanvas(b, "b");
      const group = await seedContainer(a, "a", { x: 0, y: 0 });
      await expect.poll(async () => (await docBlocks(b, "b"))[group] !== undefined, SETTLE).toBe(true);
      // The dock's rect tool: the click places the default-size figure with
      // its centre at the click point (inside the container).
      const dock = canvasView(a, "a").getByRole("toolbar", { name: "Canvas tools" });
      await dock.getByLabel("Shapes").click();
      await a.getByLabel("Rectangle", { exact: true }).click();
      const center = await canvasCenter(a, "a");
      await a.mouse.click(center.x + 20, center.y + 10);
      await expect.poll(async () => (await membersOf(b, "b", group)).length, SETTLE).toBe(1);
      const blocks = await docBlocks(b, "b");
      const [member] = await membersOf(b, "b", group);
      expect(blocks[member!]?.type).toBe("shape");
    } finally {
      await close();
    }
  });

  test("the pasted copy joins the target container; the original keeps its own", async ({ browser }) => {
    const { a, b, close } = await twoPanes(browser, "auto-membership-paste");
    try {
      await toCanvas(a, "a");
      await toCanvas(b, "b");
      // The source container with its member, and the target container at the
      // pointer's side.
      const ids = await a.evaluate(() => {
        const doc = window.__paneDocs?.a ?? null;
        if (doc === null) throw new Error("the pane's doc is not mounted");
        const json = doc.toJSON();
        const surfaceId = Object.entries(json.blocks).find(
          ([, block]) => (block as { type: string }).type === "surface"
        )?.[0];
        const surface = surfaceId !== undefined ? surfaceId : doc.insertBlock("surface");
        const source = doc.insertBlock("group", { members: [] }, { parent: surface });
        doc.setGeometry(source, { x: -400, y: 0, w: 300, h: 200 });
        const member = doc.insertBlock("shape", { variant: "rect", fill: "#dbeafe" }, { parent: surface });
        doc.setGeometry(member, { x: -400, y: 0, w: 80, h: 60 });
        doc.transact(() => {
          doc.updateBlock(source, { members: [member] });
        });
        const target = doc.insertBlock("group", { members: [] }, { parent: surface });
        doc.setGeometry(target, { x: 400, y: 0, w: 300, h: 200 });
        return { source, member, target };
      });
      await expect.poll(async () => (await docBlocks(b, "b"))[ids.target] !== undefined, SETTLE).toBe(true);
      // Copy the member, paste it inside the target container (the pointer
      // stands at the target's centre).
      const center = await canvasCenter(a, "a");
      const memberPoint = { x: center.x - 400, y: center.y };
      await a.mouse.click(memberPoint.x, memberPoint.y);
      await a.keyboard.press("Control+c");
      const targetPoint = { x: center.x + 400, y: center.y };
      await a.mouse.move(targetPoint.x, targetPoint.y);
      await a.keyboard.press("Control+v");
      await expect.poll(async () => (await membersOf(b, "b", ids.target)).length, SETTLE).toBe(1);
      // The original stands in the source container.
      expect(await membersOf(b, "b", ids.source)).toEqual([ids.member]);
      const [copy] = await membersOf(b, "b", ids.target);
      expect(copy).not.toBe(ids.member);
    } finally {
      await close();
    }
  });
});
