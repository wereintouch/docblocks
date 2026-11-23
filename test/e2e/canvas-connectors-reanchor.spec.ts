// The endpoint's re-anchoring: the detached endpoint's frozen last
// direction over the free ref (the re-connection takes the edge's
// side), and the single drag's re-anchor to the same block's other
// side (the continuous contract — the badge stands beside the edge's
// point, the firefox's circle-geometry stand over the stale rect).
import { type Page, expect, test } from "@playwright/test";

import { SETTLE, canvasCenter, toCanvas, twoPanes } from "./helpers";

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

test.describe("the connector arrows", () => {
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
        .toEqual(expect.objectContaining({ end: { blockId: right, port: "east", portT: 0.5 } }));
      const dPort = (await lineD(a, "a", connId))!;
      const c2xPort = Number(dPort.split("C ")[1]!.split(",")[1]!.trim().split(" ")[0]);
      expect(c2xPort).toBeGreaterThan(400);
    } finally {
      await close();
    }
  });

  test("the single drag re-anchors the endpoint to the same block's other side (the continuous contract)", async ({
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

      // The SINGLE continuous drag: the end at the right box's WEST edge,
      // into the air, then to the right box's EAST edge — the re-anchor
      // stands in one drag (the continuous contract — the own block's
      // edge re-anchors the endpoint, the legacy detach rule stands no
      // longer). The connect badge stands
      // BESIDE the edge's point (not the
      // line's midpoint) while over it.
      const endBox = (await endHandle.boundingBox())!;
      const rightEast = { x: center.x + 400, y: center.y + 100 };
      await a.mouse.move(endBox.x + endBox.width / 2, endBox.y + endBox.height / 2);
      await a.mouse.down();
      await a.mouse.move((endBox.x + center.x - 50) / 2, (endBox.y + center.y + 150) / 2, { steps: 8 });
      await a.mouse.move(rightEast.x, rightEast.y, { steps: 8 });
      const badge = a.locator(`[data-connector-snap-badge="${connId}"]`);
      await expect(badge).toHaveCount(1);
      // The badge's circle stands the port point + the east normal's
      // offset (400 + 16, 100). The firefox's layout rect of the svg's
      // element over the 1x1 overflow svg is stale mid-drag (the
      // attributes are current, the rect does not flush), so the
      // firefox asserts the circle's own geometry in the world space.
      if (test.info().project.name === "firefox") {
        const pos = await badge
          .locator("circle")
          .first()
          .evaluate((el) => ({
            x: Number.parseFloat(el.getAttribute("cx") ?? "0"),
            y: Number.parseFloat(el.getAttribute("cy") ?? "0"),
          }));
        expect(pos.x).toBeCloseTo(416, 1);
        expect(pos.y).toBeCloseTo(100, 1);
      } else {
        const badgeBox = (await badge.boundingBox())!;
        expect(Math.abs(badgeBox.x + badgeBox.width / 2 - (center.x + 416))).toBeLessThan(2);
        expect(Math.abs(badgeBox.y + badgeBox.height / 2 - (center.y + 100))).toBeLessThan(2);
      }
      await a.mouse.up();
      await expect
        .poll(async () => fullEndpointAttrs(a, "a", connId), SETTLE)
        .toEqual(expect.objectContaining({ end: { blockId: right, port: "east", portT: 0.5 } }));
    } finally {
      await close();
    }
  });
});
