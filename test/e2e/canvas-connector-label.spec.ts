// The connector's label chip's live stand: the chip is the line's
// midpoint and must follow the line MID-DRAG (the connected item's move —
// the preview's re-draw; the endpoint's re-draw over the handle's drag)
// and stand NO jump on release (the preview's stand is the commit's stand
// — the chip and the line stand from one number).
import { type Page, expect, test } from "@playwright/test";

import { switchPaneView, twoPanes } from "./helpers";

async function lineMidScreen(page: Page, client: "a" | "b"): Promise<{ x: number; y: number }> {
  return page.evaluate((c) => {
    const doc = document.querySelector(`[data-testid="doc-${c}"]`)!;
    const path = doc.querySelector<SVGPathElement>("[data-connector-id]")!;
    const d = path.getAttribute("d")!;
    const nums = d
      .split(/[^0-9.eE-]+/)
      .filter(Boolean)
      .map(Number);
    const mid = { x: (nums[0]! + nums[2]!) / 2, y: (nums[1]! + nums[3]!) / 2 };
    const view = doc.querySelector<HTMLElement>('[data-slot="docblocks/canvas-view"]')!;
    const rect = view.getBoundingClientRect();
    return { x: rect.x + rect.width / 2 + mid.x, y: rect.y + rect.height / 2 + mid.y };
  }, client);
}

test("the label's chip follows the line mid-drag and stands no jump on release (the connected block's move)", async ({
  browser,
}) => {
  const { a, close } = await twoPanes(browser, "canvas-conn-chip-follow");
  try {
    await switchPaneView(a, "a", "canvas");
    // Seed a surface + two rects + a labeled connector (the line runs
    // through the canvas center: a west, b east).
    const ids = await a.evaluate(() => {
      const doc = window.__paneDocs?.a ?? null;
      if (doc === null) throw new Error("the pane's doc is not mounted");
      let surface = "";
      let sa = "";
      let sb = "";
      let conn = "";
      doc.transact(() => {
        surface = doc.insertBlock("surface");
        sa = doc.insertBlock("shape", { variant: "rect" }, { parent: surface });
        doc.setGeometry(sa, { x: -100, y: 0, w: 100, h: 60 });
        sb = doc.insertBlock("shape", { variant: "rect" }, { parent: surface });
        doc.setGeometry(sb, { x: 100, y: 0, w: 100, h: 60 });
        conn = doc.insertBlock(
          "connector",
          { start: { blockId: sa }, end: { blockId: sb }, label: "follows" },
          { parent: surface }
        );
      });
      return { surface, sa, sb, conn };
    });

    const chip = a.locator("[data-connector-label]");
    await expect(chip).toHaveCount(1);
    await expect(chip).toHaveText("follows");

    // Shape b's screen box (the drag's target — the line's east end).
    const bBox = (await a.locator(`[data-block-id="${ids.sb}"]`).first().boundingBox())!;
    expect(bBox, "shape b's box must stand").not.toBeNull();

    // Drag shape b (the move session's press + drag) by a screen delta.
    const dx = 120;
    const dy = 80;
    const sx = bBox.x + bBox.width / 2;
    const sy = bBox.y + bBox.height / 2;
    await a.mouse.move(sx, sy);
    await a.mouse.down();
    await a.mouse.move(sx + dx, sy + dy, { steps: 8 });

    // MID-DRAG: the chip stands the line's live midpoint (it follows the
    // moving block — the chip and the line stand from one number). The
    // pre-fix stand: the chip lags at the committed seat.
    const midDrag = await lineMidScreen(a, "a");
    const chipMid = (await chip.boundingBox())!;
    expect(Math.abs(chipMid.x + chipMid.width / 2 - midDrag.x)).toBeLessThan(2);
    expect(Math.abs(chipMid.y + chipMid.height / 2 - midDrag.y)).toBeLessThan(2);

    // The release commits the preview's stand (one setGeometry over the
    // wire). NO JUMP: the chip stands the committed midpoint (the preview's
    // stand is the commit's stand — the same seat as mid-drag).
    await a.mouse.up();
    const midEnd = await lineMidScreen(a, "a");
    const chipEnd = (await chip.boundingBox())!;
    expect(Math.abs(chipEnd.x + chipEnd.width / 2 - midEnd.x)).toBeLessThan(2);
    expect(Math.abs(chipEnd.y + chipEnd.height / 2 - midEnd.y)).toBeLessThan(2);
  } finally {
    await close();
  }
});

