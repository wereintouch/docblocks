// The canvas drill-down: the Alt press steps the stack of the objects under
// the point (from its top, wrapping, with the `i / N` indicator), the
// session stays positional (a pause between the Alt presses does not reset
// it), the plain repeat press steps over a click (a drag stands the move
// instead), the double-click over an inline-editable target keeps its
// editor, and the touch tap steps over the wider radius.
import { type Page, expect, test } from "@playwright/test";

import { SETTLE, canvasCenter, caretIn, toCanvas, twoPanes } from "./helpers";

interface CanvasBlock {
  type: string;
  geometry?: { x: number; y: number; w: number; h: number };
  attrs?: Record<string, unknown>;
}

async function docBlocks(page: Page, client: "a" | "b"): Promise<Record<string, CanvasBlock>> {
  return page.evaluate(
    ({ client }) => {
      const doc = (client === "a" ? window.__paneDocs?.a : window.__paneDocs?.b) ?? null;
      if (doc === null) return {};
      const json = doc.toJSON();
      const out: Record<string, CanvasBlock> = {};
      for (const [id, block] of Object.entries(json.blocks)) out[id] = block as CanvasBlock;
      return out;
    },
    { client }
  );
}

/** The overlapping pair at the canvas center: the later shape paints on top
 * (the stack's top). */
async function seedStack(page: Page, client: "a" | "b"): Promise<{ top: string; bottom: string }> {
  return page.evaluate(
    ({ client }) => {
      const doc = (client === "a" ? window.__paneDocs?.a : window.__paneDocs?.b) ?? null;
      if (doc === null) throw new Error("the pane's doc is not mounted");
      const json = doc.toJSON();
      const surfaceId = Object.entries(json.blocks).find(
        ([, block]) => (block as { type: string }).type === "surface"
      )?.[0];
      const surface = surfaceId !== undefined ? surfaceId : doc.insertBlock("surface");
      const bottom = doc.insertBlock("shape", { variant: "rect", fill: "#dbeafe" }, { parent: surface });
      doc.setGeometry(bottom, { x: 0, y: 0, w: 240, h: 160 });
      const top = doc.insertBlock("shape", { variant: "rect", fill: "#fee2e2" }, { parent: surface });
      doc.setGeometry(top, { x: 0, y: 0, w: 160, h: 100 });
      return { top, bottom };
    },
    { client }
  );
}

/** The selected canvas item ids. */
async function selectedIds(page: Page, client: "a" | "b"): Promise<string[]> {
  return page
    .locator(`[data-testid="doc-${client}"] [data-slot="docblocks/canvas-item"][data-selected]`)
    .evaluateAll((elements) => elements.map((element) => element.dataset.blockId ?? ""));
}

/** The `i / N` indicator's read (null outside its fade). */
const indicator = (page: Page) => page.locator('[data-slot="docblocks/canvas-cycle-indicator"]');

/** The Alt press (the modifier held over the click). */
async function altClick(page: Page, point: { x: number; y: number }): Promise<void> {
  await page.keyboard.down("Alt");
  await page.mouse.click(point.x, point.y);
  await page.keyboard.up("Alt");
}

