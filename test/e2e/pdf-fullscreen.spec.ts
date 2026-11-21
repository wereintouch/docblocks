// The PDF preview's fullscreen mode (the portaled overlay): the zoom bar
// (the zoom in/out + the fit-width / fit-height over a separate pill to the
// left of the page controls) and the arrow keys' page navigation over the
// body's scroll lock (the page number's fixed width).
import { type Page, expect, test } from "@playwright/test";

import { editorContext, openPane } from "./helpers";

const SETTLE = { timeout: 20_000 };
// A 3-page PDF (the zoom bar's pin over a multi-page document).
const FIXTURE_MULTI_PAGE = new URL("./fixtures/multi-page.pdf", import.meta.url).pathname;
// A 12-page PDF (the page number's fixed-width pin: the two-digit page
// numbers must not shift the control bar over the digit count's change).
const FIXTURE_MULTI_PAGE_12 = new URL("./fixtures/multi-page-12.pdf", import.meta.url).pathname;

/** Pick the slash Image and deliver a PDF fixture (the upload path). */
async function uploadPdf(page: Page, fixture: string): Promise<void> {
  const chooserPromise = page.waitForEvent("filechooser");
  await page.locator('[data-slot="docblocks/slash-item"]', { hasText: "File" }).click();
  const chooser = await chooserPromise;
  await chooser.setFiles(fixture);
}

