// The line's sticky follow over a moved item: the other pane's
// re-anchor (the doc carries only the geometry), and the mid-drag's
// live geometry (the release commit stands the same line — no re-draw
// jump, the other pane's re-anchor from the committed geometry).
import { type Page, expect, test } from "@playwright/test";

import { SETTLE, canvasCenter, canvasView, toCanvas, twoPanes } from "./helpers";

// The two-pane's settle stands the default 30s budget at its edge (the 15s
// SETTLE's panes + the page loads): the raised budget keeps the timeout
// class out of the loaded machine's flake zone (a true stall stays visible).
test.setTimeout(45_000);

/** Seeds the two seeded shapes (left / right) and returns their ids. The
 *  vertical stand (the boxes stacked at (0, -200) and (0, 150)): the
 *  endpoint handles stand clear of the selected line's toolbar strip (the
 *  toolbar's overlap wins over the handles by the z-order's contract — the
 *  handles stand reachable only off the strip), and the bottom box's south
 *  port (0, 200) stands off the canvas dock's bottom band.
 */
async function seedShapes(
  page: Page,
  client: "a" | "b",
  opts?: { vertical?: boolean }
): Promise<{ left: string; right: string }> {
  return page.evaluate(
    ({ client, vertical }) => {
      const docs = window.__paneDocs;
      const doc = (client === "a" ? docs?.a : docs?.b) ?? null;
      if (doc === null) throw new Error("the pane's doc is not mounted");
      const json = doc.toJSON();
      const surfaceId = Object.entries(json.blocks).find(([, block]) => block.type === "surface")?.[0];
      const surface = surfaceId !== undefined ? surfaceId : doc.insertBlock("surface");
      const left = doc.insertBlock("shape", { variant: "rect" }, { parent: surface });
      doc.setGeometry(left, vertical ? { x: 0, y: -200, w: 200, h: 100 } : { x: -300, y: -100, w: 200, h: 100 });
      const right = doc.insertBlock("shape", { variant: "rect" }, { parent: surface });
      doc.setGeometry(right, vertical ? { x: 0, y: 150, w: 200, h: 100 } : { x: 300, y: 100, w: 200, h: 100 });
      return { left, right };
    },
    { client, vertical: opts?.vertical ?? false }
  );
}

/** The connector block between the two shapes (the first direct surface child of the type). */
async function connectorOf(page: Page, client: "a" | "b"): Promise<string | null> {
  return page.evaluate(
    ({ client }) => {
      const docs = window.__paneDocs;
      const doc = (client === "a" ? docs?.a : docs?.b) ?? null;
      if (doc === null) return null;
      const json = doc.toJSON();
      const surfaceId = Object.entries(json.blocks).find(([, block]) => block.type === "surface")?.[0];
      if (surfaceId === undefined) return null;
      const surface = json.blocks[surfaceId];
      if (surface === undefined) return null;
      const connectorId = surface.children?.find((id: string) => json.blocks[id]?.type === "connector");
      return connectorId ?? null;
    },
    { client }
  );
}

async function connectorAttrs(
  page: Page,
  client: "a" | "b",
  id: string
): Promise<{ variant?: string; start?: string; end?: string } | null> {
  return page.evaluate(
    ({ client, id }) => {
      const docs = window.__paneDocs;
      const doc = (client === "a" ? docs?.a : docs?.b) ?? null;
      if (doc === null) return null;
      const block = doc.getBlock(id);
      if (block === null || block.type !== "connector") return null;
      return {
        variant: block.attrs?.variant as string | undefined,
        start: (block.attrs?.start as { blockId?: string } | undefined)?.blockId,
        end: (block.attrs?.end as { blockId?: string } | undefined)?.blockId,
      };
    },
    { client, id }
  );
}

/** The connector line's path data (the visible path's d). */
async function lineD(page: Page, client: "a" | "b", id: string): Promise<string | null> {
  return page.evaluate(
    ({ client, id }) => {
      const view = document.querySelector(`[data-testid="doc-${client}"] [data-slot="docblocks/canvas-view"]`);
      if (view === null) return null;
      return view.querySelector<SVGPathElement>(`[data-connector-id="${id}"]`)?.getAttribute("d") ?? null;
    },
    { client, id }
  );
}

/** The shape's geometry (the harness doc global). */
async function geometryOf(page: Page, client: "a" | "b", id: string): Promise<{ x: number; y: number } | null> {
  return page.evaluate(
    ({ client, id }) => {
      const docs = window.__paneDocs;
      const doc = (client === "a" ? docs?.a : docs?.b) ?? null;
      if (doc === null) return null;
      const block = doc.getBlock(id) as { geometry?: { x: number; y: number } } | null;
      if (block === null || block.geometry === undefined) return null;
      return { x: block.geometry.x, y: block.geometry.y };
    },
    { client, id }
  );
}