/** The shape's screen box center (the shared point of the concentric pair). */
async function shapeCenter(page: Page, client: "a" | "b", id: string): Promise<{ x: number; y: number }> {
  const box = (await page
    .locator(`[data-testid="doc-${client}"] [data-slot="docblocks/canvas-item"][data-block-id="${id}"]`)
    .boundingBox())!;
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

test.describe("the canvas drill-down", () => {
  test("the Alt press steps the stack from its top, wraps, and stands the i / N indicator", async ({ browser }) => {
    const { a, close } = await twoPanes(browser, "canvas-cycle-alt");
    try {
      await toCanvas(a, "a");
      const { top, bottom } = await seedStack(a, "a");
      await expect.poll(async () => (await docBlocks(a, "a"))[top] !== undefined, SETTLE).toBe(true);
      const point = await shapeCenter(a, "a", top);
      // The first Alt press enters at the top (the paint order's last).
      await altClick(a, point);
      expect(await selectedIds(a, "a")).toEqual([top]);
      await expect(indicator(a)).toHaveCount(1);
      expect(await indicator(a).getAttribute("data-index")).toBe("1");
      expect(await indicator(a).getAttribute("data-count")).toBe("2");
      expect(await indicator(a).textContent()).toBe("1 / 2");
      // The next press steps down.
      await altClick(a, point);
      expect(await selectedIds(a, "a")).toEqual([bottom]);
      expect(await indicator(a).getAttribute("data-index")).toBe("2");
      // The wrap stands the top again.
      await altClick(a, point);
      expect(await selectedIds(a, "a")).toEqual([top]);
      expect(await indicator(a).getAttribute("data-index")).toBe("1");
      // The indicator is transient.
      await expect(indicator(a)).toHaveCount(0, { timeout: 3_000 });
    } finally {
      await close();
    }
  });

  test("the session is positional: a pause between the Alt presses does not reset it", async ({ browser }) => {
    const { a, close } = await twoPanes(browser, "canvas-cycle-pause");
    try {
      await toCanvas(a, "a");
      const { top, bottom } = await seedStack(a, "a");
      await expect.poll(async () => (await docBlocks(a, "a"))[top] !== undefined, SETTLE).toBe(true);
      const point = await shapeCenter(a, "a", top);
      await altClick(a, point);
      expect(await selectedIds(a, "a")).toEqual([top]);
      await a.waitForTimeout(1_500);
      await altClick(a, point);
      expect(await selectedIds(a, "a")).toEqual([bottom]);
    } finally {
      await close();
    }
  });

  test("the plain repeat click steps the stack; a click-then-drag still moves the figure", async ({ browser }) => {
    const { a, close } = await twoPanes(browser, "canvas-cycle-plain");
    try {
      await toCanvas(a, "a");
      const { top, bottom } = await seedStack(a, "a");
      await expect.poll(async () => (await docBlocks(a, "a"))[top] !== undefined, SETTLE).toBe(true);
      const point = await shapeCenter(a, "a", top);
      // The first click selects the top (the press's zone).
      await a.mouse.click(point.x, point.y);
      expect(await selectedIds(a, "a")).toEqual([top]);
      // The repeat click steps down (the click's own entry, not a drag).
      await a.mouse.click(point.x, point.y);
      expect(await selectedIds(a, "a")).toEqual([bottom]);
      await expect(indicator(a)).toHaveAttribute("data-index", "2");
      // A fresh press after the window: a plain select of the top again.
      await a.waitForTimeout(1_200);
      await a.mouse.click(point.x, point.y);
      expect(await selectedIds(a, "a")).toEqual([top]);
      // The click-then-drag moves the pressed figure (the drag wins over the
      // drill-down): the top's geometry follows the delta.
      const before = await docBlocks(a, "a");
      await a.mouse.move(point.x, point.y);
      await a.mouse.down();
      await a.mouse.move(point.x + 40, point.y + 20, { steps: 4 });
      await a.mouse.up();
      await expect
        .poll(async () => (await docBlocks(a, "a"))[top]?.geometry, SETTLE)
        .toEqual({
          x: before[top]!.geometry!.x + 40,
          y: before[top]!.geometry!.y + 20,
          w: 160,
          h: 100,
        });
    } finally {
      await close();
    }
  });

  test("the double-click over the canvas text keeps its editor (the cycle does not steal it)", async ({ browser }) => {
    const { a, close } = await twoPanes(browser, "canvas-cycle-text");
    try {
      await toCanvas(a, "a");
      const id = await a.evaluate(() => {
        const doc = window.__paneDocs?.a ?? null;
        if (doc === null) throw new Error("the pane's doc is not mounted");
        const json = doc.toJSON();
        const surfaceId = Object.entries(json.blocks).find(
          ([, block]) => (block as { type: string }).type === "surface"
        )?.[0];
        const surface = surfaceId !== undefined ? surfaceId : doc.insertBlock("surface");
        const text = doc.insertBlock("canvas-text", undefined, { parent: surface });
        doc.setGeometry(text, { x: 0, y: 0, w: 240, h: 80 });
        doc.insertText(text, 0, "note");
        return text;
      });
      const center = await canvasCenter(a, "a");
      await a.mouse.dblclick(center.x, center.y);
      expect(
        await caretIn(
          a,
          `[data-testid="doc-a"] [data-slot="docblocks/canvas-item"][data-block-id="${id}"] [data-slot="docblocks/block-content"]`
        )
      ).toBe(true);
      expect(await indicator(a).count()).toBe(0);
    } finally {
      await close();
    }
  });
});

test.describe("the canvas drill-down (touch)", () => {
  test.use({ hasTouch: true });

  test("the repeat tap steps the stack over the wider radius", async ({ browser }) => {
    const { a, close } = await twoPanes(browser, "canvas-cycle-touch");
    try {
      await toCanvas(a, "a");
      const { top, bottom } = await seedStack(a, "a");
      await expect.poll(async () => (await docBlocks(a, "a"))[top] !== undefined, SETTLE).toBe(true);
      const point = await shapeCenter(a, "a", top);
      await a.evaluate(() => {
        const log: string[] = [];
        (window as unknown as { __ph: string[] }).__ph = log;
        const view = document.querySelector('[data-slot="docblocks/canvas-view"]');
        for (const type of ["pointerdown", "pointerup", "pointercancel", "pointermove"]) {
          view?.addEventListener(
            type,
            (event) => {
              const pointer = event as PointerEvent;
              log.push(
                `${type}:${pointer.pointerType}:${pointer.detail}:${Math.round(pointer.clientX)},${Math.round(pointer.clientY)}`
              );
            },
            true
          );
        }
      });
      await a.touchscreen.tap(point.x, point.y);
      expect(await selectedIds(a, "a")).toEqual([top]);
      // The second tap 12 px away stands inside the touch's radius (the
      // mouse's 8 px would miss): the stack steps.
      await a.touchscreen.tap(point.x + 12, point.y);
      expect(await selectedIds(a, "a")).toEqual([bottom]);
      expect(await indicator(a).getAttribute("data-index")).toBe("2");
    } finally {
      await close();
    }
  });
});
