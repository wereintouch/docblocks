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

  test("the press-drag draw: the dashed preview follows the drag, the release over the second item connects", async ({
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

      // The press-drag: the preview stands during the drag (the dashed
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

  test("the press-drag draw: the port snaps at the press / release (the port refs)", async ({ browser }) => {
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
      // The port refs (the snap committed the edge midpoints — the line
      // stands port-to-port, not the diagonal's projected anchors).
      const portAttrs = await fullEndpointAttrs(a, "a", connector!);
      expect(portAttrs?.start).toEqual({ blockId: left, port: "east" });
      expect(portAttrs?.end).toEqual({ blockId: right, port: "west" });
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

  test("the endpoint handles: the selected line's endpoints drag to the port snap and the free point (one updateBlock each, the undo reverts)", async ({
    browser,
  }) => {
    const { a, b, close } = await twoPanes(browser, "cvs-conn-endpoints");
    try {
      await toCanvas(a, "a");
      await toCanvas(b, "b");
      const { right } = await seedShapes(a, "a");
      const dock = canvasView(a, "a").getByRole("toolbar", { name: "Canvas tools" });
      await dock.getByLabel("Connector").click();
      const center = await canvasCenter(a, "a");
      // The center-clicks stand off the ports' snap radius: the plain
      // block refs (the legacy shape).
      await pageClick(a, center.x - 300, center.y - 100);
      await pageClick(a, center.x + 300, center.y + 100);
      const connector = await connectorOf(a, "a");
      expect(connector).not.toBeNull();
      const connId = connector!;

      // The line's click selects it: the two endpoint handles stand (the
      // hit circle + the visible circle each).
      const mid = await lineMid(a, "a", connId);
      await a.mouse.click(mid.x, mid.y);
      const startHandle = a.locator(
        `[data-connector-endpoint="start"][data-connector-endpoint-id="${connId}"] circle:nth-child(2)`
      );
      const endHandle = a.locator(
        `[data-connector-endpoint="end"][data-connector-endpoint-id="${connId}"] circle:nth-child(2)`
      );
      await expect(startHandle).toHaveCount(1);
      await expect(endHandle).toHaveCount(1);

      // Drag the START endpoint to the right box's south port (the snap
      // radius stands at 12 canvas px — the release stands on it): the
      // commit is the port ref, one wire update, the other pane's line
      // re-draws from the port. The drag stands 6px SHORT of the port
      // (the stick): the line's end jumps to the port while the cursor
      // stands off it — the snap's live effect.
      const handleBox = (await startHandle.boundingBox())!;
      const southPort = { x: center.x + 300, y: center.y + 150 };
      await a.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
      await a.mouse.down();
      await a.mouse.move((handleBox.x + southPort.x) / 2, (handleBox.y + southPort.y) / 2, { steps: 8 });
      await a.mouse.move(southPort.x, southPort.y - 6, { steps: 8 });
      // The live snap stands while the drag is in flight: the green
      // connect badge over the line, the snapped port dot in the connect
      // green, and the line's end stuck at the port (not the cursor).
      await expect(a.locator(`[data-connector-snap-badge="${connId}"]`)).toHaveCount(1);
      const snappedDot = a.locator("[data-canvas-port-snapped]");
      await expect(snappedDot).toHaveCount(1);
      await expect(snappedDot).toHaveAttribute("data-canvas-port", "south");
      const stuckD = await a.locator(`[data-connector-id="${connId}"]`).getAttribute("d");
      expect(stuckD!.startsWith("M 300 150")).toBe(true);
      await a.mouse.up();
      await expect
        .poll(async () => fullEndpointAttrs(a, "a", connId), SETTLE)
        .toEqual(expect.objectContaining({ start: { blockId: right, port: "south" } }));
      const wireBefore = await outCount(a, "a");
      await expect
        .poll(async () => fullEndpointAttrs(b, "b", connId), SETTLE)
        .toEqual(expect.objectContaining({ start: { blockId: right, port: "south" } }));

      // Drag the END endpoint to the empty canvas (no port in reach): the
      // free point at the release (surface-local) WITH the FROZEN direction
      // (the end's last anchor stood the right box's south edge toward the
      // south port — the line stands its direction while in the air).
      const endBox = (await endHandle.boundingBox())!;
      const freeTo = { x: center.x - 50, y: center.y + 400 };
      await a.mouse.move(endBox.x + endBox.width / 2, endBox.y + endBox.height / 2);
      await a.mouse.down();
      await a.mouse.move((endBox.x + freeTo.x) / 2, (endBox.y + freeTo.y) / 2, { steps: 8 });
      await a.mouse.move(freeTo.x, freeTo.y, { steps: 8 });
      await a.mouse.up();
      await expect
        .poll(async () => fullEndpointAttrs(a, "a", connId), SETTLE)
        .toEqual(expect.objectContaining({ end: { x: -50, y: 400, port: "south" } }));
      const wireAfter = await outCount(a, "a");
      expect(wireAfter).toBe(wireBefore + 1); // one update per endpoint commit

      // The undo reverts the last endpoint commit (the free point drops,
      // the end ref stands back to the right box — the end's original ref).
      await a.keyboard.press("Control+z");
      await expect
        .poll(async () => fullEndpointAttrs(a, "a", connId), SETTLE)
        .toEqual(expect.objectContaining({ start: { blockId: right, port: "south" }, end: { blockId: right } }));
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

  test("the detached endpoint stands its last direction (the frozen port in the free ref; the re-connection takes the edge's side)", async ({
    browser,
  }) => {
    const { a, close } = await twoPanes(browser, "cvs-conn-free-dir");
    try {
      await toCanvas(a, "a");
      const { left, right } = await seedShapes(a, "a");
      const connId = await a.evaluate(
        ({ left, right }) => {
          const doc = window.__paneDocs?.a ?? null;
          if (doc === null) throw new Error("the pane's doc is not mounted");
          const json = doc.toJSON();
          const surfaceId = Object.entries(json.blocks).find(([, block]) => block.type === "surface")?.[0];
          if (surfaceId === undefined) throw new Error("the surface is missing");
          return doc.insertBlock(
            "connector",
            { start: { blockId: left }, end: { blockId: right }, variant: "curved" },
            { parent: surfaceId }
          );
        },
        { left, right }
      );
      const center = await canvasCenter(a, "a");
      // The line's click selects it: the endpoint handles stand.
      const mid = await lineMid(a, "a", connId);
      await a.mouse.click(mid.x, mid.y);
      const endHandle = a.locator(
        `[data-connector-endpoint="end"][data-connector-endpoint-id="${connId}"] circle:nth-child(2)`
      );

      // The end's anchor stands the right box's WEST edge (the legacy
      // anchor toward the left box). The drag to the empty canvas keeps
      // the direction in the air: the curved line's c2 control point
      // stands WEST of the free point (the frozen west normal — the line
      // leaves the point the way it left the box).
      const endBox = (await endHandle.boundingBox())!;
      const freeTo = { x: center.x - 50, y: center.y + 150 };
      await a.mouse.move(endBox.x + endBox.width / 2, endBox.y + endBox.height / 2);
      await a.mouse.down();
      await a.mouse.move((endBox.x + freeTo.x) / 2, (endBox.y + freeTo.y) / 2, { steps: 8 });
      await a.mouse.move(freeTo.x, freeTo.y, { steps: 8 });
      const dFree = (await lineD(a, "a", connId))!;
      const c2xFree = Number(dFree.split("C ")[1]!.split(",")[1]!.trim().split(" ")[0]);
      expect(c2xFree).toBeLessThan(-50);
      await a.mouse.up();
      const attrsFree = await fullEndpointAttrs(a, "a", connId);
      // The free ref stands the FROZEN direction (the last anchor's side).
      expect(attrsFree?.end).toEqual({ x: -50, y: 150, port: "west" });

      // The re-connection to the right box's EAST port takes the edge's
      // side over the frozen one: the c2 control point stands EAST of
      // the port (the line leaves the port outward).
      const rightEast = { x: center.x + 400, y: center.y + 100 };
      const endBox2 = (await endHandle.boundingBox())!;
      await a.mouse.move(endBox2.x + endBox2.width / 2, endBox2.y + endBox2.height / 2);
      await a.mouse.down();
      await a.mouse.move(rightEast.x, rightEast.y, { steps: 10 });
      await a.mouse.up();
      await expect
        .poll(async () => fullEndpointAttrs(a, "a", connId), SETTLE)
        .toEqual(expect.objectContaining({ end: { blockId: right, port: "east" } }));
      const dPort = (await lineD(a, "a", connId))!;
      const c2xPort = Number(dPort.split("C ")[1]!.split(",")[1]!.trim().split(" ")[0]);
      expect(c2xPort).toBeGreaterThan(400);
    } finally {
      await close();
    }
  });

  test("the single drag re-anchors the endpoint to the same block's other port (the own port only stands the detach)", async ({
    browser,
  }) => {
    const { a, close } = await twoPanes(browser, "cvs-conn-reanchor");
    try {
      await toCanvas(a, "a");
      const { left, right } = await seedShapes(a, "a");
      const connId = await a.evaluate(
        ({ left, right }) => {
          const doc = window.__paneDocs?.a ?? null;
          if (doc === null) throw new Error("the pane's doc is not mounted");
          const json = doc.toJSON();
          const surfaceId = Object.entries(json.blocks).find(([, block]) => block.type === "surface")?.[0];
          if (surfaceId === undefined) throw new Error("the surface is missing");
          return doc.insertBlock(
            "connector",
            { start: { blockId: left, port: "east" }, end: { blockId: right, port: "west" } },
            { parent: surfaceId }
          );
        },
        { left, right }
      );
      const center = await canvasCenter(a, "a");
      // The line's click selects it: the endpoint handles stand.
      const mid = await lineMid(a, "a", connId);
      await a.mouse.click(mid.x, mid.y);
      const endHandle = a.locator(
        `[data-connector-endpoint="end"][data-connector-endpoint-id="${connId}"] circle:nth-child(2)`
      );

      // The SINGLE continuous drag: the end at the right box's WEST port,
      // into the air, then to the right box's EAST port — the re-anchor
      // stands in one drag (the old detach rule excluded the whole own
      // block and the snap never stood). The connect badge stands BESIDE
      // the port (not the line's
      // midpoint) while over it.
      const endBox = (await endHandle.boundingBox())!;
      const rightEast = { x: center.x + 400, y: center.y + 100 };
      await a.mouse.move(endBox.x + endBox.width / 2, endBox.y + endBox.height / 2);
      await a.mouse.down();
      await a.mouse.move((endBox.x + center.x - 50) / 2, (endBox.y + center.y + 150) / 2, { steps: 8 });
      await a.mouse.move(rightEast.x, rightEast.y, { steps: 8 });
      const badge = a.locator(`[data-connector-snap-badge="${connId}"]`);
      await expect(badge).toHaveCount(1);
      // The badge's circle stands the port point + the east normal's
      // offset (400 + 16, 100).
      const badgeBox = (await badge.boundingBox())!;
      expect(Math.abs(badgeBox.x + badgeBox.width / 2 - (center.x + 416))).toBeLessThan(2);
      expect(Math.abs(badgeBox.y + badgeBox.height / 2 - (center.y + 100))).toBeLessThan(2);
      await a.mouse.up();
      await expect
        .poll(async () => fullEndpointAttrs(a, "a", connId), SETTLE)
        .toEqual(expect.objectContaining({ end: { blockId: right, port: "east" } }));
    } finally {
      await close();
    }
  });

  test("the orthogonal variant approaches the port at a right angle (the 12-px parallel run, not along the edge)", async ({
    browser,
  }) => {
    const { a, close } = await twoPanes(browser, "cvs-conn-ortho");
    try {
      await toCanvas(a, "a");
      const { left, right } = await seedShapes(a, "a");
      // The end at the right box's NORTH port (300, 50): the line
      // arrives along the edge's line (the side approach) — the old
      // shape ran along the top edge and merged into the port.
      const connId = await a.evaluate(
        ({ left, right }) => {
          const doc = window.__paneDocs?.a ?? null;
          if (doc === null) throw new Error("the pane's doc is not mounted");
          const json = doc.toJSON();
          const surfaceId = Object.entries(json.blocks).find(([, block]) => block.type === "surface")?.[0];
          if (surfaceId === undefined) throw new Error("the surface is missing");
          return doc.insertBlock(
            "connector",
            { start: { blockId: left, port: "east" }, end: { blockId: right, port: "north" }, variant: "orthogonal" },
            { parent: surfaceId }
          );
        },
        { left, right }
      );
      // The side approach: the line runs parallel to the top edge at the
      // 12-px offset OUTSIDE the box (y = 50 - 12 = 38) and turns into
      // the port at a right angle (the last segment (300, 38) ->
      // (300, 50) is vertical). The start stands the east port's 12-px
      // stub off the left box's edge (-200 + 12 = -188).
      const d = (await lineD(a, "a", connId))!;
      expect(d).toBe("M -200 -100 L -188 -100 L 56 -100 L 56 38 L 300 38 L 300 50");
    } finally {
      await close();
    }
  });

  test("the orthogonal route runs around the obstacle in the corridor (the line never crosses a figure when a clear route stands)", async ({
    browser,
  }) => {
    const { a, close } = await twoPanes(browser, "cvs-conn-avoid");
    try {
      await toCanvas(a, "a");
      const { left, right } = await seedShapes(a, "a");
      // A blocker in the default elbow's corridor: the box (56, 0,
      // 100x100) crosses the default route's vertical bend at x = 56.
      await a.evaluate(() => {
        const doc = window.__paneDocs?.a ?? null;
        if (doc === null) throw new Error("the pane's doc is not mounted");
        const json = doc.toJSON();
        const surfaceId = Object.entries(json.blocks).find(([, block]) => block.type === "surface")?.[0];
        if (surfaceId === undefined) throw new Error("the surface is missing");
        const blocker = doc.insertBlock("shape", { variant: "rect" }, { parent: surfaceId });
        doc.setGeometry(blocker, { x: 56, y: 0, w: 100, h: 100 });
      });
      const connId = await a.evaluate(
        ({ left, right }) => {
          const doc = window.__paneDocs?.a ?? null;
          if (doc === null) throw new Error("the pane's doc is not mounted");
          const json = doc.toJSON();
          const surfaceId = Object.entries(json.blocks).find(([, block]) => block.type === "surface")?.[0];
          if (surfaceId === undefined) throw new Error("the surface is missing");
          return doc.insertBlock(
            "connector",
            { start: { blockId: left, port: "east" }, end: { blockId: right, port: "north" }, variant: "orthogonal" },
            { parent: surfaceId }
          );
        },
        { left, right }
      );
      // The default elbow (the vertical bend at x = 56) crosses the
      // blocker; the first clear candidate stands (the L at the end's
      // own line: x = 300) — the line never crosses the figure.
      const d = (await lineD(a, "a", connId))!;
      expect(d).toBe("M -200 -100 L -188 -100 L 300 -100 L 300 38 L 300 50");
    } finally {
      await close();
    }
  });
});

/** The connector's full endpoint refs (the blockId / the port / the free x-y). */
async function fullEndpointAttrs(
  page: Page,
  client: "a" | "b",
  id: string
): Promise<{
  start?: { blockId?: string; port?: string; x?: number; y?: number };
  end?: { blockId?: string; port?: string; x?: number; y?: number };
} | null> {
  return page.evaluate(
    ({ client, id }) => {
      const docs = window.__paneDocs;
      const doc = (client === "a" ? docs?.a : docs?.b) ?? null;
      if (doc === null) return null;
      const block = doc.getBlock(id);
      if (block === null || block.type !== "connector") return null;
      const start = (block.attrs?.start ?? undefined) as
        { blockId?: string; port?: string; x?: number; y?: number } | undefined;
      const end = (block.attrs?.end ?? undefined) as
        { blockId?: string; port?: string; x?: number; y?: number } | undefined;
      return { start, end };
    },
    { client, id }
  );
}

/** The wire log's outbound doc-update count (awareness frames are not logged). */
async function outCount(page: Page, client: "a" | "b"): Promise<number> {
  const text = await page.getByTestId(`wire-${client}`).innerText();
  return text.match(/\] out \d+B/g)?.length ?? 0;
}

/** The real pointer click at the given screen point (a page-level helper). */
async function pageClick(page: Page, x: number, y: number): Promise<void> {
  await page.mouse.click(x, y);
}
