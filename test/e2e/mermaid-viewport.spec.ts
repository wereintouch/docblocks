// The preview's viewport over the persisted attrs: the height's resize (the keyboard's step
// + the drag's linear stand), the zoom's toolbar + the wheel's pan, the fit's restore, the
// panes' shared stand, the reset's identity.
import { type Locator, type Page, expect, test } from "@playwright/test";

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

/** The tall's multi-branch graph (the viewport's evaluation's stand — the harness's seed stands the small's over the typing test's chain's premise). */
const LARGE_DIAGRAM = `graph TD
  A[User story] --> B{Priority?}
  B -->|High| C[Design review]
  B -->|Low| D[Backlog]
  C --> E[Implementation]
  D --> E
  E --> F{Code review?}
  F -->|Pass| G[Integration]
  F -->|Fail| E
  G --> H{QA?}
  H -->|Pass| I[Release candidate]
  H -->|Fail| J[Bug triage]
  J --> E
  I --> K[Rollout plan]
  K --> L[Deploy: staging]
  L --> M[Smoke tests]
  M --> N[Deploy: production]
  N --> O[Monitoring]
  O --> P{Incident?}
  P -->|No| Q[Done]
  P -->|Yes| J`;

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

/**
 * The layer's scale over the settled boxes (the transform's matrix). The
 * boxes may settle once more after the height's write (the observer's pass),
 * so the read follows two identical samples a frame apart.
 */
async function settledScale(viewport: Locator): Promise<number> {
  const read = () =>
    viewport.evaluate((el) => {
      const layer = el.querySelector<HTMLElement>('[data-slot="docblocks/mermaid-viewport-layer"]');
      return layer === null ? null : new DOMMatrix(getComputedStyle(layer).transform).a;
    });
  let prev = await read();
  for (let i = 0; i < 40; i++) {
    await viewport.page().waitForTimeout(50);
    const next = await read();
    if (next !== null && next === prev) return next;
    prev = next;
  }
  if (prev === null) throw new Error("the diagram's layer stands absent");
  return prev;
}

