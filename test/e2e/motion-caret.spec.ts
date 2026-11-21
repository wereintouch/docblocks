// The page's motion row layer — a deletion above the caret stands the caret
// inside the document's bounds over the exit (the short doc) and, over the
// tall doc, stands the scroll's bound (no jump beyond the deletion's own
// height).
import { type Page, expect, test } from "@playwright/test";

import { browserNameOf, rowsSettled, twoPanes } from "./helpers";

function pane(page: Page, client: "a" | "b") {
  return page.locator(`[data-testid="doc-${client}"]`);
}

/** The pane's block wrappers (the inner editables are not blocks). */
function wrappers(page: Page, client: "a" | "b") {
  return pane(page, client).locator('[data-block-id]:not([data-slot="docblocks/block-content"])');
}

interface CaretBoundsSample {
  t: number;
  ceBottom: number | null;
  containerBottom: number | null;
  rows: number;
}

/**
 * Sample the last row's content box against the rows' box over the exit
 * window (a Node-side loop — an in-page rAF sampler is starved by the
 * other specs' pages in a parallel run). The invariant the pin keeps:
 * the caret row's content box never stands below the rows' bottom edge
 * (the document's bounds) — a lagging position projection pokes it out
 * over the slide's duration.
 */
async function sampleCaretBounds(page: Page, ms: number): Promise<CaretBoundsSample[]> {
  const samples: CaretBoundsSample[] = [];
  const start = Date.now();
  while (Date.now() - start < ms) {
    const s = await page.evaluate(() => {
      const rows = document.querySelectorAll('[data-slot="docblocks/row"]');
      const last = rows[rows.length - 1] as HTMLElement | undefined;
      const ce = last?.querySelector<HTMLElement>('[data-slot="docblocks/block-content"]') ?? null;
      const group = document.querySelector<HTMLElement>('[data-slot="docblocks/rows"]');
      return {
        ceBottom: ce !== null ? Math.round(ce.getBoundingClientRect().bottom * 10) / 10 : null,
        containerBottom: group !== null ? Math.round(group.getBoundingClientRect().bottom * 10) / 10 : null,
        rows: rows.length,
      };
    });
    samples.push({ t: Date.now() - start, ...s });
    await page.waitForTimeout(25);
  }
  return samples;
}

/** The caret's final seat in pane A (the selection's anchor host + offset, the caret's seat over the last block, the placeholder's content). The shared page container is the focused element (the span model) — the caret's block is the live selection's, so the last-block check reads the selection over the last row's inner, not the active element. */
async function caretSeat(page: Page): Promise<{
  anchorBlockId: string | null;
  anchorOffset: number;
  caretInLastCe: boolean;
  placeholder: string | null;
  rowCount: number;
}> {
  return page.evaluate(() => {
    const sel = window.getSelection();
    const node = sel === null ? null : sel.anchorNode;
    const host = node instanceof Element ? node : (node?.parentElement ?? null);
    const ce = host?.closest<HTMLElement>('[data-slot="docblocks/block-content"]') ?? null;
    const rows = document.querySelectorAll('[data-slot="docblocks/row"]');
    const lastRow = rows[rows.length - 1] as HTMLElement | undefined;
    const lastCe = lastRow?.querySelector<HTMLElement>('[data-slot="docblocks/block-content"]') ?? null;
    let caretInLastCe = false;
    if (sel !== null && sel.rangeCount > 0 && lastCe !== null) {
      const range = sel.getRangeAt(0);
      caretInLastCe =
        lastCe.contains(sel.anchorNode) || lastCe.contains(range.startContainer) || lastCe.contains(range.endContainer);
    }
    return {
      anchorBlockId: ce?.dataset.blockId ?? null,
      anchorOffset: sel === null ? -1 : sel.anchorOffset,
      caretInLastCe,
      placeholder: lastCe !== null ? getComputedStyle(lastCe, "::before").content : null,
      rowCount: rows.length,
    };
  });
}

test("a deletion above the caret stands the caret inside the document's bounds over the exit (the short doc)", async ({
  browser,
}) => {
  const { a, close } = await twoPanes(browser, "caret-bounds-short-doc");
  try {
    // [starter ∅][divider][∅ (the caret's block)]: the Backspace deletes
    // the divider (the non-content previous — the empty last block stands)
    // and the document's box shrinks to the final stand. A lagging position
    // projection would keep the caret row (the live caret + the
    // placeholder's line) below the new bottom edge over the slide.
    await expect(wrappers(a, "a")).toHaveCount(1);
    await a.evaluate(() => {
      const doc = window.__paneDocs?.a;
      if (doc === null || doc === undefined) throw new Error("the pane's doc is not mounted");
      doc.transact(() => {
        doc.insertBlock("divider");
        doc.insertBlock("paragraph");
      });
    });
    await expect(wrappers(a, "a")).toHaveCount(3);
    await rowsSettled(a);
    const survivorId = (await wrappers(a, "a").nth(2).getAttribute("data-block-id")) ?? "";

    // The caret in the last empty block (the survivor).
    await wrappers(a, "a").nth(2).locator('[data-slot="docblocks/block-content"]').click();

    await a.keyboard.press("Backspace");
    const samples = await sampleCaretBounds(a, 450);

    // The pin stands over the exit's mid-slide (the 0.18 s window): the
    // leaving row still stands mounted (rows === 3) and the slide has
    // passed its first frames (t >= 100 — the projection's one-frame
    // settle stands out of the window; a lagging projection would stand
    // the caret row below the edge over the whole slide).
    const mid = samples.filter((s) => s.t >= 100 && s.rows === 3);
    // Non-vacuous: the exit stood in flight over the window.
    expect(mid.length).toBeGreaterThan(0);
    const violations = mid.filter(
      (s) => s.ceBottom !== null && s.containerBottom !== null && s.ceBottom > s.containerBottom + 2
    );
    expect(violations).toEqual([]);

    // The final seat (the re-seat's contract): the caret stands in the
    // survivor at its start, the focus stands on it, and the placeholder
    // stands over the empty line (the regression).
    const seat = await caretSeat(a);
    expect(seat.rowCount).toBe(2);
    expect(seat.anchorBlockId).toBe(survivorId);
    expect(seat.anchorOffset).toBe(0);
    expect(seat.caretInLastCe).toBe(true);
    expect(seat.placeholder).toContain("Type '/' for commands");

    await close();
  } finally {
    await close();
  }
});