test("the fullscreen zoom bar: the zoom in/out + the fit-width over a separate pill to the left of the page controls", async ({
  browser,
}) => {
  const context = await editorContext(browser);
  const a = await context.newPage();
  const room = `pdf-zoom-${Math.random().toString(36).slice(2, 8)}`;
  try {
    await openPane(a, "a", room, { first: true });
    const target = a.locator('[data-testid="doc-a"] [data-slot="docblocks/block-content"]').first();
    await target.click();
    await a.keyboard.type("/file");
    await expect(a.locator('[data-slot="docblocks/slash-menu"]').first()).toBeVisible(SETTLE);
    await uploadPdf(a, FIXTURE_MULTI_PAGE);

    const shell = a.locator('[data-slot="docblocks/image-pdf-preview"]');
    await expect(shell).toHaveAttribute("data-phase", "ready", SETTLE);

    // The preview's chrome stands no text selection: the page numbers / the
    // controls' text is not document content (a mouse selection over it
    // would flag the block / pull the format toolbar over a non-text
    // range). The inline bar's computed user-select stands none (it stands
    // over the page indicator + the buttons' text, the root wrapper's
    // inheritable guard).
    const inlineUserSelect = await a.evaluate(() => {
      const el = document.querySelector(
        '[data-slot="docblocks/image-pdf-preview"] [data-slot="docblocks/image-pdf-controls"]'
      );
      return el === null ? null : getComputedStyle(el).userSelect;
    });
    expect(inlineUserSelect, "the inline's control bar stands the unselectable text").toBe("none");

    await a.locator('[data-slot="docblocks/image-pdf-fullscreen"]').click();
    const overlay = a.locator('[data-slot="docblocks/image-pdf-fullscreen-overlay"]');
    await expect(overlay).toBeVisible(SETTLE);

    // The zoom bar stands a separate pill to the left of the page's
    // controls, the same style (the border's width/color + the radius
    // stand the controls' over the portaled overlay), and stands no
    // selection over its own text (the percent's indicator).
    const zoomBar = overlay.locator('[data-slot="docblocks/image-pdf-zoom"]');
    const pageControls = overlay.locator('[data-slot="docblocks/image-pdf-controls"]');
    await expect(zoomBar).toBeVisible(SETTLE);
    const zoomBox = (await zoomBar.boundingBox())!;
    const controlsBox = (await pageControls.boundingBox())!;
    expect(zoomBox.x + zoomBox.width, "the zoom's pill stands to the left of the page controls").toBeLessThanOrEqual(
      controlsBox.x
    );
    const styles = await a.evaluate(() => {
      const styleOf = (selector: string) => {
        const el = document.querySelector(selector);
        if (el === null) return null;
        const c = getComputedStyle(el);
        return { width: c.borderTopWidth, color: c.borderTopColor, radius: c.borderRadius, userSelect: c.userSelect };
      };
      return {
        zoom: styleOf('[data-slot="docblocks/image-pdf-fullscreen-overlay"] [data-slot="docblocks/image-pdf-zoom"]'),
        controls: styleOf(
          '[data-slot="docblocks/image-pdf-fullscreen-overlay"] [data-slot="docblocks/image-pdf-controls"]'
        ),
      };
    });
    expect(styles.zoom, "the zoom's pill stands").not.toBeNull();
    expect(styles.controls, "the page controls' pill stands").not.toBeNull();
    expect(styles.zoom!.width).toBe(styles.controls!.width);
    expect(styles.zoom!.color).toBe(styles.controls!.color);
    expect(styles.zoom!.radius).toBe(styles.controls!.radius);
    expect(styles.zoom!.userSelect, "the zoom's pill stands the unselectable text").toBe("none");
    expect(styles.controls!.userSelect, "the page controls' pill stands the unselectable text").toBe("none");

    const zoomIn = zoomBar.locator('[data-slot="docblocks/image-pdf-zoom-in"]');
    const zoomOut = zoomBar.locator('[data-slot="docblocks/image-pdf-zoom-out"]');
    const fitWidth = zoomBar.locator('[data-slot="docblocks/image-pdf-fit-width"]');
    const indicator = zoomBar.locator('[data-slot="docblocks/image-pdf-zoom-indicator"]');
    const canvas = overlay.locator('[data-slot="docblocks/image-pdf-fullscreen-canvas"]');
    const container = overlay.locator('[data-slot="docblocks/image-pdf-fullscreen-container"]');
    await expect(indicator).toHaveText(/^\d+%$/, SETTLE);

    // The zoom in grows the page over the fit's stand (the contain's fit
    // stands on the fresh open); a click over the zoom's pill is the
    // content's zone — the overlay stands (not the outside's exit); the
    // indicator tracks the scale (it stands the fit's percent, not the
    // fresh-open's default, and moves with the step).
    const fitCanvasWidth = (await canvas.boundingBox())!.width;
    const fitIndicator = (await indicator.textContent())!;
    await zoomIn.click();
    await expect.poll(async () => (await canvas.boundingBox())!.width, SETTLE).toBeGreaterThan(fitCanvasWidth);
    await expect(overlay).toBeVisible();
    await expect.poll(async () => (await indicator.textContent())!, SETTLE).not.toBe(fitIndicator);

    // The zoom out steps back to the fit's stand (the step's inverse over
    // the same base); the indicator tracks the scale.
    await zoomOut.click();
    await expect(indicator).toHaveText(fitIndicator, SETTLE);
    await expect
      .poll(async () => Math.abs((await canvas.boundingBox())!.width - fitCanvasWidth) <= 1, SETTLE)
      .toBe(true);

    // The fit-width's button: the page's width fills the container's
    // width (the page is portrait over the wide container, so the fit
    // stands the height — the fit-width out-scales it; the vertical
    // overflow scrolls over the container's scroller).
    const containerBox = (await container.boundingBox())!;
    await fitWidth.click();
    await expect
      .poll(async () => Math.abs((await canvas.boundingBox())!.width - containerBox.width) <= 1, SETTLE)
      .toBe(true);
    const fitWidthCanvas = (await canvas.boundingBox())!.width;
    expect(fitWidthCanvas, "the fit-width out-scales the contain's fit").toBeGreaterThan(fitCanvasWidth);
    const scroll = await container.evaluate((el) => ({ scrollHeight: el.scrollHeight, clientHeight: el.clientHeight }));
    expect(scroll.scrollHeight, "the vertical overflow scrolls").toBeGreaterThan(scroll.clientHeight);

    // The fit-height's button (next to the fit-width's): the page's
    // height fills the container's height — the fit-width's out-scale
    // stands dropped (the width shrinks back over the fit-width's).
    const fitHeight = zoomBar.locator('[data-slot="docblocks/image-pdf-fit-height"]');
    await fitHeight.click();
    await expect
      .poll(async () => Math.abs((await canvas.boundingBox())!.height - containerBox.height) <= 1, SETTLE)
      .toBe(true);
    const fitHeightWidth = (await canvas.boundingBox())!.width;
    expect(fitHeightWidth, "the fit-width's out-scale stands dropped").toBeLessThan(fitWidthCanvas);
  } finally {
    await context.close();
  }
});

