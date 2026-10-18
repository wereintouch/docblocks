import { type Browser, type Page, expect, test } from "@playwright/test";

// The connector arrows (the edge-to-edge lines): the two-click dock
// placement, the edge anchors (the line leaves the source box's edge, the
// arrowhead stands at the end box's edge), the sticky behavior (a moved
// block re-anchors the line — the doc carries only the geometry), the
// variant switch over the toolbar (one updateBlock per pick, one undo
// step, the other pane syncs), and the line-click selection + Delete.
const RELAY = "ws://localhost:5199";
const SETTLE = { timeout: 15_000 };

async function openPane(page: Page, client: "a" | "b", room: string): Promise<void> {
  await page.goto(`/?client=${client}&syncUrl=${RELAY}/${room}`);
  await expect(page.getByTestId(`status-${client}`)).toHaveText("connected");
}

async function twoPanes(browser: Browser, room: string): Promise<{ a: Page; b: Page; close: () => Promise<void> }> {
  const contextA = await browser.newContext();
  const contextB = await browser.newContext();
  const a = await contextA.newPage();
  const b = await contextB.newPage();
  const uniqueRoom = `${room}-${Math.random().toString(36).slice(2, 8)}`;
  await openPane(a, "a", uniqueRoom);
  await openPane(b, "b", uniqueRoom);
  return {
    a,
    b,
    close: async () => {
      await contextA.close();
      await contextB.close();
    },
  };
}

async function toCanvas(page: Page, client: "a" | "b"): Promise<void> {
  await page.getByTestId(`view-${client}-canvas`).click();
}

const canvasView = (page: Page, client: "a" | "b") =>
  page.locator(`[data-testid="doc-${client}"] [data-slot="docblocks/canvas-view"]`);

async function canvasCenter(page: Page, client: "a" | "b"): Promise<{ x: number; y: number }> {
  const box = (await canvasView(page, client).boundingBox())!;
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** Seeds the two seeded shapes (left / right) and returns their ids. */
async function seedShapes(page: Page, client: "a" | "b"): Promise<{ left: string; right: string }> {
  return page.evaluate(
    ({ client }) => {
      const docs = window.__paneDocs;
      const doc = (client === "a" ? docs?.a : docs?.b) ?? null;
      if (doc === null) throw new Error("the pane's doc is not mounted");
      const json = doc.toJSON();
      const surfaceId = Object.entries(json.blocks).find(([, block]) => block.type === "surface")?.[0];
      const surface = surfaceId !== undefined ? surfaceId : doc.insertBlock("surface");
      const left = doc.insertBlock("shape", { variant: "rect" }, { parent: surface });
      doc.setGeometry(left, { x: -300, y: -100, w: 200, h: 100 });
      const right = doc.insertBlock("shape", { variant: "rect" }, { parent: surface });
      doc.setGeometry(right, { x: 300, y: 100, w: 200, h: 100 });
      return { left, right };
    },
    { client }
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
      // The default (absent) variant stands no pressed option.
      expect(await toolbar.locator('[aria-pressed="true"]').count()).toBe(0);

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

/** The real pointer click at the given screen point (a page-level helper). */
async function pageClick(page: Page, x: number, y: number): Promise<void> {
  await page.mouse.click(x, y);
}