test("the preview's viewport: the height's resize + the pan/zoom over the persisted attrs (the panes' shared stand)", async ({
  browser,
}) => {
  const { a, b, close } = await twoPanes(browser, "mermaid-viewport");
  try {
    // The large diagram stands the doc API's direct write (the multi-line's
    // input route is no stand over the tall's graph — the harness's seed
    // stays the small's over the typing test's chain's premise).
    await a.evaluate((text) => {
      const doc = window.__paneDocs?.a;
      if (doc === null || doc === undefined) return;
      const blockId = doc.insertBlock("code", { language: "mermaid" });
      doc.insertText(blockId, 0, text);
    }, LARGE_DIAGRAM);
    await switchToPreview(a, "a");

    const viewport = mermaidBlock(a, "a").locator('[data-slot="docblocks/mermaid-viewport"]');
    await expect(viewport).toBeVisible();
    const svg = viewport.locator('[data-slot="docblocks/mermaid-diagram"] svg');
    await expect(svg).toBeVisible();
    const svgBox = (await svg.boundingBox())!;
    // The default's auto's stand (no `height`'s attr): the viewport's box
    // stands the diagram's natural's height.
    const autoBox = (await viewport.boundingBox())!;
    expect(Math.abs(autoBox.height - svgBox.height) < 2, "the auto's height's stand").toBe(true);
    expect((await mermaidAttrs(a, "a"))?.height).toBeNull();

    // The height's resize (the keyboard's slider's idiom over the handle —
    // the step per press, the doc's write per press, the embed's sign's
    // parity: the ArrowUp's shrink / the ArrowDown's extend): the clip's
    // stand (the viewport's box under the diagram's height).
    const handle = viewport.locator('[data-slot="docblocks/mermaid-resize"]');
    await handle.focus();
    for (let i = 0; i < 15; i++) await handle.press("ArrowUp");
    await expect.poll(async () => (await mermaidAttrs(a, "a"))?.height ?? null, SETTLE).not.toBe(null);
    const attrs = (await mermaidAttrs(a, "a"))!;
    expect(attrs.height, "the resize's write stands the `height`'s attr").toBeLessThan(svgBox.height - 200);
    const clippedBox = (await viewport.boundingBox())!;
    expect(clippedBox.height, "the viewport's clip over the natural's stand").toBeLessThan(svgBox.height);

    // The height's resize over the DRAG (the pointer's 40 px — the
    // linear's stand's pin: the height's stand over the 40 px's delta,
    // the accumulate's super-linearity's no-stand). The handle's stand
    // over the clip's bottom's edge (the scroll's seat before the drag).
    await handle.scrollIntoViewIfNeeded();
    const handleBox = (await handle.boundingBox())!;
    const dragFrom = attrs.height as number;
    await a.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
    await a.mouse.down();
    await a.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2 + 40, {
      steps: 5,
    });
    await a.mouse.up();
    await expect.poll(async () => (await mermaidAttrs(a, "a"))?.height ?? null, SETTLE).not.toBe(dragFrom);
    const draggedHeight = (await mermaidAttrs(a, "a"))?.height ?? null;
    expect(draggedHeight, "the drag's write's stand").not.toBeNull();
    expect(
      Math.abs(draggedHeight! - (dragFrom + 40)) <= 4,
      `the drag's linear's stand (the ${dragFrom}'s + 40's stand over the ${draggedHeight})`
    ).toBe(true);
    const height = draggedHeight!;

    // The zoom's toolbar (the hover's reveal's stand): the view stands the
    // fit over the clipped height (no explicit view yet), so the in's
    // press stands the fit's scale over the 1.2's step + the label's
    // percent — and the press is the explicit gesture that persists it.
    const label = viewport.locator('[data-slot="docblocks/mermaid-zoom"]');
    await expect(label).toHaveText(/^\d+%$/);
    await viewport.hover();
    // The fit's exact scale over the settled boxes (the transform's matrix —
    // the label rounds). The hover reveals the controls, and the boxes settle
    // once more after the height's write — the read follows the settle.
    const scaleBefore = await settledScale(viewport);
    await viewport.locator('[data-slot="docblocks/mermaid-zoom-in"]').click();
    const expectedScale = scaleBefore * 1.2;
    // The label rounds the scale's percent, so a scale sitting on the half's
    // point reads one point off the value computed from the serialized
    // matrix — the percent stands within one point; the exact scale stands
    // over the zoom's attr.
    const expectedPercent = expectedScale * 100;
    await expect
      .poll(async () => {
        const text = (await label.textContent())?.replace("%", "") ?? "";
        return Math.abs(Number(text) - expectedPercent) <= 1;
      }, SETTLE)
      .toBe(true);
    await expect.poll(async () => (await mermaidAttrs(a, "a"))?.zoom ?? null, SETTLE).toBeCloseTo(expectedScale, 2);

    // The pan's stand (the wheel over the clipped's diagram — the content
    // opposite to the delta, the doc's write over the rest's debounce).
    const panBox = (await viewport.boundingBox())!;
    await a.mouse.move(panBox.x + panBox.width / 2, panBox.y + panBox.height / 2);
    await a.mouse.wheel(0, 600);
    await expect
      .poll(async () => {
        const m = await mermaidAttrs(a, "a");
        return typeof m?.panY === "number" && m.panY < -50 ? true : false;
      }, SETTLE)
      .toBe(true);

    // The fit's stand (the default's restore over the large's diagram):
    // the scale's shrink into the viewport's box (the cap's no-upscale's
    // stand: the fit's scale under 100% over the large's) + the pan's
    // re-centering (the overflow's stand: the centered's no-overflow's
    // stand over the fit's scale).
    await viewport.hover();
    await viewport.locator('[data-slot="docblocks/mermaid-fit"]').click();
    await expect
      .poll(async () => {
        const m = await mermaidAttrs(a, "a");
        return typeof m?.zoom === "number" && m.zoom < 1 ? true : false;
      }, SETTLE)
      .toBe(true);
    const fit = (await mermaidAttrs(a, "a"))!;
    expect(fit.zoom, "the fit's scale's stand (the large's shrink over the min's)").toBeGreaterThan(0.25);

    // The panes' shared stand (the wire's parity over the attrs — the b
    // pane's viewport adopts the persisted's height / zoom / pan).
    await expect
      .poll(async () => {
        const m = await mermaidAttrs(b, "b");
        return m?.height === height && m?.zoom === fit.zoom ? true : false;
      }, SETTLE)
      .toBe(true);
    const bViewport = mermaidBlock(b, "b").locator('[data-slot="docblocks/mermaid-viewport"]');
    await expect(bViewport).toBeVisible();

    // The reset's stand (the identity's restore — the attrs' null's
    // persist over the cleared's view; the pan's stand the clamped's
    // canonical's stand: the sub-wrapper content's centering's offset
    // stands the identity's canonical's coordinate, not the raw's 0).
    await viewport.hover();
    await viewport.locator('[data-slot="docblocks/mermaid-zoom-reset"]').click();
    await expect
      .poll(async () => {
        const m = await mermaidAttrs(a, "a");
        return m?.zoom === null && m?.panY === null ? true : false;
      }, SETTLE)
      .toBe(true);
    const resetAttrs = (await mermaidAttrs(a, "a"))!;
    expect(resetAttrs).toMatchObject({ zoom: null, panY: null });
    expect(
      resetAttrs.panX === null || (typeof resetAttrs.panX === "number" && resetAttrs.panX >= 0),
      `the pan's X's canonical's stand (the ${resetAttrs.panX}'s centering)`
    ).toBe(true);
    await expect(viewport.locator('[data-slot="docblocks/mermaid-zoom"]')).toHaveText("100%");
    expect(resetAttrs.height, "the height's stand over the view's reset").toBe(height);
  } finally {
    await close();
  }
});
