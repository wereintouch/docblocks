// The shape toolbar's text color's reset cross: the cross stands over the
// row's tail (after all the swatches), the active stand over the set
// `textColor`, the pick removes the attr (the core's `removeBlockAttr` —
// one update on both panes), and the undo restores it.
import { type Page, expect, test } from "@playwright/test";

import { SETTLE, canvasCenter, canvasView, seedShape, toCanvas, twoPanes } from "./helpers";

async function textColorOf(page: Page, client: "a" | "b", id: string): Promise<string | undefined> {
  return page.evaluate(
    ({ client, id }) => {
      const doc = (client === "a" ? window.__paneDocs?.a : window.__paneDocs?.b) ?? null;
      if (doc === null) return undefined;
      const block = doc.getBlock(id);
      if (block === null || block.type !== "shape") return undefined;
      return block.attrs?.textColor as string | undefined;
    },
    { client, id }
  );
}

async function selectShape(page: Page, client: "a" | "b"): Promise<void> {
  const center = await canvasCenter(page, client);
  await page.mouse.click(center.x, center.y);
}

test.describe("the shape text color's reset cross", () => {
  test("the cross stands over the row's tail; the pick removes the textColor (the undo restores)", async ({
    browser,
  }) => {
    const { a, b, close } = await twoPanes(browser, "cvs-shape-text-reset");
    try {
      await toCanvas(a, "a");
      const shape = await seedShape(a, "a", { variant: "rect", text: "hello" }, { x: 0, y: 0, w: 200, h: 100 });
      await a.evaluate((id) => {
        window.__paneDocs?.a?.updateBlock(id, { textColor: "#123456" });
      }, shape);
      await expect.poll(() => textColorOf(a, "a", shape), SETTLE).toBe("#123456");

      // The toolbar's text section: the trigger's press opens the palette.
      await selectShape(a, "a");
      const toolbar = canvasView(a, "a").locator('[data-slot="docblocks/shape-toolbar"]');
      const trigger = toolbar.locator('[data-slot="docblocks/shape-toolbar-text"]');
      await expect(trigger).toBeVisible();
      await trigger.click();
      const palette = a.locator('[data-slot="docblocks/shape-text-palette"]');
      await expect(palette).toBeVisible();

      // The cross stands over the row's tail (after all the swatches,
      // before the custom's entry), its active stand is the set color.
      const none = palette.locator('[data-slot="docblocks/palette-none"]');
      await expect(none).toBeVisible();
      await expect(none).toHaveAttribute("aria-label", "Reset color");
      await expect(none).toHaveAttribute("aria-pressed", "true");
      const layout = await palette.evaluate((el) => {
        const buttons = Array.from(el.querySelectorAll("button"));
        return {
          swatches: buttons.filter((b) => b.getAttribute("data-slot") === "docblocks/palette-swatch").length,
          customIndex: buttons.findIndex((b) => b.getAttribute("data-slot") === "docblocks/palette-custom"),
          noneIndex: buttons.findIndex((b) => b.getAttribute("data-slot") === "docblocks/palette-none"),
        };
      });
      expect(layout.noneIndex).toBe(layout.swatches);
      expect(layout.customIndex).toBe(layout.swatches + 1);

      // The pick: the attr's removal (the other attrs stand) reaches the
      // peer (the wire's parity); the section closes.
      await none.click();
      await expect
        .poll(async () => ({ a: await textColorOf(a, "a", shape), b: await textColorOf(b, "b", shape) }), SETTLE)
        .toEqual({
          a: undefined,
          b: undefined,
        });
      const attrs = await a.evaluate((id) => {
        const doc = window.__paneDocs?.a ?? null;
        const block = doc === null ? null : doc.getBlock(id);
        return block === null || block.type !== "shape" ? null : block.attrs;
      }, shape);
      expect(attrs).toMatchObject({ variant: "rect", text: "hello" });
      await expect(palette).toBeHidden();

      // The undo's restore stands the cross's active stand again (the
      // reopen's stand).
      await a.keyboard.press("Control+z");
      await expect.poll(() => textColorOf(a, "a", shape), SETTLE).toBe("#123456");
    } finally {
      await close();
    }
  });
});
