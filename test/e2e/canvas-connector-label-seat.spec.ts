// The connector's label chip's seat on the line: the chip's center stands
// on the visible line (the dist-to-path's zero) for the port-pairs and on
// the curve for the curved variant (the label-in-the-air's guard).
import { type Page, expect, test } from "@playwright/test";

import { SETTLE, switchPaneView, twoPanes } from "./helpers";

// The label chip's dist to the connector's polyline (the label-in-the-air
// guard — the chip's center stands on the visible line).
// The path's `d` stands the world's space; the chip's screen offset from the
// view's center stands the world's offset (the zoom-1 / pan-0 stand).
async function chipDistToPath(page: Page, client: "a" | "b"): Promise<number> {
  return page.evaluate((c) => {
    const doc = document.querySelector(`[data-testid="doc-${c}"]`)!;
    const path = doc.querySelector<SVGPathElement>("[data-connector-id]")!;
    const d = path.getAttribute("d")!;
    const nums = d
      .split(/[^0-9.eE-]+/)
      .filter(Boolean)
      .map(Number);
    const pts: Array<{ x: number; y: number }> = [];
    for (let i = 0; i + 1 < nums.length; i += 2) {
      pts.push({ x: nums[i]!, y: nums[i + 1]! });
    }
    const chip = doc.querySelector<HTMLElement>("[data-connector-label]")!;
    const chipRect = chip.getBoundingClientRect();
    const view = doc.querySelector<HTMLElement>('[data-slot="docblocks/canvas-view"]')!;
    const rect = view.getBoundingClientRect();
    const seat = {
      x: chipRect.x + chipRect.width / 2 - (rect.x + rect.width / 2),
      y: chipRect.y + chipRect.height / 2 - (rect.y + rect.height / 2),
    };
    let min = Infinity;
    for (let i = 0; i < pts.length - 1; i++) {
      const p = pts[i]!;
      const q = pts[i + 1]!;
      const dx = q.x - p.x;
      const dy = q.y - p.y;
      const lenSq = dx * dx + dy * dy;
      const t = lenSq === 0 ? 0 : Math.max(0, Math.min(1, ((seat.x - p.x) * dx + (seat.y - p.y) * dy) / lenSq));
      min = Math.min(min, Math.hypot(seat.x - (p.x + t * dx), seat.y - (p.y + t * dy)));
    }
    return min;
  }, client);
}
// The label chip's dist to the connector's CURVE (the label-in-the-air
// guard for the curved variant — the chip's center stands on the
// visible bezier). The path's `d` = `M a.x a.y C c1.x c1.y c2.x c2.y b.x
// b.y` (the world's space); the chip's screen offset from the view's center
// stands the world's offset (the zoom-1 / pan-0 stand).
async function chipDistToBezier(page: Page, client: "a" | "b"): Promise<number> {
  return page.evaluate((c) => {
    const doc = document.querySelector(`[data-testid="doc-${c}"]`)!;
    const path = doc.querySelector<SVGPathElement>("[data-connector-id]")!;
    const d = path.getAttribute("d")!;
    const nums = d
      .split(/[^0-9.eE-]+/)
      .filter(Boolean)
      .map(Number);
    const a = { x: nums[0]!, y: nums[1]! };
    const c1 = { x: nums[2]!, y: nums[3]! };
    const c2 = { x: nums[4]!, y: nums[5]! };
    const b = { x: nums[6]!, y: nums[7]! };
    const chip = doc.querySelector<HTMLElement>("[data-connector-label]")!;
    const chipRect = chip.getBoundingClientRect();
    const view = doc.querySelector<HTMLElement>('[data-slot="docblocks/canvas-view"]')!;
    const rect = view.getBoundingClientRect();
    const seat = {
      x: chipRect.x + chipRect.width / 2 - (rect.x + rect.width / 2),
      y: chipRect.y + chipRect.height / 2 - (rect.y + rect.height / 2),
    };
    let min = Infinity;
    for (let i = 0; i <= 100; i++) {
      const t = i / 100;
      const u = 1 - t;
      const x = u * u * u * a.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * b.x;
      const y = u * u * u * a.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * b.y;
      min = Math.min(min, Math.hypot(seat.x - x, seat.y - y));
    }
    return min;
  }, client);
}

