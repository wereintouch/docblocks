// The connector's edge / port snap stands: the release on the empty
// canvas commits the free point ref, the hover snap's circle + the
// connect badge at the edge point (the port's lock), and the press's
// edge snap stand (the free point + the frozen direction, the end's
// stick to the port, the self-pair's guard).
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

/** The connector's full endpoint refs (the blockId / the port / the free x-y). */
async function fullEndpointAttrs(
  page: Page,
  client: "a" | "b",
  id: string
): Promise<{
  start?: { blockId?: string; port?: string; portT?: number; x?: number; y?: number };
  end?: { blockId?: string; port?: string; portT?: number; x?: number; y?: number };
} | null> {
  return page.evaluate(
    ({ client, id }) => {
      const docs = window.__paneDocs;
      const doc = (client === "a" ? docs?.a : docs?.b) ?? null;
      if (doc === null) return null;
      const block = doc.getBlock(id);
      if (block === null || block.type !== "connector") return null;
      const start = (block.attrs?.start ?? undefined) as
        { blockId?: string; port?: string; portT?: number; x?: number; y?: number } | undefined;
      const end = (block.attrs?.end ?? undefined) as
        { blockId?: string; port?: string; portT?: number; x?: number; y?: number } | undefined;
      return { start, end };
    },
    { client, id }
  );
}

/** The real pointer click at the given screen point (a page-level helper). */
async function pageClick(page: Page, x: number, y: number): Promise<void> {
  await page.mouse.click(x, y);
}