test("the fullscreen mode: the arrow keys' page navigation + the body's scroll lock + the page number's fixed width", async ({
  browser,
}) => {
  const context = await editorContext(browser);
  const a = await context.newPage();
  const room = `pdf-keys-${Math.random().toString(36).slice(2, 8)}`;
  try {
    await openPane(a, "a", room, { first: true });
    const target = a.locator('[data-testid="doc-a"] [data-slot="docblocks/block-content"]').first();
    await target.click();
    await a.keyboard.type("/file");
    await expect(a.locator('[data-slot="docblocks/slash-menu"]').first()).toBeVisible(SETTLE);
    await uploadPdf(a, FIXTURE_MULTI_PAGE_12);

    const shell = a.locator('[data-slot="docblocks/image-pdf-preview"]');
    await expect(shell).toHaveAttribute("data-phase", "ready", SETTLE);

    await a.locator('[data-slot="docblocks/image-pdf-fullscreen"]').click();
    const overlay = a.locator('[data-slot="docblocks/image-pdf-fullscreen-overlay"]');
    await expect(overlay).toBeVisible(SETTLE);
    const indicator = overlay.locator('[data-slot="docblocks/image-pdf-page-indicator"]');
    await expect(indicator).toHaveText("1 / 12", SETTLE);

    // The body's scroll lock: a wheel over the fixed portal must not chain
    // to the document's scroll container (the page behind stands).
    const bodyOverflow = await a.evaluate(() => getComputedStyle(document.body).overflow);
    expect(bodyOverflow, "the body's scroll stands locked over the open overlay").toBe("hidden");

    // The arrow keys stand the page's navigation (right = the next, left
    // = the previous). The focus stands the parked page's container (the
    // editor's focus park) or an overlay's control — both stand the
    // navigation (no live caret behind the modal overlay).
    await a.keyboard.press("ArrowRight");
    await expect(indicator).toHaveText("2 / 12", SETTLE);
    await a.keyboard.press("ArrowLeft");
    await expect(indicator).toHaveText("1 / 12", SETTLE);

    // The page number stands a fixed width: the digit count's change
    // (1 → 10) must not shift the control bar.
    const controls = overlay.locator('[data-slot="docblocks/image-pdf-controls"]');
    const firstWidth = (await controls.boundingBox())!.width;
    for (let i = 0; i < 9; i++) await controls.locator('[data-slot="docblocks/image-pdf-next"]').click();
    await expect(indicator).toHaveText("10 / 12", SETTLE);
    const tenthWidth = (await controls.boundingBox())!.width;
    expect(
      Math.abs(tenthWidth - firstWidth),
      "the control bar's width stands over the digit count's change"
    ).toBeLessThanOrEqual(1);

    // The close stands the body's overflow restored (the overlay's lock is
    // the inline's, not the consumer's).
    await a.keyboard.press("Escape");
    await expect(overlay).toBeHidden(SETTLE);
    const restored = await a.evaluate(() => document.body.style.overflow);
    expect(restored, "the body's overflow stands restored on the close").toBe("");
  } finally {
    await context.close();
  }
});
