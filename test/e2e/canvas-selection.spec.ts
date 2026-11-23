// The canvas mouse selection: the shift-click's additive toggle (the doc
// stands, the selection is view state per pane), the Escape clear, and
// the shift-marquee's union.
import { type Page, expect, test } from "@playwright/test";

import { SETTLE, canvasCenter, canvasView, toCanvas, twoPanes } from "./helpers";

// The two-pane's settle stands the default 30s budget at its edge (the 15s
// SETTLE's panes + the page loads): the raised budget keeps the timeout
// class out of the loaded machine's flake zone (a true stall stays visible).
test.setTimeout(45_000);

/** Seeds the two seeded shapes (apart) and returns their ids. */
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
      doc.setGeometry(left, { x: -200, y: 0, w: 120, h: 80 });
      const right = doc.insertBlock("shape", { variant: "ellipse" }, { parent: surface });
      doc.setGeometry(right, { x: 200, y: 0, w: 120, h: 80 });
      return { left, right };
    },
    { client }
  );
}

/** The selected ids (the data-selected wrappers). */
async function selectedIds(page: Page, client: "a" | "b"): Promise<string[]> {
  return page.evaluate(
    ({ client }) => {
      const view = document.querySelector(`[data-testid="doc-${client}"] [data-slot="docblocks/canvas-view"]`);
      if (view === null) throw new Error("the canvas view is missing");
      return Array.from(view.querySelectorAll<HTMLElement>("[data-slot='docblocks/canvas-item'][data-selected]")).map(
        (el) => el.dataset.blockId as string
      );
    },
    { client }
  );
}

/** The doc's shape geometries (the no-move pin's invariant). */
async function shapeGeometries(page: Page, client: "a" | "b"): Promise<Record<string, { x: number; y: number }>> {
  return page.evaluate(
    ({ client }) => {
      const docs = window.__paneDocs;
      const doc = (client === "a" ? docs?.a : docs?.b) ?? null;
      if (doc === null) throw new Error("the pane's doc is not mounted");
      const json = doc.toJSON();
      const result: Record<string, { x: number; y: number }> = {};
      for (const [id, block] of Object.entries(json.blocks)) {
        const loose = block as { geometry?: { x: number; y: number } };
        if (block.type === "shape" && loose.geometry !== undefined) {
          result[id] = { x: loose.geometry.x, y: loose.geometry.y };
        }
      }
      return result;
    },
    { client }
  );
}

const zoomToolbar = (page: Page, client: "a" | "b") => canvasView(page, client).getByRole("toolbar", { name: "Zoom" });

