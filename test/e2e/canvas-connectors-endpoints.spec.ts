// The selected line's endpoint handles: the drag to the port's snap
// and the free point (one updateBlock each, the undo's revert, one
// wire update per commit), and the port's stick (the release near the
// central port locks the anchor at t = 0.5, the off-disk release
// keeps the continuous projection).
import { type Page, expect, test } from "@playwright/test";

import { SETTLE, canvasCenter, canvasView, outCount, toCanvas, twoPanes } from "./helpers";

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
  test("the endpoint handles: the selected line's endpoints drag to the port snap and the free point (one updateBlock each, the undo reverts)", async ({
    browser,
  }) => {
    const { a, b, close } = await twoPanes(browser, "cvs-conn-endpoints");
    try {
      await toCanvas(a, "a");
      await toCanvas(b, "b");
      const { right } = await seedShapes(a, "a", { vertical: true });
      const dock = canvasView(a, "a").getByRole("toolbar", { name: "Canvas tools" });
      await dock.getByLabel("Connector").click();
      const center = await canvasCenter(a, "a");
      // The vertical stand (the endpoint handles clear the selected line's
      // toolbar strip — the toolbar wins the overlap). The center-clicks
      // stand off the ports' snap radius: the plain block refs (the legacy
      // shape).
      await pageClick(a, center.x, center.y - 200);
      await pageClick(a, center.x, center.y + 150);
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

      // Drag the START endpoint to the right box's south edge (the snap
      // radius stands at 12 canvas px — the release stands on it): the
      // commit is the edge ref (the side + the fractional position along
      // it — the continuous anchor), one
      // wire update, the other pane's line re-draws from the edge's
      // point. The drag stands 6px SHORT of the edge (the stick): the
      // line's end jumps to the edge while the cursor stands off it —
      // the snap's live effect.
      const handleBox = (await startHandle.boundingBox())!;
      const southPort = { x: center.x, y: center.y + 200 };
      await a.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
      await a.mouse.down();
      await a.mouse.move((handleBox.x + southPort.x) / 2, (handleBox.y + southPort.y) / 2, { steps: 8 });
      await a.mouse.move(southPort.x, southPort.y - 6, { steps: 8 });
      // The live snap stands while the drag is in flight: the green
      // connect badge over the line, the snapped port dot in the connect
      // green, and the line's end stuck at the edge's point (not the
      // cursor).
      await expect(a.locator(`[data-connector-snap-badge="${connId}"]`)).toHaveCount(1);
      const snappedDot = a.locator("[data-canvas-port-snapped]");
      await expect(snappedDot).toHaveCount(1);
      await expect(snappedDot).toHaveAttribute("data-canvas-port", "south");
      const stuckD = await a.locator(`[data-connector-id="${connId}"]`).getAttribute("d");
      expect(stuckD!.startsWith("M 0 200")).toBe(true);
      await a.mouse.up();
      await expect
        .poll(async () => fullEndpointAttrs(a, "a", connId), SETTLE)
        .toEqual(expect.objectContaining({ start: { blockId: right, port: "south", portT: 0.5 } }));
      const wireBefore = await outCount(a, "a");
      await expect
        .poll(async () => fullEndpointAttrs(b, "b", connId), SETTLE)
        .toEqual(expect.objectContaining({ start: { blockId: right, port: "south", portT: 0.5 } }));

      // Drag the END endpoint to the empty canvas (no port in reach): the
      // free point at the release (surface-local) WITH the FROZEN direction
      // (the end's last anchor stood the right box's south edge toward the
      // south port — the line stands its direction while in the air).
      const endBox = (await endHandle.boundingBox())!;
      const freeTo = { x: center.x - 150, y: center.y + 100 };
      await a.mouse.move(endBox.x + endBox.width / 2, endBox.y + endBox.height / 2);
      await a.mouse.down();
      await a.mouse.move((endBox.x + freeTo.x) / 2, (endBox.y + freeTo.y) / 2, { steps: 8 });
      await a.mouse.move(freeTo.x, freeTo.y, { steps: 8 });
      await a.mouse.up();
      await expect
        .poll(async () => fullEndpointAttrs(a, "a", connId), SETTLE)
        .toEqual(expect.objectContaining({ end: { x: -150, y: 100, port: "south" } }));
      const wireAfter = await outCount(a, "a");
      expect(wireAfter).toBe(wireBefore + 1); // one update per endpoint commit

      // The undo reverts the last endpoint commit (the free point drops,
      // the end ref stands back to the right box — the end's original ref).
      await a.keyboard.press("Control+z");
      await expect
        .poll(async () => fullEndpointAttrs(a, "a", connId), SETTLE)
        .toEqual(
          expect.objectContaining({ start: { blockId: right, port: "south", portT: 0.5 }, end: { blockId: right } })
        );
    } finally {
      await close();
    }
  });

  test("the port's stick: the release near the edge's central port locks the anchor to the port (the continuous stand stands the rest of the edge)", async ({
    browser,
  }) => {
    const { a, close } = await twoPanes(browser, "cvs-conn-portstick");
    try {
      await toCanvas(a, "a");
      const { right } = await seedShapes(a, "a", { vertical: true });
      const dock = canvasView(a, "a").getByRole("toolbar", { name: "Canvas tools" });
      await dock.getByLabel("Connector").click();
      const center = await canvasCenter(a, "a");
      // The vertical stand (the endpoint handles clear the selected line's
      // toolbar strip — the toolbar wins the overlap). The center-clicks
      // stand off the ports' snap radius: the plain block refs (the legacy
      // shape).
      await pageClick(a, center.x, center.y - 200);
      await pageClick(a, center.x, center.y + 150);
      const connector = await connectorOf(a, "a");
      expect(connector).not.toBeNull();
      const connId = connector!;

      // The line's click selects it: the endpoint handles stand.
      const mid = await lineMid(a, "a", connId);
      await a.mouse.click(mid.x, mid.y);
      const startHandle = a.locator(
        `[data-connector-endpoint="start"][data-connector-endpoint-id="${connId}"] circle:nth-child(2)`
      );
      const handleBox = (await startHandle.boundingBox())!;

      // The bottom box's south port (the edge's central dot): (0, 200).
      // The release 10px ALONG the edge from the port, 6px off it
      // (distMid ~11.7 — inside the 12px disk): the port locks the
      // anchor at t = 0.5 (the continuous projection would stand
      // t = 0.55 — the pull is the disk's, not the edge's).
      const southPort = { x: center.x, y: center.y + 200 };
      const drop = { x: southPort.x + 10, y: southPort.y - 6 };
      await a.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
      await a.mouse.down();
      await a.mouse.move((handleBox.x + drop.x) / 2, (handleBox.y + drop.y) / 2, { steps: 8 });
      await a.mouse.move(drop.x, drop.y, { steps: 8 });
      // The live stick stands the PORT (not the cursor's edge point): the
      // line's end is stuck at the port's point, the badge over it, the
      // snapped port dot in the connect green.
      const stuckD = await a.locator(`[data-connector-id="${connId}"]`).getAttribute("d");
      expect(stuckD!.startsWith("M 0 200")).toBe(true);
      await expect(a.locator(`[data-connector-snap-badge="${connId}"]`)).toHaveCount(1);
      const snappedDot = a.locator("[data-canvas-port-snapped]");
      await expect(snappedDot).toHaveCount(1);
      await expect(snappedDot).toHaveAttribute("data-canvas-port", "south");
      await a.mouse.up();
      // The commit stands the port's anchor (t = 0.5 — the disk's lock,
      // not the continuous's 0.55).
      await expect
        .poll(async () => fullEndpointAttrs(a, "a", connId), SETTLE)
        .toEqual(expect.objectContaining({ start: { blockId: right, port: "south", portT: 0.5 } }));

      // The pull is the DISK's (12px): a release 30px along the edge
      // (distMid ~30.6 — off the disk) stands the continuous projection
      // (t = 0.65) — the edge stick keeps its stand off the port. The
      // start handle stands at the port now (the first commit); the
      // selection stands (the commit keeps it), the drag stands from
      // there.
      const dropFar = { x: center.x + 30, y: center.y + 194 };
      const handleBox2 = (await startHandle.boundingBox())!;
      await a.mouse.move(handleBox2.x + handleBox2.width / 2, handleBox2.y + handleBox2.height / 2);
      await a.mouse.down();
      await a.mouse.move((handleBox2.x + dropFar.x) / 2, (handleBox2.y + dropFar.y) / 2, { steps: 8 });
      await a.mouse.move(dropFar.x, dropFar.y, { steps: 8 });
      await a.mouse.up();
      await expect
        .poll(async () => fullEndpointAttrs(a, "a", connId), SETTLE)
        .toEqual(expect.objectContaining({ start: { blockId: right, port: "south", portT: 0.65 } }));
    } finally {
      await close();
    }
  });
});
