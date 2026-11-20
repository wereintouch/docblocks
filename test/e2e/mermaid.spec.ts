import { type Locator, type Page, expect, test } from "@playwright/test";

import { SETTLE, editorContext, insertBlockType, openPane, twoPanes } from "./helpers";

/** Insert one v1 type at the root through the pane's harness control. */
async function insertType(page: Page, client: "a" | "b", type: string): Promise<void> {
  await insertBlockType(page, client, type);
}

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

/**
 * The sliding pill sits exactly on the given button (the measured
 * geometry). The delta is POLLED — `boundingBox` does not retry, so a
 * single snapshot could sample the 200 ms slide transition mid-flight.
 */
async function pillOnButton(block: Locator, button: Locator): Promise<void> {
  const pill = block.locator('[data-slot="docblocks/mermaid-mode-pill"]');
  await expect
    .poll(
      async () => {
        const p = await pill.boundingBox();
        const t = await button.boundingBox();
        if (p === null || t === null) return Number.POSITIVE_INFINITY;
        return Math.abs(p.x - t.x) + Math.abs(p.y - t.y);
      },
      { timeout: SETTLE.timeout }
    )
    .toBeLessThan(1);
}

/** The diagram preview container of the pane's mermaid block. */
function preview(page: Page, client: "a" | "b") {
  return mermaidBlock(page, client).locator('[data-slot="docblocks/mermaid"]');
}

/**
 * Paste a plain-text payload into the focused element: the payload is
 * dispatched as a paste event on the focused element (headless Chromium
 * does not synthesize a paste from Control+v). The editor's paste path
 * commits the text as doc commands — the real multi-line input route for
 * code blocks (Enter splits the block, so a keyboard newline is not the
 * diagram text).
 */
async function pastePlainText(page: Page, text: string): Promise<void> {
  await page.evaluate((value) => {
    const target = document.activeElement;
    if (!(target instanceof HTMLElement)) throw new Error("the paste target should be focused");
    const transfer = new DataTransfer();
    transfer.setData("text/plain", value);
    const event = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "clipboardData", { value: transfer });
    target.dispatchEvent(event);
  }, text);
}

/** Does the pane's diagram carry the node label? The v12 flowchart renders
 *  labels as HTML inside a <foreignObject> (no <text> elements), so the
 *  match is on the label's text content, exact. */
async function diagramHasNode(page: Page, client: "a" | "b", node: string): Promise<boolean> {
  const label = mermaidBlock(page, client).locator("svg").getByText(node, { exact: true });
  return (await label.count()) > 0;
}

test("the diagram follows the editor's theme (EXT-02: the dark stand + a flip re-renders)", async ({ browser }) => {
  const context = await editorContext(browser);
  const a = await context.newPage();
  try {
    // A unique room per run (the twoPanes suffix stand): the relay keeps the
    // room's doc for the dev server's lifetime, so a fixed room name would
    // stand the previous run's blocks (the diagram count's assertion is
    // document-wide).
    await openPane(a, "a", `ext02-theme-${Math.random().toString(36).slice(2, 8)}`);
    await insertType(a, "a", "code-mermaid");
    const block = mermaidBlock(a, "a");
    await switchToPreview(a, "a");
    const diagram = block.locator('[data-slot="docblocks/mermaid"][data-state="diagram"] svg');
    await expect(diagram).toHaveCount(1, SETTLE);

    // The scoped <style> of the rendered svg carries the theme's stand:
    // the dark theme renders the light ink on the dark canvas, the
    // default theme the dark ink.
    const readStyle = async () =>
      a.evaluate(
        () =>
          document
            .querySelector('[data-testid="doc-a"] [data-slot="docblocks/mermaid"][data-state="diagram"] svg')
            ?.querySelector("style")?.textContent ?? "NO-STYLE"
      );
    // The harness loads dark by default.
    expect(await readStyle()).toContain("font-size:16px;fill:#ccc");

    // A theme flip (the dark class leaves <html>) re-renders the diagram
    // in the default (light) theme.
    await a.evaluate(() => document.documentElement.classList.remove("dark"));
    await expect.poll(readStyle, SETTLE).not.toContain("font-size:16px;fill:#ccc");
    expect(await readStyle()).toContain("font-size:16px;fill:#333");
  } finally {
    await context.close();
  }
});

