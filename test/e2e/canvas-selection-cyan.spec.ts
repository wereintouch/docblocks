// The selection's cyan contract (the marquee's line only — no fill — and
// the selected item's thin outline, the shared token, the base cyan and
// the muted dark) and the multi-selection's summary box (the union + the
// 4px offset, the cyan tokens).
import { type Page, expect, test } from "@playwright/test";

import { canvasCenter, canvasView, toCanvas, twoPanes } from "./helpers";

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

const zoomToolbar = (page: Page, client: "a" | "b") => canvasView(page, client).getByRole("toolbar", { name: "Zoom" });

/** The screen center of a canvas item (the wrapper's box). */
async function itemCenter(page: Page, client: "a" | "b", id: string): Promise<{ x: number; y: number }> {
  const box = (await page
    .locator(`[data-testid="doc-${client}"] [data-slot="docblocks/canvas-item"][data-block-id="${id}"]`)
    .boundingBox())!;
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

test.describe("the canvas mouse selection", () => {
  test("the selection's cyan contract (the marquee's line only, the item's outline, light + dark)", async ({
    browser,
  }) => {
    const { a, close } = await twoPanes(browser, "cvs-sel-cyan");
    try {
      await toCanvas(a, "a");
      const { left } = await seedShapes(a, "a");
      const cL = await itemCenter(a, "a", left);
      await a.mouse.click(cL.x, cL.y);

      // The dark pane (the harness default): the selected item's outline
      // reads the token (the muted dark cyan) at the 1px solid line.
      const outline = await a.evaluate(
        ({ client, id }) => {
          const view = document.querySelector(`[data-testid="doc-${client}"] [data-slot="docblocks/canvas-view"]`);
          if (view === null) return null;
          const wrapper = view.querySelector<HTMLElement>(`[data-slot="docblocks/canvas-item"][data-block-id="${id}"]`);
          if (wrapper === null) return null;
          const style = getComputedStyle(wrapper);
          const editor = view.closest('[data-slot="docblocks/editor"]');
          const token =
            editor === null
              ? ""
              : getComputedStyle(editor).getPropertyValue("--docblocks-canvas-selection-border-color").trim();
          return {
            color: style.outlineColor,
            width: style.outlineWidth,
            style_: style.outlineStyle,
            token,
          };
        },
        { client: "a", id: left }
      );
      expect(outline).not.toBeNull();
      expect(outline!.width).toBe("1px");
      expect(outline!.style_).toBe("solid");
      // The token's dark value (the muted cyan) and the outline's color.
      expect(outline!.token).toBe("#39c5cf");
      expect(outline!.color).toBe("rgb(57, 197, 207)");

      // The selection's handles stand the accent too (the same cyan
      // token's fill, the theme's thin border).
      const handle = await a.evaluate((client) => {
        const view = document.querySelector(`[data-testid="doc-${client}"] [data-slot="docblocks/canvas-view"]`);
        if (view === null) return null;
        const el = view.querySelector<HTMLElement>('[data-slot="docblocks/canvas-handle"][data-handle="n"]');
        if (el === null) return null;
        const style = getComputedStyle(el);
        return { background: style.backgroundColor, border: style.borderTopColor };
      }, "a");
      expect(handle).not.toBeNull();
      expect(handle!.background).toBe("rgb(57, 197, 207)");
      // The border reads the standard token seed's dark value (the
      // shipped utility layer carries it; the harness defines no theme).
      expect(handle!.border).toBe("oklch(1 0 0 / 0.1)");

      // The marquee's line + fill (the in-flight drag): the token's
      // border, the 50% fill (the same cyan). The 25% zoom stands the drag
      // off the page miniature (the start point would stand on the card
      // otherwise).
      for (let i = 0; i < 8; i += 1) await zoomToolbar(a, "a").getByLabel("Zoom out").click();
      // The zoom's reflow settle (the marquee's geometry stands over the
      // settled transform — the transient's stand, not state-based).
      await a.waitForTimeout(300);
      const center = await canvasCenter(a, "a");
      await a.mouse.move(center.x + 120, center.y - 100);
      await a.mouse.down();
      await a.mouse.move(center.x + 220, center.y + 40, { steps: 4 });
      const marquee = await a.evaluate(
        ({ client }) => {
          const view = document.querySelector(`[data-testid="doc-${client}"] [data-slot="docblocks/canvas-view"]`);
          if (view === null) return null;
          const rect = view.querySelector<HTMLElement>("[data-slot='docblocks/canvas-marquee']");
          if (rect === null) return null;
          const style = getComputedStyle(rect);
          return { border: style.borderColor, width: style.borderWidth, background: style.backgroundColor };
        },
        { client: "a" }
      );
      await a.mouse.up();
      expect(marquee).not.toBeNull();
      expect(marquee!.width).toBe("1px");
      expect(marquee!.border).toBe("rgb(57, 197, 207)");
      // The 50% fill resolves to the srgb color space (the color-mix).
      expect(marquee!.background).toBe("color(srgb 0.223529 0.772549 0.811765 / 0.5)");

      // The light flip (the base cyan): the token recomputes (the computed
      // color's stand over the new token — the transient's settle).
      await a.evaluate(() => document.documentElement.classList.remove("dark"));
      await a.waitForTimeout(200);
      const lightToken = await a.evaluate(() => {
        const editor =
          document.querySelector('[data-testid="doc-a"] [data-slot="docblocks/editor"]') ?? document.documentElement;
        return getComputedStyle(editor).getPropertyValue("--docblocks-canvas-selection-border-color").trim();
      });
      expect(lightToken).toBe("#0891b2");
    } finally {
      await close();
    }
  });

  test("the multi-selection's summary box (the union + the 4px offset, the cyan tokens)", async ({ browser }) => {
    const { a, close } = await twoPanes(browser, "cvs-sel-multi");
    try {
      await toCanvas(a, "a");
      const { left, right } = await seedShapes(a, "a");
      const cL = await itemCenter(a, "a", left);
      const cR = await itemCenter(a, "a", right);
      await a.mouse.click(cL.x, cL.y);
      await a.keyboard.down("Shift");
      await a.mouse.click(cR.x, cR.y);
      await a.keyboard.up("Shift");

      // The box: the union of the two shapes' boxes + the 4px offset
      // (the on-screen px — 8px total per side).
      const box = await a.evaluate(
        ({ ids }) => {
          const sel = document.querySelector('[data-slot="docblocks/canvas-multi-selection"]');
          if (sel === null) return null;
          const items = ids
            .map((id) => document.querySelector(`[data-slot="docblocks/canvas-item"][data-block-id="${id}"]`))
            .filter((el): el is HTMLElement => el !== null);
          let minX = Infinity;
          let minY = Infinity;
          let maxX = -Infinity;
          let maxY = -Infinity;
          for (const el of items) {
            const r = el.getBoundingClientRect();
            minX = Math.min(minX, r.left);
            minY = Math.min(minY, r.top);
            maxX = Math.max(maxX, r.right);
            maxY = Math.max(maxY, r.bottom);
          }
          const style = getComputedStyle(sel);
          return {
            left: sel.getBoundingClientRect().left,
            top: sel.getBoundingClientRect().top,
            width: sel.getBoundingClientRect().width,
            height: sel.getBoundingClientRect().height,
            union: { minX, minY, maxX, maxY },
            border: style.borderColor,
            background: style.backgroundColor,
          };
        },
        { ids: [left, right] }
      );
      expect(box).not.toBeNull();
      const OFF = 4;
      expect(box!.left).toBeCloseTo(box!.union.minX - OFF, 5);
      expect(box!.top).toBeCloseTo(box!.union.minY - OFF, 5);
      expect(box!.width).toBeCloseTo(box!.union.maxX - box!.union.minX + 2 * OFF, 5);
      expect(box!.height).toBeCloseTo(box!.union.maxY - box!.union.minY + 2 * OFF, 5);
      // The cyan contract (the dark pane): the border token + the 50% fill.
      expect(box!.border).toBe("rgb(57, 197, 207)");
      expect(box!.background).toBe("color(srgb 0.223529 0.772549 0.811765 / 0.5)");
    } finally {
      await close();
    }
  });
});