/** The screen center of a canvas item (the wrapper's box). */
async function itemCenter(page: Page, client: "a" | "b", id: string): Promise<{ x: number; y: number }> {
  const box = (await page
    .locator(`[data-testid="doc-${client}"] [data-slot="docblocks/canvas-item"][data-block-id="${id}"]`)
    .boundingBox())!;
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

test.describe("the canvas mouse selection", () => {
  test("the shift-click toggles the additive selection (the doc stands, the other pane is untouched)", async ({
    browser,
  }) => {
    const { a, b, close } = await twoPanes(browser, "cvs-sel-shift");
    try {
      await toCanvas(a, "a");
      await toCanvas(b, "b");
      const { left, right } = await seedShapes(a, "a");
      // The other pane's sync settle (the state-based stand: the seeded
      // shapes stand in B over the wire).
      await expect(
        b.locator(`[data-testid="doc-b"] [data-slot="docblocks/canvas-item"][data-block-id="${left}"]`)
      ).toHaveCount(1, SETTLE);

      // The plain click selects left alone.
      const cL = await itemCenter(a, "a", left);
      await a.mouse.click(cL.x, cL.y);
      expect(await selectedIds(a, "a")).toEqual([left]);

      // The shift-click adds right (Miro's additive select; no move).
      const cR = await itemCenter(a, "a", right);
      await a.keyboard.down("Shift");
      await a.mouse.click(cR.x, cR.y);
      await a.keyboard.up("Shift");
      expect((await selectedIds(a, "a")).sort()).toEqual([left, right].sort());
      // The doc stands (the selection is view state — no wire traffic).
      expect(await shapeGeometries(a, "a")).toEqual({
        [left]: { x: -200, y: 0 },
        [right]: { x: 200, y: 0 },
      });
      // The other pane's selection stands empty (the per-pane view state).
      expect(await selectedIds(b, "b")).toEqual([]);

      // The shift-click removes left (the toggle back).
      await a.keyboard.down("Shift");
      await a.mouse.click(cL.x, cL.y);
      await a.keyboard.up("Shift");
      expect(await selectedIds(a, "a")).toEqual([right]);
    } finally {
      await close();
    }
  });

  test("the Escape clears the standing selection (the mid-move variant stands the selection)", async ({ browser }) => {
    const { a, close } = await twoPanes(browser, "cvs-sel-escape");
    try {
      await toCanvas(a, "a");
      const { left, right } = await seedShapes(a, "a");

      // The plain clear: the click select, the Escape (the editor root's
      // blocks-selection path — the container's cancels stand before it).
      const cL = await itemCenter(a, "a", left);
      await a.mouse.click(cL.x, cL.y);
      expect(await selectedIds(a, "a")).toEqual([left]);
      await a.keyboard.press("Escape");
      expect(await selectedIds(a, "a")).toEqual([]);

      // The mid-move variant: the in-flight move's cancel stands first —
      // the preview drops, the selection STANDS, and the release writes
      // nothing.
      await a.mouse.move(cL.x, cL.y);
      await a.mouse.down();
      await a.mouse.move(cL.x + 30, cL.y + 20, { steps: 4 });
      await a.keyboard.press("Escape");
      expect(await selectedIds(a, "a")).toEqual([left]);
      await a.mouse.up();
      expect(await shapeGeometries(a, "a")).toEqual({
        [left]: { x: -200, y: 0 },
        [right]: { x: 200, y: 0 },
      });
    } finally {
      await close();
    }
  });

  test("the shift-marquee unions with the standing selection", async ({ browser }) => {
    const { a, close } = await twoPanes(browser, "cvs-sel-marquee");
    try {
      await toCanvas(a, "a");
      const { left, right } = await seedShapes(a, "a");
      // The 25% zoom (the page miniature stands small — the marquee's
      // start point stands off the card, the shapes stand near the center).
      for (let i = 0; i < 8; i += 1) await zoomToolbar(a, "a").getByLabel("Zoom out").click();
      // The zoom's reflow settle (the marquee's geometry stands over the
      // settled transform — the transient's stand, not state-based).
      await a.waitForTimeout(300);

      const cL = await itemCenter(a, "a", left);
      await a.mouse.click(cL.x, cL.y);
      expect(await selectedIds(a, "a")).toEqual([left]);

      // The shift-held marquee over the right shape only: the union stands
      // both (a replace would stand right alone). The drag stands off the
      // page miniature (the 25% card spans ±90x120 screen px) and sweeps
      // the right shape's box.
      const cR = await itemCenter(a, "a", right);
      await a.keyboard.down("Shift");
      await a.mouse.move(cR.x + 150, cR.y - 150);
      await a.mouse.down();
      await a.mouse.move(cR.x, cR.y + 80, { steps: 6 });
      await a.mouse.up();
      await a.keyboard.up("Shift");
      expect((await selectedIds(a, "a")).sort()).toEqual([left, right].sort());

      // The additive press without a drag keeps the selection (the plain
      // press would clear it): the shift click stands off the card (the
      // empty canvas — the card's shift press stands no move, no clear).
      const center = await canvasCenter(a, "a");
      await a.keyboard.down("Shift");
      await a.mouse.click(center.x + 200, center.y + 200);
      await a.keyboard.up("Shift");
      expect((await selectedIds(a, "a")).sort()).toEqual([left, right].sort());
    } finally {
      await close();
    }
  });
});