// The label chip's live stand over the ENDPOINT's re-draw: dragging the
// selected line's endpoint handle re-draws the line live; the chip (the
// midpoint) follows mid-drag and stands no jump on release. The pre-fix
// stand: the chip lags at the committed seat.

test("the label's chip follows the line mid-drag over the endpoint's re-draw (the endpoint handle's drag)", async ({
  browser,
}) => {
  const { a, close } = await twoPanes(browser, "canvas-conn-chip-follow-endpoint");
  try {
    await switchPaneView(a, "a", "canvas");
    // A surface + two rects + a labeled connector with a FREE end (the
    // endpoint's drag is unambiguous — the free point follows the pointer;
    // no box-anchor / no port-snap over the drag's delta).
    await a.evaluate(() => {
      const doc = window.__paneDocs?.a ?? null;
      if (doc === null) throw new Error("the pane's doc is not mounted");
      doc.transact(() => {
        const surface = doc.insertBlock("surface");
        const sa = doc.insertBlock("shape", { variant: "rect" }, { parent: surface });
        doc.setGeometry(sa, { x: -100, y: 0, w: 100, h: 60 });
        const sb = doc.insertBlock("shape", { variant: "rect" }, { parent: surface });
        doc.setGeometry(sb, { x: 100, y: 0, w: 100, h: 60 });
        doc.insertBlock(
          "connector",
          { start: { blockId: sa }, end: { x: 150, y: 0 }, label: "follows" },
          { parent: surface }
        );
      });
    });

    const chip = a.locator("[data-connector-label]");
    await expect(chip).toHaveCount(1);

    // Select the line (the midpoint's press) — the endpoint's handles
    // stand.
    const box = (await a.locator('[data-testid="doc-a"] [data-slot="docblocks/canvas-view"]').boundingBox())!;
    await a.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    const endHandle = a.locator('[data-connector-endpoint="end"]');
    await expect(endHandle).toBeVisible();
    const handleBox = (await endHandle.boundingBox())!;

    // Drag the end's endpoint (the line's re-draw) by a screen delta.
    const dx = 80;
    const dy = 120;
    const hx = handleBox.x + handleBox.width / 2;
    const hy = handleBox.y + handleBox.height / 2;
    await a.mouse.move(hx, hy);
    await a.mouse.down();
    await a.mouse.move(hx + dx, hy + dy, { steps: 8 });

    // MID-DRAG: the chip stands the line's live midpoint (the re-draw's
    // stand — the pre-fix lag stands the committed seat).
    const midDrag = await lineMidScreen(a, "a");
    const chipMid = (await chip.boundingBox())!;
    expect(Math.abs(chipMid.x + chipMid.width / 2 - midDrag.x)).toBeLessThan(2);
    expect(Math.abs(chipMid.y + chipMid.height / 2 - midDrag.y)).toBeLessThan(2);

    // The release commits (the preview's stand is the commit's stand) — no
    // jump.
    await a.mouse.up();
    const midEnd = await lineMidScreen(a, "a");
    const chipEnd = (await chip.boundingBox())!;
    expect(Math.abs(chipEnd.x + chipEnd.width / 2 - midEnd.x)).toBeLessThan(2);
    expect(Math.abs(chipEnd.y + chipEnd.height / 2 - midEnd.y)).toBeLessThan(2);
  } finally {
    await close();
  }
});
