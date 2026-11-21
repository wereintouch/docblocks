// The shape color toolbar's portaled palette (the input, the content
// focus): keys from it never reach the editor root's key handling (the
// selection and the shape stand).
import { type Page, expect, test } from "@playwright/test";

import { canvasCenter, canvasView, seedShape, toCanvas, twoPanes } from "./helpers";

/** Click the shape's center (selects it; the no-op press writes nothing). */
async function selectShape(page: Page, client: "a" | "b"): Promise<void> {
  const center = await canvasCenter(page, client);
  await page.mouse.click(center.x, center.y);
}

const toolbar = (page: Page, client: "a" | "b") =>
  canvasView(page, client).locator('[data-slot="docblocks/shape-toolbar"]');

test.describe("the shape color toolbar", () => {
  test("keys from the portaled palette (the input, the content focus) never delete the selection", async ({
    browser,
  }) => {
    const { a, close } = await twoPanes(browser, "cvs-color-hex-keys");
    try {
      await toCanvas(a, "a");
      const shape = await seedShape(a, "a", { variant: "rect" }, { x: 0, y: 0, w: 200, h: 100 });
      await selectShape(a, "a");

      await a.locator('[data-slot="docblocks/shape-toolbar-fill"]').click();
      const hex = a.locator('[data-slot="docblocks/shape-fill-hex"]');

      // The input stands portaled in the document body (outside the
      // editor root). A Backspace / Delete on it must not reach the
      // editor root's key handling: with the blocks selection live,
      // those keys would remove the selected blocks.
      await hex.press("Backspace");
      await hex.press("Delete");

      // The input keys are guarded: the shape and its selection stand.
      expect(await toolbar(a, "a").count()).toBe(1);

      // The radix content div is focusable (tabIndex -1): a real press on
      // its padding would stand the focus there. The palette's mousedown
      // guard suppresses the focus transfer (a key on that focus would
      // delete the selection — neither key guard covers a plain div).
      const palette = a.locator('[data-slot="docblocks/shape-fill-palette"]');
      await palette.click({ position: { x: 4, y: 4 } });
      const active = await a.evaluate(() => document.activeElement?.getAttribute("data-slot") ?? null);
      expect(active).not.toBe("docblocks/shape-fill-palette");

      // The backstop: even a programmatic focus on the content div (the
      // tabIndex -1 allows it) must not delete the shape (the canvas
      // container's key handler runs the DOM-containment guard; the root
      // handler's removeBlocksSelection skips the shape — it is no
      // page-sequence member).
      await a.evaluate(() => {
        (document.querySelector('[data-slot="docblocks/shape-fill-palette"]') as HTMLElement).focus();
      });
      await a.keyboard.press("Backspace");
      await a.keyboard.press("Delete");

      const alive = await a.evaluate((id) => {
        const doc = window.__paneDocs?.a;
        if (doc === null || doc === undefined) throw new Error("the pane's doc is not mounted");
        return doc.getBlock(id) !== null;
      }, shape);
      expect(alive).toBe(true);
    } finally {
      await close();
    }
  });
});