test.describe("the connector arrows", () => {
  test("the press-drag draw: the release on the empty canvas commits the free end (the free point ref)", async ({
    browser,
  }) => {
    const { a, b, close } = await twoPanes(browser, "cvs-conn-freedrag");
    try {
      await toCanvas(a, "a");
      await toCanvas(b, "b");
      const { left } = await seedShapes(a, "a");
      const dock = canvasView(a, "a").getByRole("toolbar", { name: "Canvas tools" });
      await dock.getByLabel("Connector").click();
      const center = await canvasCenter(a, "a");

      // The press on the left shape, the drag far off it (well past the
      // threshold), the release on the empty canvas (the page card's right
      // band, the view's inside): the end commits as a free point at the
      // release point (the world px — the 100% zoom / zero pan points
      // stand as the center offsets).
      const from = { x: center.x - 300, y: center.y - 100 };
      const to = { x: center.x + 390, y: center.y };
      await a.mouse.move(from.x, from.y);
      await a.mouse.down();
      await a.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 8 });
      await a.mouse.move(to.x, to.y, { steps: 8 });
      await a.mouse.up();

      const connector = await connectorOf(a, "a");
      expect(connector).not.toBeNull();
      const freeAttrs = await fullEndpointAttrs(a, "a", connector!);
      expect(freeAttrs?.start?.blockId).toBe(left);
      // The release stands off any port (the 12px snap radius): the free
      // point at the release point (world px).
      expect(freeAttrs?.end).toEqual({ x: 390, y: 0 });
      // The free end stands in the other pane (the sync pin).
      await expect.poll(async () => fullEndpointAttrs(b, "b", connector!), SETTLE).toEqual(freeAttrs);
      // The line stands (a line to a free point — not skipped).
      await expect.poll(async () => lineD(b, "b", connector!), SETTLE).not.toBeNull();
    } finally {
      await close();
    }
  });

  test("the hover snap before the stand: the circle + the connect badge at the edge point (the port's lock)", async ({
    browser,
  }) => {
    const { a, close } = await twoPanes(browser, "cvs-conn-hoversnap");
    try {
      await toCanvas(a, "a");
      await seedShapes(a, "a");
      const dock = canvasView(a, "a").getByRole("toolbar", { name: "Canvas tools" });
      await dock.getByLabel("Connector").click();
      const center = await canvasCenter(a, "a");
      // The left box's east edge at x = -200 (the box's center y = -100,
      // the port at (-200, -100)). The hover 5px off the edge at
      // y = -70 (30px from the port — the continuous edge's stand).
      const hover = { x: center.x - 205, y: center.y - 70 };
      await a.mouse.move(hover.x, hover.y, { steps: 4 });
      const hoverSnap = a.locator('[data-slot="docblocks/canvas-connector-hover-snap"]');
      await expect(hoverSnap).toBeVisible();
      // The circle stands at the SNAPPED edge point (the box's edge —
      // not the cursor's point): the world's px (the svg's center-anchor
      // space, the 100% zoom / zero pan).
      const circle = hoverSnap.locator("circle").first();
      expect(Number(await circle.getAttribute("cx"))).toBeCloseTo(-200, 0);
      expect(Number(await circle.getAttribute("cy"))).toBeCloseTo(-70, 0);
      // The connect badge stands outside along the edge's outward normal
      // (the east side: the badge's center at the point's +x offset).
      const badge = hoverSnap.locator("circle").nth(1);
      expect(Number(await badge.getAttribute("cx"))).toBeCloseTo(-184, 0);
      expect(Number(await badge.getAttribute("cy"))).toBeCloseTo(-70, 0);

      // The port's stick disk: the hover 4px from the east port locks the
      // circle at the port's point (the t = 0.5 stand).
      await a.mouse.move(center.x - 200, center.y - 104, { steps: 4 });
      await expect(hoverSnap).toBeVisible();
      expect(Number(await circle.getAttribute("cx"))).toBeCloseTo(-200, 0);
      expect(Number(await circle.getAttribute("cy"))).toBeCloseTo(-100, 0);

      // The hover far off the edges: the stand drops.
      await a.mouse.move(center.x, center.y + 400, { steps: 4 });
      await expect(hoverSnap).toBeHidden();
      // No press stood the connector (the hover is the view state only).
      expect(await connectorOf(a, "a")).toBeNull();
    } finally {
      await close();
    }
  });

  test("the press-drag draw: the press's edge snap stands the stand (the free point + the frozen direction), the preview stands from it, the end sticks to the port", async ({
    browser,
  }) => {
    const { a, b, close } = await twoPanes(browser, "cvs-conn-pressstand");
    try {
      await toCanvas(a, "a");
      await toCanvas(b, "b");
      const { left, right } = await seedShapes(a, "a");
      const dock = canvasView(a, "a").getByRole("toolbar", { name: "Canvas tools" });
      await dock.getByLabel("Connector").click();
      const center = await canvasCenter(a, "a");

      // The press 2px inside the left box's east edge at y = -70 (30px
      // from the east port — the continuous edge's stand, the edge's
      // point at (-200, -70)).
      const press = { x: center.x - 202, y: center.y - 70 };
      await a.mouse.move(press.x, press.y, { steps: 4 });
      await a.mouse.down();
      const previewLine = a.locator('[data-slot="docblocks/canvas-connector-preview"] line');
      // The line stands at the press (zero length at the press point —
      // the end's snap stands the stand's point itself — the visibility
      // stands over the drag below).
      await expect(previewLine).toHaveCount(1);
      // The preview stands from the SNAPPED edge point (the stand —
      //), not the cursor's raw point.
      expect(Number(await previewLine.getAttribute("x1"))).toBeCloseTo(-200, 0);
      expect(Number(await previewLine.getAttribute("y1"))).toBeCloseTo(-70, 0);
      // The preview end's snap badge stands (the cursor is within the
      // edge's snap radius of the press).
      const previewSnap = a.locator('[data-slot="docblocks/canvas-connector-preview-snap"]');
      await expect(previewSnap).toBeVisible();

      // The drag to the right box's west port's disk (the port at
      // (200, 100), the cursor at (208, 108) — the 11.3px stand): the
      // preview end sticks to the port's point (not the cursor's).
      const to = { x: center.x + 208, y: center.y + 108 };
      await a.mouse.move((press.x + to.x) / 2, (press.y + to.y) / 2, { steps: 8 });
      await a.mouse.move(to.x, to.y, { steps: 8 });
      expect(Number(await previewLine.getAttribute("x2"))).toBeCloseTo(200, 0);
      expect(Number(await previewLine.getAttribute("y2"))).toBeCloseTo(100, 0);
      // The line stands visible over the drag (the stand's point to the
      // snapped port — the non-zero length).
      await expect(previewLine).toBeVisible();
      await a.mouse.up();

      const connector = await connectorOf(a, "a");
      expect(connector).not.toBeNull();
      const attrs = await fullEndpointAttrs(a, "a", connector!);
      // The start's stand: the free point at the snapped edge point +
      // the frozen direction (the snapped side) — not the cursor's
      // point, not the plain block ref.
      expect(attrs?.start).toEqual({ x: -200, y: -70, port: "east" });
      // The end's release snap (the port's disk): the port ref (the
      // release commit's contract).
      expect(attrs?.end).toEqual({ blockId: right, port: "west", portT: 0.5 });
      // The stand stands in the other pane (the sync pin).
      await expect.poll(async () => fullEndpointAttrs(b, "b", connector!), SETTLE).toEqual(attrs);
      await expect.poll(async () => lineD(b, "b", connector!), SETTLE).not.toBeNull();

      // The self-pair guard (the press's source block): the new stand
      // over the edge, the second press over the same block cancels —
      // the degenerate line stands no commit.
      await dock.getByLabel("Connector").click();
      await a.mouse.move(press.x, press.y, { steps: 4 });
      await pageClick(a, press.x, press.y);
      await pageClick(a, center.x - 300, center.y - 100);
      const connectorCount = await a.evaluate(() => {
        const docs = window.__paneDocs;
        const doc = docs?.a ?? null;
        if (doc === null) return -1;
        const json = doc.toJSON();
        return Object.values(json.blocks).filter((block) => block.type === "connector").length;
      });
      expect(connectorCount).toBe(1);
      expect(left).toBeTruthy();
    } finally {
      await close();
    }
  });
});
