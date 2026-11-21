// The connector's draw session: the press-drag's preview over the
// drag (the release over the second item connects), the two-click
// pick's hover preview before the second click, the press / release's
// edge snap (the edge refs with the position along them), and the
// port dots' visibility over the active connector tool.
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
  test("the press-drag draw: the preview follows the drag, the release over the second item connects", async ({
    browser,
  }) => {
    const { a, b, close } = await twoPanes(browser, "cvs-conn-drag");
    try {
      await toCanvas(a, "a");
      await toCanvas(b, "b");
      const { left, right } = await seedShapes(a, "a");

      const dock = canvasView(a, "a").getByRole("toolbar", { name: "Canvas tools" });
      await dock.getByLabel("Connector").click();
      const center = await canvasCenter(a, "a");
      const from = { x: center.x - 300, y: center.y - 100 };
      const to = { x: center.x + 300, y: center.y + 100 };

      // The press-drag: the preview stands during the drag (the solid
      // line, the 1x1 svg), the release over the right shape connects.
      await a.mouse.move(from.x, from.y);
      await a.mouse.down();
      await a.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 8 });
      const preview = a.locator('[data-slot="docblocks/canvas-connector-preview"]');
      await expect(preview).toBeVisible();
      // The preview stands on a 1x1 svg (a 0x0 svg rasterizes no content
      // in Chromium).
      expect(await preview.getAttribute("width")).toBe("1");
      await a.mouse.move(to.x, to.y, { steps: 8 });
      await a.mouse.up();

      const connector = await connectorOf(a, "a");
      expect(connector).not.toBeNull();
      const attrs = await connectorAttrs(a, "a", connector!);
      expect(attrs?.start).toBe(left);
      expect(attrs?.end).toBe(right);
      await expect.poll(async () => a.locator('[data-slot="docblocks/canvas-connector-preview"]').count()).toBe(0);
      // The line stands in both panes (the sticky re-anchor pin).
      await expect.poll(async () => lineD(b, "b", connector!), SETTLE).not.toBeNull();
    } finally {
      await close();
    }
  });

  test("the two-click pick: the hover preview follows the cursor before the second click", async ({ browser }) => {
    const { a, b, close } = await twoPanes(browser, "cvs-conn-hover");
    try {
      await toCanvas(a, "a");
      await toCanvas(b, "b");
      const { left, right } = await seedShapes(a, "a");

      const dock = canvasView(a, "a").getByRole("toolbar", { name: "Canvas tools" });
      await dock.getByLabel("Connector").click();
      const center = await canvasCenter(a, "a");

      // The first click stands the pending endpoint + the preview line.
      // The picked shape stands clean: the pick's indicator is the dashed
      // preview line only (no selection outline / tint on the shape itself).
      await pageClick(a, center.x - 300, center.y - 100);
      const pendingItem = a.locator(`[data-slot="docblocks/canvas-item"][data-connector-pending="true"]`);
      await expect(pendingItem).toHaveCount(1);
      expect(await pendingItem.evaluate((el) => getComputedStyle(el).outlineStyle)).toBe("none");
      expect(await pendingItem.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe("rgba(0, 0, 0, 0)");

      // The hover move re-feeds the far end (the 100% zoom, the zero pan:
      // the canvas point is the client point offset from the view center).
      // The target stands off the shape's axis — a zero-height box (the
      // cursor on the axis) reads hidden to the visibility check.
      const mid = { x: center.x - 100, y: center.y - 180 };
      await a.mouse.move(mid.x, mid.y, { steps: 5 });
      const previewLine = a.locator('[data-slot="docblocks/canvas-connector-preview"] line');
      await expect(previewLine).toBeVisible();
      const x2 = Number((await previewLine.getAttribute("x2"))!);
      const y2 = Number((await previewLine.getAttribute("y2"))!);
      expect(x2).toBeCloseTo(mid.x - center.x, 0);
      expect(y2).toBeCloseTo(mid.y - center.y, 0);

      // The second click completes: the connector lands, the preview
      // drops (the center-click stands off the ports' snap radius — the
      // plain block refs).
      await pageClick(a, center.x + 300, center.y + 100);
      const connector = await connectorOf(a, "a");
      expect(connector).not.toBeNull();
      const attrs = await connectorAttrs(a, "a", connector!);
      expect(attrs?.start).toBe(left);
      expect(attrs?.end).toBe(right);
      await expect.poll(async () => a.locator('[data-slot="docblocks/canvas-connector-preview"]').count()).toBe(0);
      await expect.poll(async () => lineD(b, "b", connector!), SETTLE).not.toBeNull();
    } finally {
      await close();
    }
  });

  test("the press-drag draw: the edge snaps at the press / release (the edge refs with the position along them)", async ({
    browser,
  }) => {
    const { a, close } = await twoPanes(browser, "cvs-conn-portsnap");
    try {
      await toCanvas(a, "a");
      const { left, right } = await seedShapes(a, "a");
      const dock = canvasView(a, "a").getByRole("toolbar", { name: "Canvas tools" });
      await dock.getByLabel("Connector").click();
      const center = await canvasCenter(a, "a");
      // The left box's east port (the east edge's midpoint) and the right
      // box's west port — the press / release stand exactly on them (the
      // 100% zoom, the zero pan: the canvas point is the center offset by
      // the geometry).
      const eastPort = { x: center.x - 200, y: center.y - 100 };
      const westPort = { x: center.x + 200, y: center.y + 100 };

      await a.mouse.move(eastPort.x, eastPort.y);
      await a.mouse.down();
      await a.mouse.move((eastPort.x + westPort.x) / 2, (eastPort.y + westPort.y) / 2, { steps: 8 });
      await a.mouse.move(westPort.x, westPort.y, { steps: 8 });
      await a.mouse.up();

      const connector = await connectorOf(a, "a");
      expect(connector).not.toBeNull();
      // The edge refs (the snap committed the sides at the press / release
      // projections — the t = 0.5 midpoint stand; the line stands
      // edge-to-edge, not the diagonal's projected anchors).
      const portAttrs = await fullEndpointAttrs(a, "a", connector!);
      expect(portAttrs?.start).toEqual({ blockId: left, port: "east", portT: 0.5 });
      expect(portAttrs?.end).toEqual({ blockId: right, port: "west", portT: 0.5 });
      // The line's M point is the east port (the left box's east edge at
      // the box's center y).
      const d = (await lineD(a, "a", connector!))!;
      const m = d.match(/^M (-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?)/);
      expect(m).not.toBeNull();
      expect(Number(m![1])).toBeCloseTo(-200);
      expect(Number(m![2])).toBeCloseTo(-100);
    } finally {
      await close();
    }
  });

  test("the ports' visibility: the four edge dots stand while the connector tool is active (and only then)", async ({
    browser,
  }) => {
    const { a, close } = await twoPanes(browser, "cvs-conn-portdots");
    try {
      await toCanvas(a, "a");
      const shapes = await seedShapes(a, "a");
      void shapes;
      const dock = canvasView(a, "a").getByRole("toolbar", { name: "Canvas tools" });

      // The resting canvas: no port dots.
      expect(await a.locator('[data-slot="docblocks/canvas-port-dots"]').count()).toBe(0);

      // The connector tool active: the dots stand (four per shape).
      await dock.getByLabel("Connector").click();
      await expect(a.locator('[data-slot="docblocks/canvas-port-dots"] circle')).toHaveCount(8);

      // The tool's reset drops the dots.
      await dock.getByLabel("Connector").click();
      await expect(a.locator('[data-slot="docblocks/canvas-port-dots"]')).toHaveCount(0);
    } finally {
      await close();
    }
  });
});
