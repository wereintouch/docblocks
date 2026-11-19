// The canvas view's viewport culling (the off-viewport items' stand — no
// DOM of their own): the in-viewport items stand their items, the
// off-viewport ones (over the margin's band) stand no DOM; the pan's
// bring-in / take-out stands the mount / unmount (the keep set's members —
// the in-flight session's items — stand un-culled).
import { type Page, expect, test } from "@playwright/test";

import { canvasCenter, canvasView, editorContext, openPane, switchPaneView } from "./helpers";

/** The cull scene: the near shape (the center) + the far shape (the
 * off-viewport over the 300px margin's band). */
async function seedCullScene(page: Page): Promise<void> {
  await page.evaluate(() => {
    const doc = window.__paneDocs?.a;
    if (doc === null || doc === undefined) throw new Error("the pane's doc is not mounted");
    doc.transact(() => {
      const surface = doc.insertBlock("surface");
      const near = doc.insertBlock("shape", { variant: "rect" }, { parent: surface });
      doc.setGeometry(near, { x: 0, y: 0, w: 100, h: 80 });
      const far = doc.insertBlock("shape", { variant: "ellipse" }, { parent: surface });
      doc.setGeometry(far, { x: 5000, y: 0, w: 100, h: 80 });
    });
  });
}

/** The doc's shapes' count (the seed's stand — the DOM's count stands
 * the culling's viewport). */
const shapesCount = (page: Page) =>
  page.evaluate(() => Object.values(window.__paneDocs?.a?.toJSON().blocks ?? {}).filter((b) => b.type === "shape").length);

/** The cull scene's connector: the near (the center) + the far shape
 * (the off-viewport over the 300px margin's band) over the line between
 * them (the line's cull box is the endpoints' boxes' union — the line
 * stands mounted while either endpoint stands over the margin's band).
 * Returns the line's id (the DOM's stand over the wrapper's data-block-
 * id). */
async function seedFarConnector(page: Page): Promise<string> {
  return page.evaluate(() => {
    const doc = window.__paneDocs?.a;
    if (doc === null || doc === undefined) throw new Error("the pane's doc is not mounted");
    let line = "";
    doc.transact(() => {
      const surface = doc.insertBlock("surface");
      const near = doc.insertBlock("shape", { variant: "rect" }, { parent: surface });
      doc.setGeometry(near, { x: 0, y: 0, w: 100, h: 80 });
      const far = doc.insertBlock("shape", { variant: "ellipse" }, { parent: surface });
      doc.setGeometry(far, { x: 5000, y: 0, w: 100, h: 80 });
      line = doc.insertBlock("connector", { start: { blockId: near }, end: { blockId: far } }, { parent: surface });
    });
    return line;
  });
}

/** The viewport's stored stand (the zoom's 100% / no pan): the entry's
 * fit stands off (the wide scene's fit zooms out over the content's
 * union — the culling's stand needs the 100% zoom's viewport). The
 * harness's pane doc id stands the fixed `d1`. */
async function pinViewport(page: Page): Promise<void> {
  await page.evaluate(() => {
    const key = "docblocks.canvas-viewport.v1";
    const raw = window.localStorage.getItem(key);
    const map = raw !== null ? JSON.parse(raw) : {};
    map["d1"] = { zoom: 1, pan: { x: 0, y: 0 } };
    window.localStorage.setItem(key, JSON.stringify(map));
  });
}

/** Pan the canvas by the screen delta (the pan mode's drag — the
 * incremental moves over the viewport's bounds). */
async function panBy(page: Page, dx: number): Promise<void> {
  const modeButton = canvasView(page, "a").locator('[data-slot="docblocks/canvas-dock"]').first();
  await modeButton.getByLabel("Switch to the pan mode").click();
  const { x, y } = await canvasCenter(page, "a");
  const steps = Math.ceil(Math.abs(dx) / 400);
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let i = 1; i <= steps; i += 1) {
    await page.mouse.move(x + (dx * i) / steps, y);
  }
  await page.mouse.up();
}

test.describe("the canvas view's viewport culling", () => {
  test("the off-viewport item stands no DOM; the pan's bring-in stands the mount", async ({ browser }) => {
    const context = await editorContext(browser);
    const page = await context.newPage();
    const room = `canvas-culling-${Math.random().toString(36).slice(2, 8)}`;
    try {
      await openPane(page, "a", room);
      await seedCullScene(page);
      await pinViewport(page);
      await switchPaneView(page, "a", "canvas");

      // The seed's stand over the doc's data.
      expect(await shapesCount(page)).toBe(2);

      // The near shape stands its item, the far shape (off-viewport over
      // the margin's band) stands none.
      const items = canvasView(page, "a").locator('[data-slot="docblocks/canvas-item"]');
      await expect(items).toHaveCount(1);

      // The pan's bring-in (the 4500px drag to the left at the 100%
      // zoom): the far shape (the canvas's +5000) enters the viewport
      // (its mount) and the near shape leaves (its unmount) — the count
      // stands, the ids flip.
      const nearBefore = await items.first().getAttribute("data-block-id");
      await panBy(page, -4500);
      await expect(items).toHaveCount(1);
      const farAfter = await items.first().getAttribute("data-block-id");
      expect(farAfter).not.toBe(nearBefore);
    } finally {
      await context.close();
    }
  });

  test("the line over the off-viewport endpoint stands drawn (the endpoint's resolution stands the full children, not the keep set)", async ({
    browser,
  }) => {
    const context = await editorContext(browser);
    const page = await context.newPage();
    const room = `canvas-culling-${Math.random().toString(36).slice(2, 8)}`;
    try {
      await openPane(page, "a", room);
      const line = await seedFarConnector(page);
      await pinViewport(page);
      await switchPaneView(page, "a", "canvas");

      // The near shape + the line stand (the far shape over the margin's
      // band stands culled — the line's cull box is the endpoints' union).
      const items = canvasView(page, "a").locator('[data-slot="docblocks/canvas-item"]');
      await expect(items).toHaveCount(2);
      const lineItem = canvasView(page, "a").locator(`[data-slot="docblocks/canvas-item"][data-block-id="${line}"]`);
      // The line stands DRAWN while its far endpoint stands culled (the
      // endpoint's resolution stands the surface's full children — the
      // culling's keep set must not thin the siblings' context).
      await expect(lineItem).not.toHaveAttribute("data-missing");
      await expect(canvasView(page, "a").locator(`[data-connector-id="${line}"]`)).toHaveCount(1);
      const d = await canvasView(page, "a").locator(`[data-connector-id="${line}"]`).getAttribute("d");
      expect(d ?? "").toMatch(/^M /);

      // The pan's bring-in (the 4500px drag to the left at the 100%
      // zoom): the far shape enters (its mount) and the near shape
      // leaves (its unmount) — the line stands drawn over the now-culled
      // near endpoint.
      await panBy(page, -4500);
      await expect(items).toHaveCount(2);
      await expect(lineItem).not.toHaveAttribute("data-missing");
      await expect(canvasView(page, "a").locator(`[data-connector-id="${line}"]`)).toHaveCount(1);
    } finally {
      await context.close();
    }
  });
});
