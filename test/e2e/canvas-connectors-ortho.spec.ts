// The orthogonal route's shape: the port's right-angle approach (the
// 12-px parallel run, not along the edge, the L-shape's tiebreaker)
// and the obstacle's avoidance (the corridor's clear route — the line
// never crosses a figure when a clear route stands).
import { type Page, expect, test } from "@playwright/test";

import { toCanvas, twoPanes } from "./helpers";

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

test.describe("the connector arrows", () => {
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
      // stub off the left box's edge (-200 + 12 = -188). The route's
      // middle bend: the default elbow (3 bends) and the L-shape at the
      // end's own line (1 bend) stand the same length — the (length, bends)
      // tiebreaker picks the straighter L-shape.
      const d = (await lineD(a, "a", connId))!;
      expect(d).toBe("M -200 -100 L -188 -100 L 300 -100 L 300 38 L 300 50");
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