/** The real pointer click at the given screen point (a page-level helper). */
async function pageClick(page: Page, x: number, y: number): Promise<void> {
  await page.mouse.click(x, y);
}

test.describe("the connector arrows", () => {
  test("the line is sticky: a moved block re-anchors it (the doc carries only the geometry)", async ({ browser }) => {
    const { a, b, close } = await twoPanes(browser, "cvs-conn-sticky");
    try {
      await toCanvas(a, "a");
      await toCanvas(b, "b");
      const { left, right } = await seedShapes(a, "a");
      const dock = canvasView(a, "a").getByRole("toolbar", { name: "Canvas tools" });
      await dock.getByLabel("Connector").click();
      const center = await canvasCenter(a, "a");
      await pageClick(a, center.x - 300, center.y - 100);
      await pageClick(a, center.x + 300, center.y + 100);
      const connector = await connectorOf(a, "a");
      expect(connector).not.toBeNull();
      const before = (await lineD(b, "b", connector!))!;

      // Drag the left shape (the real pointer move + release).
      const boxL = (await a
        .locator(`[data-testid="doc-a"] [data-slot="docblocks/canvas-item"][data-block-id="${left}"]`)
        .boundingBox())!;
      await a.mouse.move(boxL.x + boxL.width / 2, boxL.y + boxL.height / 2);
      await a.mouse.down();
      await a.mouse.move(boxL.x + boxL.width / 2 + 80, boxL.y + boxL.height / 2 + 50, { steps: 8 });
      await a.mouse.up();

      // The other pane's line re-anchors (the edge anchor moves with the
      // box) while the doc change is the geometry only.
      await expect.poll(async () => lineD(b, "b", connector!), SETTLE).toBe((await lineD(a, "a", connector!))!);
      const moved = await lineD(a, "a", connector!);
      expect(moved).not.toBeNull();
      expect(moved).not.toBe(before);
      // The doc: the left shape's geometry moved; the connector's attrs
      // stand untouched (the refs — not coordinates — carry the link).
      const movedGeom = await geometryOf(a, "a", left);
      expect(movedGeom?.x).toBeCloseTo(-220);
      expect(movedGeom?.y).toBeCloseTo(-50);
      const rightGeom = await geometryOf(a, "a", right);
      expect(rightGeom).toEqual({ x: 300, y: 100 });
      const attrs = await connectorAttrs(a, "a", connector!);
      expect(attrs?.start).toBe(left);
      expect(attrs?.end).toBe(right);
    } finally {
      await close();
    }
  });

  test("the line follows the moved item mid-drag (the live geometry; the release commit stands the same line)", async ({
    browser,
  }) => {
    const { a, b, close } = await twoPanes(browser, "cvs-conn-follow");
    try {
      await toCanvas(a, "a");
      await toCanvas(b, "b");
      const { left, right } = await seedShapes(a, "a");
      const connector = await a.evaluate(
        ({ left, right }) => {
          const doc = window.__paneDocs?.a ?? null;
          if (doc === null) throw new Error("the pane's doc is not mounted");
          const json = doc.toJSON();
          const surfaceId = Object.entries(json.blocks).find(([, block]) => block.type === "surface")?.[0];
          if (surfaceId === undefined) throw new Error("the surface is missing");
          return doc.insertBlock(
            "connector",
            { start: { blockId: left }, end: { blockId: right } },
            { parent: surfaceId }
          );
        },
        { left, right }
      );
      const center = await canvasCenter(a, "a");
      const d0 = (await lineD(a, "a", connector))!;

      // The move: the press on the left shape (the select + the move
      // session), the drag 50px right — the line's start follows the item
      // MID-DRAG (the live geometry stands the anchor, not the stored
      // box).
      await a.mouse.move(center.x - 300, center.y - 100);
      await a.mouse.down();
      await a.mouse.move(center.x - 250, center.y - 100, { steps: 6 });
      const d1 = (await lineD(a, "a", connector))!;
      expect(d1).not.toBe(d0);

      // The release commits the geometry; the line stands the SAME (the
      // doc and the preview stand from one number — no re-draw jump on
      // the release).
      await a.mouse.up();
      const d2 = await lineD(a, "a", connector);
      expect(d2).toBe(d1);
      await expect.poll(async () => geometryOf(a, "a", left), SETTLE).toEqual({ x: -250, y: -100 });
      // The follow stands in the other pane (the sync pin): the line
      // re-anchors from the committed geometry.
      await expect.poll(async () => lineD(b, "b", connector), SETTLE).toBe(d2);
    } finally {
      await close();
    }
  });
});