test("a mermaid code block inserted in A switches to the diagram in both panes", async ({ browser }) => {
  const { a, b, close } = await twoPanes(browser, "ext02-mermaid");

  await insertType(a, "a", "code-mermaid");

  for (const [pane, client] of [
    [a, "a"],
    [b, "b"],
  ] as const) {
    const block = mermaidBlock(pane, client);
    await expect(block).toHaveCount(1);
    // The default mode (code): the editable code stands, the diagram is
    // not rendered (the modes are exclusive).
    expect(await block.locator('[data-slot="docblocks/mermaid"]').count()).toBe(0);
    expect(await block.locator('[data-slot="docblocks/block-content"]').count()).toBe(1);
    // The sliding pill sits exactly on the active (code) button (the pill
    // is the highlight; it slides on a mode switch).
    await block.hover();
    await pillOnButton(block, block.locator('[data-mermaid-mode-button="code"]'));
    // The pill's travel stands the back-out easing (the slight overshoot's
    // settle — the shared stand over the mode switcher; the geometry pins
    // are the regression over the new easing).
    expect(
      await block
        .locator('[data-slot="docblocks/mermaid-mode-pill"]')
        .evaluate((el) => getComputedStyle(el).transitionTimingFunction)
    ).toBe("cubic-bezier(0.34, 1.56, 0.64, 1)");
  }

  // The preview switch in A writes the mode attr — it syncs over the
  // wire, so both panes render the diagram from the synced text.
  await switchToPreview(a, "a");

  for (const [pane, client] of [
    [a, "a"],
    [b, "b"],
  ] as const) {
    const block = mermaidBlock(pane, client);
    // The seed diagram renders as an svg inside the block wrapper in both
    // panes (the renderer is registered on both — the harness demo).
    await expect(block.locator('[data-slot="docblocks/mermaid"] svg')).toHaveCount(1);
    await expect(preview(pane, client)).toHaveAttribute("data-state", "diagram");
    // The editable stays mounted (the code body is hidden, not unmounted).
    expect(await block.locator('[data-slot="docblocks/block-content"]').count()).toBe(1);
    // The pill has slid to the preview button (the same geometry pin after
    // the switch — the transition's end state).
    await block.hover();
    await pillOnButton(block, block.locator('[data-mermaid-mode-button="preview"]'));
  }

  // The JSON inspector of pane A shows the code type + the attrs.
  const jsonA = a.getByTestId("json-a");
  await expect.poll(async () => (await jsonA.innerText()).includes('"language": "mermaid"'), SETTLE).toBe(true);
  expect(await jsonA.innerText()).toContain('"type": "code"');
  expect(await jsonA.innerText()).toContain('"mermaidMode": "preview"');

  await close();
});

test("typing in the code block re-renders the diagram in both panes", async ({ browser }) => {
  const { a, b, close } = await twoPanes(browser, "ext02-mermaid-live");

  await insertType(a, "a", "code-mermaid");
  const blockA = mermaidBlock(a, "a");

  // The seed is "graph TD\n A --> B": appending " --> C" on the last line
  // chains a third node into the diagram (a single-line continuation —
  // Enter would split the block, not add a line). The click seats on the
  // last line explicitly (a center click of a two-line block stands on
  // the line boundary and resolves to the first line).
  const inner = blockA.locator('[data-slot="docblocks/block-content"]');
  const box = (await inner.boundingBox())!;
  await a.mouse.click(box.x + 20, box.y + box.height - 6);
  await a.keyboard.press("End");
  await a.keyboard.type(" --> C");

  // The preview switch renders the diagram from the edited text: the new
  // node label reaches the diagram in both panes (the text synced over
  // the wire, the renderer picks the preview mode from the synced attr).
  await switchToPreview(a, "a");
  await expect.poll(() => diagramHasNode(a, "a", "C"), SETTLE).toBe(true);
  await expect(preview(a, "a")).toHaveAttribute("data-state", "diagram");
  await expect.poll(() => diagramHasNode(b, "b", "C"), SETTLE).toBe(true);

  await close();
});

