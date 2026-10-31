// The canvas's keyboard model: the container's tab path (the real Tab over
// the page's chrome — the programmatic focus's stand is out), the arrows'
// navigation over the canvas items (the kb focus), the Enter's selection
// (the wire's parity over the nudge), and the Delete's remove.
import { type Page, expect, test } from "@playwright/test";

import { SETTLE, blockShapes, canvasView, seedShape, toCanvas, twoPanes } from "./helpers";

/** The canvas view's container's kb focus's item id (null when none). */
const kbFocusedId = (page: Page) =>
  page.evaluate(
    () =>
      document.querySelector('[data-slot="docblocks/canvas-item"][data-kb-focused]')?.getAttribute("data-block-id") ??
      null
  );

/** The Tab's path: the Tab presses (the page's chrome's stand) until the
 * canvas view's container stands the active element. */
async function tabToCanvasView(page: Page): Promise<void> {
  for (let i = 0; i < 60; i++) {
    await page.keyboard.press("Tab");
    const slot = await page.evaluate(() => (document.activeElement as HTMLElement | null)?.dataset?.slot ?? null);
    if (slot === "docblocks/canvas-view") return;
  }
  throw new Error("the canvas view's container is not in the tab path (the 60 Tab presses' stand)");
}

test("the canvas's keyboard model: the Tab's path, the arrows' navigation, the Enter's selection (the wire's parity), the Delete's remove", async ({
  browser,
}) => {
  const { a, b, close } = await twoPanes(browser, "ux09-canvas-kbd");
  try {
    const shapeId = await seedShape(a, "a", { variant: "rect" }, { x: -120, y: -60, w: 200, h: 100 });
    await toCanvas(a, "a");
    await toCanvas(b, "b");

    // The Tab's path: the container stands a tab stop (the visible's focus).
    await tabToCanvasView(a);
    await expect(canvasView(a, "a")).toBeFocused();

    // The arrows' navigation (the selection stands none): the first arrow
    // stands the first item's kb focus.
    await a.keyboard.press("ArrowRight");
    await expect.poll(async () => kbFocusedId(a), SETTLE).toBe(shapeId);

    // The Enter's selection: the item's selected stand (the role's image's
    // stand for the screen reader's — the pressed's stand is out of the
    // item's contract, the container's operations stand it).
    await a.keyboard.press("Enter");
    const item = a.locator(`[data-slot="docblocks/canvas-item"][data-block-id="${shapeId}"]`);
    await expect(item).toHaveAttribute("data-selected", "true");
    await expect(item).toHaveAttribute("role", "img");

    // The selection's arrows stand the nudge (the wire reaches B).
    await a.keyboard.press("ArrowRight");
    await expect.poll(async () => (await blockShapes(b, "b"))[shapeId]?.geometry?.x, SETTLE).toBe(-110);

    // The Delete's remove (the wire reaches B).
    await a.keyboard.press("Delete");
    await expect.poll(async () => (await blockShapes(b, "b"))[shapeId], SETTLE).toBeUndefined();
  } finally {
    await close();
  }
});