test("the label's chip stands on the line for the port-pairs (the dist-to-path stands zero — the label in the air)", async ({
  browser,
}) => {
  const { a, b, close } = await twoPanes(browser, "canvas-conn-chip-on-line");
  try {
    await switchPaneView(a, "a", "canvas");
    await switchPaneView(b, "b", "canvas");
    // The scene: A (top) + B (below and right) + an orthogonal
    // labeled connector. The ports are swapped per pair — the chip's seat
    // stands the polyline's longest run (the endpoints' straight mid would
    // stand in the air off the line).
    await a.evaluate(() => {
      const doc = window.__paneDocs?.a ?? null;
      if (doc === null) throw new Error("the pane's doc is not mounted");
      (window as unknown as { __scene: unknown }).__scene = null;
      doc.transact(() => {
        const surface = doc.insertBlock("surface");
        const sa = doc.insertBlock("shape", { variant: "rect" }, { parent: surface });
        doc.setGeometry(sa, { x: 0, y: 0, w: 100, h: 100 });
        const sb = doc.insertBlock("shape", { variant: "rect" }, { parent: surface });
        doc.setGeometry(sb, { x: 100, y: 200, w: 100, h: 100 });
        const conn = doc.insertBlock(
          "connector",
          {
            start: { blockId: sa, port: "south" },
            end: { blockId: sb, port: "west" },
            variant: "orthogonal",
            label: "on the line",
          },
          { parent: surface }
        );
        (window as unknown as { __scene: unknown }).__scene = { conn, sa, sb };
      });
    });
    const scene = (await a.evaluate(
      () => (window as unknown as { __scene: { conn: string; sa: string; sb: string } }).__scene
    ))!;
    // The wire's settle (the scene stands in B — the pane's own render).
    await expect.poll(async () => await b.locator("[data-connector-label]").count(), SETTLE).toBe(1);
    // The scene's pairs (bottom->left, top->right, left->right,
    // bottom->bottom): the chip stands on the line in BOTH panes (the
    // dist-to-path stands zero — no air).
    const pairs: Array<[string, string]> = [
      ["south", "west"],
      ["north", "east"],
      ["west", "west"],
      ["south", "south"],
    ];
    for (const [sPort, ePort] of pairs) {
      await a.evaluate(
        ({ sa, sb, conn, sp, ep }) => {
          const doc = window.__paneDocs?.a ?? null;
          if (doc === null) throw new Error("the pane's doc is not mounted");
          doc.updateBlock(conn, { start: { blockId: sa, port: sp }, end: { blockId: sb, port: ep } });
        },
        { sa: scene.sa, sb: scene.sb, conn: scene.conn, sp: sPort, ep: ePort }
      );
      await expect.poll(async () => await chipDistToPath(a, "a"), SETTLE).toBeLessThan(3);
      await expect.poll(async () => await chipDistToPath(b, "b"), SETTLE).toBeLessThan(3);
    }
  } finally {
    await close();
  }
});

// The label chip's stand on the CURVE: the curved variant's bow stands off
// the endpoints' straight mid, so the straight-mid seat (the former stand)
// hung in the air off the bow. The chip stands on the curve (the bezier's
// t = 0.5) in BOTH panes (the dist-to-curve stands zero — no air).

test("the label's chip stands on the curve for the curved variant (the dist-to-curve stands zero)", async ({
  browser,
}) => {
  const { a, b, close } = await twoPanes(browser, "canvas-conn-chip-on-curve");
  try {
    await switchPaneView(a, "a", "canvas");
    await switchPaneView(b, "b", "canvas");
    // The curve scene: a big rounded rect (start, the south port) +
    // a square (end, the west port) + a CURVED labeled connector. The curve
    // bows out — the endpoints' straight mid stands in the air off the bow.
    await a.evaluate(() => {
      const doc = window.__paneDocs?.a ?? null;
      if (doc === null) throw new Error("the pane's doc is not mounted");
      doc.transact(() => {
        const surface = doc.insertBlock("surface");
        const sa = doc.insertBlock("shape", { variant: "rounded" }, { parent: surface });
        doc.setGeometry(sa, { x: -200, y: -150, w: 300, h: 300 });
        const sb = doc.insertBlock("shape", { variant: "rect" }, { parent: surface });
        doc.setGeometry(sb, { x: 200, y: 100, w: 150, h: 150 });
        doc.insertBlock(
          "connector",
          {
            start: { blockId: sa, port: "south" },
            end: { blockId: sb, port: "west" },
            variant: "curved",
            label: "curve",
          },
          { parent: surface }
        );
      });
    });
    // The wire's settle (the scene stands in B — the pane's own render).
    await expect.poll(async () => await b.locator("[data-connector-label]").count(), SETTLE).toBe(1);
    // The chip stands on the curve in BOTH panes (the dist-to-curve stands
    // zero — the former straight-mid seat stood ~60px off the bow).
    await expect.poll(async () => await chipDistToBezier(a, "a"), SETTLE).toBeLessThan(3);
    await expect.poll(async () => await chipDistToBezier(b, "b"), SETTLE).toBeLessThan(3);
  } finally {
    await close();
  }
});