test("an invalid diagram keeps no svg and shows the error state", async ({ browser }) => {
  const { a, close } = await twoPanes(browser, "ext02-mermaid-error");

  await insertType(a, "a", "code-mermaid");
  const blockA = mermaidBlock(a, "a");

  // Replace the seed with an incomplete diagram IN THE CODE MODE (the
  // editable stands there): the triple press's whole-block selection, the
  // delete (the DOM input diff commits the empty text), then paste the
  // invalid text (the multi-line input's route for code blocks, see
  // pastePlainText). The Ctrl+A stands no block scope over the shared
  // page's editable (the whole document's selection), so the block's
  // clear stands the product's triple press.
  const inner = blockA.locator('[data-slot="docblocks/block-content"]');
  await inner.click({ clickCount: 3 });
  await a.keyboard.press("Backspace");
  await pastePlainText(a, "graph TD\n A -->");

  // The preview switch renders the error state: no svg (the error state
  // renders the raw text with the error flag — asserted by the attribute,
  // not the look), and the message shows (the Alert's triangle icon is
  // chrome, not a diagram — the diagram container itself is absent).
  await switchToPreview(a, "a");
  await expect(blockA.locator('[data-slot="docblocks/mermaid-diagram"]')).toHaveCount(0);
  await expect(preview(a, "a")).toHaveAttribute("data-state", "error");
  await expect(blockA.locator('[data-slot="docblocks/mermaid-error"]')).toHaveText("graph TD\n A -->");
  expect(await blockA.locator('[data-slot="docblocks/mermaid-error-message"]').count()).toBe(1);

  // The page stayed alive through the rejected render: the pane still
  // reports its connection state.
  await expect(a.getByTestId("status-a")).toHaveText("connected");

  // A rejected render leaves no temp container in the page (mermaid keeps
  // its working element in <body> on error unless suppressErrorRendering is
  // set — a page-level pin, since the block-scoped svg count above cannot
  // see the leak).
  expect(await a.locator("body > div[id^='dmb-']").count()).toBe(0);

  await close();
});

test("a plain code block stays editable under the override", async ({ browser }) => {
  const { a, close } = await twoPanes(browser, "ext02-plain-code");

  // The harness registers the override on every pane: a non-mermaid code
  // block must still edit through the built-in contenteditable path.
  await insertType(a, "a", "code");
  const block = a.locator('[data-block-type="code"][data-language="ts"]');
  await expect(block).toHaveCount(1);
  expect(await block.locator('[data-slot="docblocks/block-content"] svg').count()).toBe(0);

  const inner = block.locator('[data-slot="docblocks/block-content"]');
  await inner.click();
  await a.keyboard.type("const x = 1;");
  await expect(inner).toContainText("const x = 1;");

  await close();
});

test("the code header's controls stay visible while the more menu stands open (the portaled menu loses the block hover)", async ({
  browser,
}) => {
  const { a, close } = await twoPanes(browser, "ext02-mermaid-hover");

  await insertType(a, "a", "code-mermaid");
  const block = mermaidBlock(a, "a");
  await block.hover();

  const header = block.locator('[data-slot="docblocks/code-header"]');
  const leftGroup = header.locator(":scope > div").first();
  const actions = header.locator('[data-slot="docblocks/code-header-actions"]');
  // The hover state: both header groups stand visible.
  await expect(actions).toHaveCSS("opacity", "1");
  await expect(leftGroup).toHaveCSS("opacity", "1");

  // Open the more menu and move the pointer ONTO the menu itself (it is
  // portaled outside the block — the block hover is gone): the controls
  // must stay visible.
  await block.locator('[data-slot="docblocks/code-more"]').click();
  const menu = a.locator('[data-slot="docblocks/code-more-menu"]');
  await expect(menu).toBeVisible();
  await menu.hover();
  await expect(actions).toHaveCSS("opacity", "1");
  await expect(leftGroup).toHaveCSS("opacity", "1");

  await close();
});

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
    // The fit's exact scale (the transform's matrix — the label rounds).
    const scaleBefore = await viewport.evaluate((el) => {
      const layer = el.querySelector<HTMLElement>('[data-slot="docblocks/mermaid-viewport-layer"]');
      return layer === null ? null : new DOMMatrix(getComputedStyle(layer).transform).a;
    });
    expect(scaleBefore).not.toBeNull();
    await viewport.hover();
    await viewport.locator('[data-slot="docblocks/mermaid-zoom-in"]').click();
    const expectedScale = (scaleBefore as number) * 1.2;
    await expect(label).toHaveText(`${Math.round(expectedScale * 100)}%`);
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