test("a deletion above the caret over the tall doc stands the bounds and the scroll stands no jump", async ({
  browser,
}) => {
  const { a, close } = await twoPanes(browser, "caret-bounds-tall-doc");
  try {
    // A doc taller than the viewport (the window's scroll): the text's run
    // + a tall table + the caret's empty last block. The Backspace deletes
    // the table (the non-content previous) — the big reflow over the
    // scrolled viewport: the caret stands inside the document's bounds
    // over the exit and the scroll position stands the reflow's bound (no
    // jump beyond the deletion's own height).
    await expect(wrappers(a, "a")).toHaveCount(1);
    await a.evaluate(() => {
      const doc = window.__paneDocs?.a;
      if (doc === null || doc === undefined) throw new Error("the pane's doc is not mounted");
      doc.transact(() => {
        for (let i = 0; i < 12; i++) {
          const id = doc.insertBlock("paragraph");
          doc.insertText(id, 0, `line ${i}`);
        }
        const tableId = doc.insertBlock("table", { cols: 2 });
        for (let i = 0; i < 20; i++) {
          const row = doc.insertBlock("table-row", undefined, { parent: tableId });
          for (let j = 0; j < 2; j++) {
            const cell = doc.insertBlock("table-cell", undefined, { parent: row });
            doc.insertText(cell, 0, `r${i}c${j}`);
          }
        }
        doc.insertBlock("paragraph"); // the caret's block (the last)
      });
    });
    await expect(a.locator('[data-slot="docblocks/row"]')).toHaveCount(15);
    await rowsSettled(a);
    const lastRow = a.locator('[data-slot="docblocks/row"]').last();
    const survivorId = (await lastRow.locator(":scope > [data-block-id]").first().getAttribute("data-block-id")) ?? "";
    const tableBox = await a.locator('[data-block-type="table"]').first().boundingBox();
    const tableHeight = tableBox === null ? 0 : tableBox.height;
    expect(tableHeight).toBeGreaterThan(0);

    // The caret in the last empty block (the pane scrolls the block into
    // view over the click).
    await lastRow.locator('[data-slot="docblocks/block-content"]').last().click();
    const scrollBefore = await a.evaluate(() => window.scrollY);

    await a.keyboard.press("Backspace");
    const samples = await sampleCaretBounds(a, 450);

    // The pin stands over the exit's mid-slide (the 0.18 s window): the
    // table still stands mounted (rows === 15) and the slide has passed its
    // first frames (t >= 100 — the projection's one-frame settle stands out
    // of the window; a lagging projection would stand the caret row below
    // the edge over the whole slide).
    const mid = samples.filter((s) => s.t >= 100 && s.rows === 15);
    // Non-vacuous: the exit stood in flight over the window.
    expect(mid.length).toBeGreaterThan(0);
    // The mid-slide's in-view stand and the scroll's reflow stand the
    // chromium's frame schedule (the firefox and the webkit's engines
    // schedule the layout animation's frames differently — the caret's
    // seat's stand is the product's contract, the mid-slide's window is
    // the engine's timing).
    if (browserNameOf(a) === "chromium") {
      const violations = mid.filter(
        (s) => s.ceBottom !== null && s.containerBottom !== null && s.ceBottom > s.containerBottom + 2
      );
      expect(violations).toEqual([]);

      // The scroll stands the reflow's bound (the deletion's own height —
      // the browser's scroll anchoring may re-seat it within it; the 8 px
      // absorbs the engine's subpixel's rounding over the animated exit's
      // height stand — the measured ~4 px's overshoot over the 1012.875 px
      // table. A phantom jump over the lagging projection would stand
      // beyond).
      const scrollAfter = await a.evaluate(() => window.scrollY);
      expect(Math.abs(scrollAfter - scrollBefore)).toBeLessThanOrEqual(tableHeight + 8);
    }

    // The final seat (the same contract as the short doc's pin).
    const seat = await caretSeat(a);
    expect(seat.rowCount).toBe(14);
    expect(seat.anchorBlockId).toBe(survivorId);
    expect(seat.anchorOffset).toBe(0);
    expect(seat.caretInLastCe).toBe(true);
    expect(seat.placeholder).toContain("Type '/' for commands");

    await close();
  } finally {
    await close();
  }
});
