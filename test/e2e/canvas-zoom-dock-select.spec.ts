// The select mode's stands: the M key over the live caret (the letter lands,
// the hotkey's stand off, the caret stands, the mode stands) and the
// marquee's selection (the shapes' select over the pane, the Delete's
// removal over the wire).
import { type Page, expect, test } from "@playwright/test";

import { SETTLE, canvasCenter, canvasView, seedShape, toCanvas, twoPanes } from "./helpers";

// The two-pane's settle stands the default 30s budget at its edge (the 15s
// SETTLE's panes + the page loads): the raised budget keeps the timeout
// class out of the loaded machine's flake zone (a true stall stays visible).
test.setTimeout(45_000);

/** Switch the pane to the canvas view (the harness's view toggle). */

/** The canvas-view container (the viewport's chrome root). */

/** The zoom toolbar (scoped to the pane's canvas view). */
const zoomToolbar = (page: Page, client: "a" | "b") =>
  canvasView(page, client).getByRole("toolbar", { name: "Canvas zoom" });

/** The dock (scoped to the pane's canvas view). */
const dock = (page: Page, client: "a" | "b") => canvasView(page, client).getByRole("toolbar", { name: "Canvas tools" });

/** The canvas-view center in page coordinates. */

/** Seed one canvas shape on the pane's doc (the first surface, created when absent). */

/** The shape ids on the pane's live doc. */
async function shapeIds(page: Page, client: "a" | "b"): Promise<string[]> {
  return page.evaluate(
    ({ client }) => {
      const docs = window.__paneDocs;
      const doc = (client === "a" ? docs?.a : docs?.b) ?? null;
      if (doc === null) return [];
      const json = doc.toJSON();
      return Object.entries(json.blocks)
        .filter(([, block]) => block.type === "shape")
        .map(([id]) => id);
    },
    { client }
  );
}

test.describe("the wheel's gesture", () => {
  test("the M key over the live caret stands the letter (no hotkey over the text — the caret stands, the mode stands)", async ({
    browser,
  }) => {
    const { a, close } = await twoPanes(browser, "canvas-wheel-m-caret");
    try {
      await toCanvas(a, "a");
      // The 25% zoom: the page miniature's text stands on screen (at
      // 100% the page's top stands above the viewport). The 10% step's
      // eight outs stand the 25% floor.
      for (let i = 0; i < 8; i += 1) await zoomToolbar(a, "a").getByLabel("Zoom out").click();
      await a.waitForTimeout(300);
      // Seed the paragraph and stand the caret over it (the two-click
      // contract's second press — the select mode's press's stand).
      const pid = await a.evaluate(() => {
        const doc = window.__paneDocs?.a;
        if (doc === null || doc === undefined) throw new Error("the pane's doc is not mounted");
        const p = doc.insertBlock("paragraph");
        doc.insertText(p, 0, "the line");
        return p;
      });
      expect(pid).toBeTruthy();
      const text = a.locator(
        `[data-testid="doc-a"] [data-slot="docblocks/page-card"] [data-block-id="${pid}"] [data-slot="docblocks/block-content"]`
      );
      const box = (await text.boundingBox())!;
      const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
      await a.mouse.click(point.x, point.y);
      await a.mouse.click(point.x, point.y);
      expect(await a.evaluate(() => (document.activeElement as HTMLElement | null)?.isContentEditable ?? false)).toBe(
        true
      );
      // The hand's toggle over the live caret (the pan mode's stand — the
      // mode's switch keeps the caret; the M's switch-back's target).
      await dock(a, "a").getByLabel("Switch to the pan mode").click();

      // The M key from the editing state: the letter lands (the hotkeys
      // stand off over the text), the caret stands (no blur), and the
      // mode stands the pan (no switch). The caret's seat (the click's
      // point) stands the m over it — the line's length stands +1.
      await a.keyboard.press("m");
      const state = await a.evaluate(() => ({
        editable: (document.activeElement as HTMLElement | null)?.isContentEditable ?? false,
        focus: document.activeElement?.getAttribute("data-slot") ?? null,
      }));
      expect(state).toEqual({ editable: true, focus: "docblocks/block-content" });
      expect(await dock(a, "a").getByLabel("Switch to the select mode").count()).toBe(1);
      const value = await a.evaluate((id) => {
        const block = window.__paneDocs?.a?.getBlock(id) as { content?: { text: string }[] } | null | undefined;
        return (block?.content ?? []).map((r) => r.text).join("");
      }, pid);
      expect(value).toHaveLength(9);
      expect(value).toContain("m");
    } finally {
      await close();
    }
  });
});

test.describe("the canvas marquee selection", () => {
  test("a marquee over the shapes selects them; Delete removes them in both panes", async ({ browser }) => {
    const { a, b, close } = await twoPanes(browser, "canvas-marquee");
    try {
      await toCanvas(a, "a");
      await toCanvas(b, "b");
      const s1 = await seedShape(a, "a", { variant: "rect" }, { x: -500, y: 0, w: 120, h: 80 });
      const s2 = await seedShape(a, "a", { variant: "ellipse" }, { x: 500, y: 0, w: 120, h: 80 });

      // Zoom out to 25%: the shapes stand at screen (±125, 0), the page
      // miniature shrinks to the (±45, ±60) center box — the marquee's
      // corners are the empty canvas around them.
      const zoom = zoomToolbar(a, "a");
      for (let i = 0; i < 8; i += 1) await zoom.getByLabel("Zoom out").click();
      expect(await zoom.getByLabel("Reset zoom").textContent()).toBe("25%");

      const center = await canvasCenter(a, "a");
      await a.mouse.move(center.x - 170, center.y - 70);
      await a.mouse.down();
      await a.mouse.move(center.x, center.y, { steps: 3 });
      await a.mouse.move(center.x + 170, center.y + 70, { steps: 3 });
      await a.mouse.up();

      // Both shapes carry the selection (the data-selected indicator);
      // the marquee rect is gone.
      const selected = await a
        .locator('[data-slot="docblocks/canvas-item"][data-selected]')
        .evaluateAll((els) => els.map((el) => el.dataset.blockId ?? ""));
      expect(selected.sort()).toEqual([s1, s2].sort());
      expect(await canvasView(a, "a").locator('[data-slot="docblocks/canvas-marquee"]').count()).toBe(0);

      // The selection is the pane's view state: the other pane is untouched.
      expect(await b.locator('[data-slot="docblocks/canvas-item"][data-selected]').count()).toBe(0);

      // The focus parks on the canvas container (the Delete reach — the
      // container's keydown handler owns the canvas items' removal).
      expect(await a.evaluate(() => document.activeElement?.getAttribute("data-slot"))).toBe("docblocks/canvas-view");

      await a.keyboard.press("Delete");
      await expect
        .poll(async () => shapeIds(b, "b").then((ids) => !ids.includes(s1) && !ids.includes(s2)), SETTLE)
        .toBe(true);
    } finally {
      await close();
    }
  });
});
