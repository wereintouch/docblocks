// The shape's type picker (the figure's variant's switch over the
// toolbar's menu — the figure re-renders, the other pane syncs).
import { type Page, expect, test } from "@playwright/test";

import { SETTLE, canvasCenter, canvasView, seedShape, toCanvas, twoPanes } from "./helpers";

/** Click the shape's center (selects it; the no-op press writes nothing). */
async function selectShape(page: Page, client: "a" | "b"): Promise<void> {
  const center = await canvasCenter(page, client);
  await page.mouse.click(center.x, center.y);
}

const toolbar = (page: Page, client: "a" | "b") =>
  canvasView(page, client).locator('[data-slot="docblocks/shape-toolbar"]');

test("the type picker switches the variant (the figure re-renders; the other pane syncs)", async ({ browser }) => {
  const { a, b, close } = await twoPanes(browser, "cvs-variant-switch");
  try {
    await toCanvas(a, "a");
    await toCanvas(b, "b");
    const shape = await seedShape(a, "a", { variant: "rect" }, { x: 0, y: 0, w: 200, h: 100 });
    await selectShape(a, "a");
    expect(await toolbar(a, "a").count()).toBe(1);

    await a.locator('[data-slot="docblocks/shape-toolbar-variant"]').click();
    const menu = a.locator('[aria-label="Shape types"]');
    await expect(menu).toBeVisible();
    await expect
      .poll(async () => menu.locator('[data-variant="rect"]').getAttribute("aria-checked"), SETTLE)
      .toBe("true");

    await menu.locator('[data-variant="diamond"]').click();
    const attrs = await a.evaluate((id) => {
      const doc = window.__paneDocs?.a;
      if (doc === null || doc === undefined) throw new Error("the pane's doc is not mounted");
      const block = doc.getBlock(id);
      return block?.type === "shape" ? (block.attrs?.variant as string | undefined) : undefined;
    }, shape);
    expect(attrs).toBe("diamond");

    // The figure re-renders: the rect figure is gone, the polygon stands.
    const svg = a.locator(`[data-slot="docblocks/shape"][data-block-id="${shape}"]`);
    expect(await svg.locator("rect").count()).toBe(0);
    expect(await svg.locator("polygon").count()).toBe(1);

    // One undo step reverts the switch (the focus stands on the canvas
    // container from the select press).
    await a.keyboard.press("Control+z");
    await expect
      .poll(
        async () =>
          a.evaluate((id) => {
            const doc = window.__paneDocs?.a;
            if (doc === null || doc === undefined) throw new Error("the pane's doc is not mounted");
            const block = doc.getBlock(id);
            return block?.type === "shape" ? (block.attrs?.variant as string | undefined) : undefined;
          }, shape),
        SETTLE
      )
      .toBe("rect");

    // The switch synced to the other pane before the undo; the undo
    // syncs back.
    await expect
      .poll(
        async () =>
          b.evaluate((id) => {
            const doc = window.__paneDocs?.b;
            if (doc === null || doc === undefined) throw new Error("the pane's doc is not mounted");
            const block = doc.getBlock(id);
            return block?.type === "shape" ? (block.attrs?.variant as string | undefined) : undefined;
          }, shape),
        SETTLE
      )
      .toBe("rect");
  } finally {
    await close();
  }
});
