// The connector arrows (the edge-to-edge lines): the two-click dock
// placement (the edge anchors + the arrowhead), the toolbar's variant
// switch (one updateBlock per pick, one undo step, the other pane
// syncs), and the line-click selection + the Delete removal (both
// panes).
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

/** The line's screen midpoint (the hit path's bbox center). */
async function lineMid(page: Page, client: "a" | "b", id: string): Promise<{ x: number; y: number }> {
  return page.evaluate(
    ({ client, id }) => {
      const view = document.querySelector(`[data-testid="doc-${client}"] [data-slot="docblocks/canvas-view"]`);
      if (view === null) throw new Error("the canvas view is missing");
      const path = view.querySelector<SVGPathElement>(`[data-connector-id="${id}"]`);
      if (path === null) throw new Error("the connector line is missing");
      const box = path.getBBox();
      const viewBox = view.getBoundingClientRect();
      return {
        x: viewBox.left + viewBox.width / 2 + (box.x + box.width / 2),
        y: viewBox.top + viewBox.height / 2 + (box.y + box.height / 2),
      };
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
  test("the dock's two-click placement creates the connector (edge anchors + the arrowhead)", async ({ browser }) => {
    const { a, b, close } = await twoPanes(browser, "cvs-conn-place");
    try {
      await toCanvas(a, "a");
      await toCanvas(b, "b");
      const { left, right } = await seedShapes(a, "a");

      // The dock's connector tool + the two endpoint clicks (the shapes'
      // screen centers).
      const dock = canvasView(a, "a").getByRole("toolbar", { name: "Canvas tools" });
      await dock.getByLabel("Connector").click();
      const centerL = await canvasCenter(a, "a");
      // The shapes stand at the canvas (-300, -100) / (300, 100) at 100%
      // zoom: the screen points are the center offset by the geometry.
      await pageClick(a, centerL.x - 300, centerL.y - 100);
      await pageClick(a, centerL.x + 300, centerL.y + 100);

      const connector = await connectorOf(a, "a");
      expect(connector).not.toBeNull();
      const attrs = await connectorAttrs(a, "a", connector!);
      expect(attrs?.start).toBe(left);
      expect(attrs?.end).toBe(right);
      // The default variant stands absent (the straight shape).
      expect(attrs?.variant).toBeUndefined();

      // The line stands in both panes; its endpoints are the EDGES (the
      // source box's east edge, the end box's west edge) — not the centers.
      await expect.poll(async () => lineD(b, "b", connector!), SETTLE).not.toBeNull();
      const d = (await lineD(a, "a", connector!))!;
      const points = d.match(/-?\d+(?:\.\d+)?/g)!.map(Number);
      expect(points.length).toBe(4); // the straight: M x y L x y
      const start = points.slice(0, 2);
      const end = points.slice(2, 4);
      expect(start[0]).toBeCloseTo(-200); // the left box's east edge (center -300 + 100)
      expect(end[0]).toBeCloseTo(200); // the right box's west edge (center 300 - 100)
      // The arrowhead marker (the per-surface def).
      const marker = await a.evaluate(
        ({ client, id }) => {
          const view = document.querySelector(`[data-testid="doc-${client}"] [data-slot="docblocks/canvas-view"]`);
          return view?.querySelector<SVGPathElement>(`[data-connector-id="${id}"]`)?.getAttribute("marker-end") ?? null;
        },
        { client: "a", id: connector }
      );
      expect(marker).toMatch(/^url\(#docblocks-conn-arrow-/);
    } finally {
      await close();
    }
  });

  test("the toolbar switches the variant (one updateBlock per pick, one undo step, the other pane syncs)", async ({
    browser,
  }) => {
    const { a, b, close } = await twoPanes(browser, "cvs-conn-variant");
    try {
      await toCanvas(a, "a");
      await toCanvas(b, "b");
      await seedShapes(a, "a");
      const dock = canvasView(a, "a").getByRole("toolbar", { name: "Canvas tools" });
      await dock.getByLabel("Connector").click();
      const center = await canvasCenter(a, "a");
      await pageClick(a, center.x - 300, center.y - 100);
      await pageClick(a, center.x + 300, center.y + 100);
      const connector = await connectorOf(a, "a");
      expect(connector).not.toBeNull();
      const connId = connector!;
      // The line's click selects it (the hit path) and stands the toolbar.
      const mid = await lineMid(a, "a", connId);
      await a.mouse.click(mid.x, mid.y);
      const toolbar = a.locator(`[data-testid="doc-a"] [data-slot="docblocks/connector-toolbar"]`);
      await expect(toolbar).toBeVisible();
      // The default (absent) variant stands no pressed VARIANT option (the
      // solid style stands pressed — the absent style's default).
      for (const v of ["straight", "orthogonal", "curved"]) {
        expect(
          await toolbar.locator(`[data-slot="docblocks/connector-toolbar-${v}"]`).getAttribute("aria-pressed")
        ).toBe("false");
      }

      // The orthogonal pick: the doc patch (the other pane syncs) and the
      // elbow path (the right angles: at least three line segments).
      await toolbar.getByLabel("Orthogonal line").click();
      await expect
        .poll(async () => connectorAttrs(b, "b", connId), SETTLE)
        .toEqual(expect.objectContaining({ variant: "orthogonal" }));
      const orthogonalD = (await lineD(a, "a", connId))!;
      const segments = orthogonalD.split(" L ").length;
      expect(segments).toBeGreaterThanOrEqual(3);

      // The curved pick: the cubic bezier (the C command in the d).
      await toolbar.getByLabel("Curved line").click();
      await expect
        .poll(async () => connectorAttrs(b, "b", connId), SETTLE)
        .toEqual(expect.objectContaining({ variant: "curved" }));
      const curvedD = (await lineD(a, "a", connId))!;
      expect(curvedD).toContain("C ");

      // One undo step reverts the curved pick (the orthogonal stands).
      await a.keyboard.press("Control+z");
      await expect
        .poll(async () => connectorAttrs(a, "a", connId), SETTLE)
        .toEqual(expect.objectContaining({ variant: "orthogonal" }));
    } finally {
      await close();
    }
  });

  test("the line's click selects it and Delete removes it (both panes)", async ({ browser }) => {
    const { a, b, close } = await twoPanes(browser, "cvs-conn-delete");
    try {
      await toCanvas(a, "a");
      await toCanvas(b, "b");
      const shapes = await seedShapes(a, "a");
      const dock = canvasView(a, "a").getByRole("toolbar", { name: "Canvas tools" });
      await dock.getByLabel("Connector").click();
      const center = await canvasCenter(a, "a");
      await pageClick(a, center.x - 300, center.y - 100);
      await pageClick(a, center.x + 300, center.y + 100);
      const connector = await connectorOf(a, "a");
      expect(connector).not.toBeNull();

      const connId = connector!;
      // The line's click: the selection (the line's data-selected) and
      // the toolbar stand.
      const mid = await lineMid(a, "a", connId);
      await a.mouse.click(mid.x, mid.y);
      await expect(a.locator(`[data-testid="doc-a"] [data-slot="docblocks/connector-toolbar"]`)).toBeVisible();

      // The Delete removes the connector (the shapes stand).
      await a.keyboard.press("Delete");
      await expect.poll(async () => connectorAttrs(a, "a", connId), SETTLE).toBeNull();
      await expect.poll(async () => lineD(b, "b", connId), SETTLE).toBeNull();
      expect(await geometryOf(a, "a", shapes.left)).not.toBeNull();
      expect(await geometryOf(a, "a", shapes.right)).not.toBeNull();
    } finally {
      await close();
    }
  });
});
