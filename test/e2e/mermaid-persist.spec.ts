// The viewport's view over the load and the reload: the fit's default's no-write over the
// page load, and the explicit gesture's persistence over the reload's restore.
import { type Page, expect, test } from "@playwright/test";

import { SETTLE, twoPanes } from "./helpers";

/** The pane's mermaid code block wrapper (the data-language attr comes from the block). */
function mermaidBlock(page: Page, client: "a" | "b") {
  return page.locator(`[data-testid="doc-${client}"]`).locator('[data-block-type="code"][data-language="mermaid"]');
}

/**
 * Switch the pane's mermaid block to the preview mode: the header controls
 * stand on the wrapper hover, the mode switch is one updateBlock (the attr
 * syncs — the other pane renders the diagram too).
 */
async function switchToPreview(page: Page, client: "a" | "b"): Promise<void> {
  const block = mermaidBlock(page, client);
  await block.first().hover();
  await block.first().locator('[data-mermaid-mode-button="preview"]').click();
}

/** The pane's mermaid code block's attrs (the live doc's read over the harness's global). */
async function mermaidAttrs(page: Page, client: "a" | "b") {
  return page.evaluate((cl) => {
    const docs = window.__paneDocs;
    const doc = cl === "a" ? docs?.a : docs?.b;
    if (doc === null || doc === undefined) return null;
    for (const id of doc.getChildren(doc.meta.id)) {
      const block = doc.getBlock(id);
      if (block?.type === "code") {
        return {
          height: (block.attrs?.height as number | null) ?? null,
          zoom: (block.attrs?.zoom as number | null) ?? null,
          panX: (block.attrs?.panX as number | null) ?? null,
          panY: (block.attrs?.panY as number | null) ?? null,
        };
      }
    }
    return null;
  }, client);
}

test("the diagram stands the fit's default over the page load (no gesture, nothing persisted)", async ({ browser }) => {
  const { a, close } = await twoPanes(browser, "mermaid-load-fit");
  try {
    // A tall chain with short labels over a stretched viewport's height
    // (the clip's stand): the fit's scale sits under 100% and both axes
    // center — the load-time default, no gesture, no scroll.
    const text = [
      "graph TD",
      ...Array.from({ length: 14 }, (_, i) => `  N${i}[Step ${i}] --> N${i + 1}[Step ${i + 1}]`),
    ].join("\n");
    await a.evaluate((diagram) => {
      const doc = window.__paneDocs?.a;
      if (doc === null || doc === undefined) return;
      const blockId = doc.insertBlock("code", { language: "mermaid" });
      doc.insertText(blockId, 0, diagram);
    }, text);
    await switchToPreview(a, "a");
    const viewport = mermaidBlock(a, "a").locator('[data-slot="docblocks/mermaid-viewport"]');
    await expect(viewport.locator('[data-slot="docblocks/mermaid-diagram"] svg')).toBeVisible();

    // The load-time stand = the fit over the settled geometry: the scale's
    // min over the width / height's ratios (the no-upscale's cap), both
    // axes centered.
    const fitStand = () =>
      viewport.evaluate((el) => {
        const layer = el.querySelector<HTMLElement>('[data-slot="docblocks/mermaid-viewport-layer"]');
        const svg = layer?.querySelector<SVGSVGElement>("svg") ?? null;
        if (layer === null || svg === null) return null;
        const wrap = el.getBoundingClientRect();
        const w = svg.clientWidth || layer.clientWidth;
        const h = svg.clientHeight || layer.clientHeight;
        if (wrap.width <= 0 || wrap.height <= 0 || w <= 0 || h <= 0) return null;
        const expectedScale = Math.min(wrap.width / w, wrap.height / h, 1);
        const expectedX = (wrap.width - w * expectedScale) / 2;
        const expectedY = (wrap.height - h * expectedScale) / 2;
        const matrix = new DOMMatrix(getComputedStyle(layer).transform);
        return {
          ok:
            Math.abs(matrix.a - expectedScale) <= 0.005 &&
            Math.abs(matrix.e - expectedX) <= 2 &&
            Math.abs(matrix.f - expectedY) <= 2,
          scale: matrix.a,
          expectedScale,
        };
      });
    await expect.poll(fitStand, { timeout: SETTLE.timeout }).toMatchObject({ ok: true });
    const stand = await fitStand();
    // The natural's size stays the small diagram's stand (no upscaling):
    // the fit's scale never exceeds 1.
    expect(stand?.scale ?? 0).toBeLessThanOrEqual(1);
    // Nothing lands on the wire: the default's stand writes no view (the
    // attrs keep the null idiom).
    const attrs = await mermaidAttrs(a, "a");
    expect(attrs).toMatchObject({ zoom: null, panX: null, panY: null });
  } finally {
    await close();
  }
});

test("an explicit gesture persists the view and the reload restores it (the default writes nothing)", async ({
  browser,
}) => {
  const { a, close } = await twoPanes(browser, "mermaid-gesture-persist");
  try {
    const text = [
      "graph TD",
      ...Array.from({ length: 10 }, (_, i) => `  N${i}[Step ${i}] --> N${i + 1}[Step ${i + 1}]`),
    ].join("\n");
    await a.evaluate((diagram) => {
      const doc = window.__paneDocs?.a;
      if (doc === null || doc === undefined) return;
      const blockId = doc.insertBlock("code", { language: "mermaid" });
      doc.insertText(blockId, 0, diagram);
    }, text);
    await switchToPreview(a, "a");
    const viewport = mermaidBlock(a, "a").locator('[data-slot="docblocks/mermaid-viewport"]');
    await expect(viewport.locator('[data-slot="docblocks/mermaid-diagram"] svg')).toBeVisible();
    // The default's stand leaves the attrs empty (the fit's no-write).
    await expect
      .poll(async () => await mermaidAttrs(a, "a"), SETTLE)
      .toMatchObject({
        zoom: null,
        panX: null,
        panY: null,
      });
    // The explicit gesture (the toolbar's zoom-in): the view persists.
    await viewport.hover();
    await viewport.locator('[data-slot="docblocks/mermaid-zoom-in"]').click();
    await expect(viewport.locator('[data-slot="docblocks/mermaid-zoom"]')).toHaveText("120%");
    await expect.poll(async () => (await mermaidAttrs(a, "a"))?.zoom ?? null, SETTLE).toBe(1.2);
    // The reload: the persisted view restores (the attrs sync over the
    // relay; the position stands the reload's restore, not the fit).
    await a.reload();
    await expect(a.getByTestId("status-a")).toHaveText("connected");
    const viewportAfter = mermaidBlock(a, "a").locator('[data-slot="docblocks/mermaid-viewport"]');
    await expect(viewportAfter.locator('[data-slot="docblocks/mermaid-diagram"] svg')).toBeVisible();
    await expect
      .poll(
        async () =>
          viewportAfter.evaluate((el) => {
            const layer = el.querySelector<HTMLElement>('[data-slot="docblocks/mermaid-viewport-layer"]');
            return layer === null ? null : new DOMMatrix(getComputedStyle(layer).transform).a;
          }),
        { timeout: SETTLE.timeout }
      )
      .toBeCloseTo(1.2, 2);
    // The reload's restore writes nothing new (the attrs stand the
    // gesture's value).
    await expect.poll(async () => (await mermaidAttrs(a, "a"))?.zoom ?? null, SETTLE).toBe(1.2);
  } finally {
    await close();
  }
});
