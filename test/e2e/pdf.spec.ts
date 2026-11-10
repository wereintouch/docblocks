import { type Page, expect, test } from "@playwright/test";

import { openPane, twoPanes } from "./helpers";

const SETTLE = { timeout: 20_000 };
const FIXTURE = new URL("./fixtures/sample.pdf", import.meta.url).pathname;
// A 3-page PDF (the page navigation's pin: the prev/next buttons + the
// page indicator over a multi-page document).
const FIXTURE_MULTI_PAGE = new URL("./fixtures/multi-page.pdf", import.meta.url).pathname;
// A real scanned PDF whose text layers are JBIG2-encoded (a JPEG background
// image plus separate JBIG2 glyph/signature layers). It exercises the JBIG2
// decoder path: without a resolvable wasmUrl the worker drops those layers and
// the page renders as a bare (mostly-white) background image.
const FIXTURE_JBIG2 = new URL("./fixtures/scan-jbig2.pdf", import.meta.url).pathname;

/** The pane's image block's attrs from the harness global (its own letter). */
async function imageAttrs(page: Page, client: "a" | "b"): Promise<Record<string, unknown> | null> {
  return page.evaluate((c) => {
    const doc = c === "a" ? window.__paneDocs?.a : window.__paneDocs?.b;
    if (doc === null || doc === undefined) return null;
    const json = doc.toJSON();
    const block = Object.values(json.blocks).find((entry) => entry.type === "image");
    return block?.attrs ?? null;
  }, client);
}

/** Pick the slash Image and deliver a PDF fixture (the upload path). */
async function uploadPdf(page: Page, fixture: string): Promise<void> {
  const chooserPromise = page.waitForEvent("filechooser");
  await page.locator('[data-slot="docblocks/slash-item"]', { hasText: "File" }).click();
  const chooser = await chooserPromise;
  await chooser.setFiles(fixture);
}

test("the pdf subtype stands the first-page canvas preview after the upload", async ({ browser }) => {
  const { a, b, close } = await twoPanes(browser, "pdf-preview");
  try {
    // Upload the PDF through the slash Image path (pane A's store).
    const target = a.locator('[data-testid="doc-a"] [data-slot="docblocks/block-content"]').first();
    await target.click();
    await a.keyboard.type("/file");
    await expect(a.locator('[data-slot="docblocks/slash-menu"]').first()).toBeVisible(SETTLE);
    await uploadPdf(a, FIXTURE);

    // The preview settles from the loading phase into the ready phase: the
    // first page is rendered to the canvas by pdfjs-dist.
    const shell = a.locator('[data-slot="docblocks/image-pdf-preview"]');
    await expect(shell).toHaveAttribute("data-phase", "ready", SETTLE);

    const canvas = a.locator('[data-slot="docblocks/image-pdf-canvas"]');
    await expect(canvas).toBeVisible(SETTLE);
    const dims = await canvas.evaluate((el) => {
      const c = el as HTMLCanvasElement;
      return { width: c.width, height: c.height };
    });
    expect(dims.width).toBeGreaterThan(100);
    expect(dims.height).toBeGreaterThan(100);

    // The canvas is actually painted (the page's opaque background), not a
    // blank backing store.
    const painted = await canvas.evaluate((el) => {
      const c = el as HTMLCanvasElement;
      const ctx = c.getContext("2d");
      if (ctx === null) return false;
      const { width, height } = c;
      const samples: [number, number][] = [
        [Math.floor(width / 2), Math.floor(height / 2)],
        [10, 10],
        [Math.floor(width / 2), 10],
      ];
      return samples.some(([x, y]) => (ctx.getImageData(x, y, 1, 1).data[3] ?? 0) > 0);
    });
    expect(painted).toBe(true);

    // The document holds only the opaque key (the bytes are consumer-side):
    // the src is the store's key, not a data url.
    const attrs = await imageAttrs(a, "a");
    expect(attrs).not.toBeNull();
    expect(typeof attrs!.src).toBe("string");
    expect(attrs!.src).not.toMatch(/^data:/);

    // Pane B's store holds no blob (the upload was pane A's): B's figure
    // stands the placeholder card — the slot is the wire pin.
    await expect(b.locator('[data-slot="docblocks/image-placeholder"]')).toHaveCount(1, SETTLE);
  } finally {
    await close();
  }
});

test("the jbig2 text layers of a scanned pdf stand in the canvas preview", async ({ browser }) => {
  const context = await browser.newContext();
  const a = await context.newPage();
  const room = `jbig2-${Math.random().toString(36).slice(2, 8)}`;
  try {
    await openPane(a, "a", room, { first: true });
    // Upload the scanned (JBIG2) PDF through the slash Image path.
    const target = a.locator('[data-testid="doc-a"] [data-slot="docblocks/block-content"]').first();
    await target.click();
    await a.keyboard.type("/file");
    await expect(a.locator('[data-slot="docblocks/slash-menu"]').first()).toBeVisible(SETTLE);
    await uploadPdf(a, FIXTURE_JBIG2);

    // The preview settles into the ready phase and paints the first page.
    const canvas = a.locator('[data-slot="docblocks/image-pdf-canvas"]');
    await expect(a.locator('[data-slot="docblocks/image-pdf-preview"]')).toHaveAttribute("data-phase", "ready", SETTLE);
    await expect(canvas).toBeVisible(SETTLE);

    // The JBIG2 glyph layers render as dark text. The pin is the dark-pixel
    // fraction of the backing store: a render that drops the JBIG2 layers
    // shows only the (mostly-white) background image and reads near-zero,
    // while the decoded text reads well above the threshold.
    const darkFrac = await canvas.evaluate((el) => {
      const c = el as HTMLCanvasElement;
      const ctx = c.getContext("2d");
      if (ctx === null) return -1;
      const { data, width, height } = ctx.getImageData(0, 0, c.width, c.height);
      let dark = 0;
      let total = 0;
      for (let i = 0; i + 2 < data.length; i += 16) {
        const lum = ((data[i] ?? 0) + (data[i + 1] ?? 0) + (data[i + 2] ?? 0)) / 3;
        total += 1;
        if (lum < 128) dark += 1;
      }
      return width === 0 || height === 0 ? -1 : dark / total;
    });
    expect(darkFrac).toBeGreaterThan(0.01);
  } finally {
    await context.close();
  }
});

test("the page navigation: the prev/next buttons + the page indicator over a multi-page pdf", async ({ browser }) => {
  const context = await browser.newContext();
  const a = await context.newPage();
  const room = `pdf-nav-${Math.random().toString(36).slice(2, 8)}`;
  try {
    await openPane(a, "a", room, { first: true });
    const target = a.locator('[data-testid="doc-a"] [data-slot="docblocks/block-content"]').first();
    await target.click();
    await a.keyboard.type("/file");
    await expect(a.locator('[data-slot="docblocks/slash-menu"]').first()).toBeVisible(SETTLE);
    await uploadPdf(a, FIXTURE_MULTI_PAGE);

    // The preview settles into the ready phase (the 3-page document).
    const shell = a.locator('[data-slot="docblocks/image-pdf-preview"]');
    await expect(shell).toHaveAttribute("data-phase", "ready", SETTLE);

    // The control bar stands over the ready phase: the page indicator
    // (1 / 3), the prev button (disabled on the first page), the next
    // button (enabled), the fullscreen toggle.
    const indicator = a.locator('[data-slot="docblocks/image-pdf-page-indicator"]');
    await expect(indicator).toHaveText("1 / 3", SETTLE);
    const prev = a.locator('[data-slot="docblocks/image-pdf-prev"]');
    const next = a.locator('[data-slot="docblocks/image-pdf-next"]');
    const fullscreen = a.locator('[data-slot="docblocks/image-pdf-fullscreen"]');
    expect(await prev.isDisabled()).toBe(true);
    expect(await next.isDisabled()).toBe(false);
    expect(await fullscreen.count()).toBe(1);

    // The next button advances the page (2 / 3); the prev button unlocks.
    await next.click();
    await expect(indicator).toHaveText("2 / 3", SETTLE);
    expect(await prev.isDisabled()).toBe(false);
    expect(await next.isDisabled()).toBe(false);

    // The next button reaches the last page (3 / 3) and disables itself.
    await next.click();
    await expect(indicator).toHaveText("3 / 3", SETTLE);
    expect(await next.isDisabled()).toBe(true);

    // The prev button walks back (2 / 3, then 1 / 3); the prev button
    // disables on the first page.
    await prev.click();
    await expect(indicator).toHaveText("2 / 3", SETTLE);
    await prev.click();
    await expect(indicator).toHaveText("1 / 3", SETTLE);
    expect(await prev.isDisabled()).toBe(true);

    // The fullscreen overlay: the toggle opens the overlay (the portal),
    // the overlay carries the same page navigation + the close button.
    await fullscreen.click();
    const overlay = a.locator('[data-slot="docblocks/image-pdf-fullscreen-overlay"]');
    await expect(overlay).toBeVisible(SETTLE);
    expect(await overlay.locator('[data-slot="docblocks/image-pdf-page-indicator"]').textContent()).toBe("1 / 3");
    expect(await overlay.locator('[data-slot="docblocks/image-pdf-fullscreen-close"]').count()).toBe(1);

    // The fullscreen's control bar stands the inline's (the thin border +
    // the rounded corners, the same over both), the minimize icon the only
    // difference (the fullscreen toggle stands absent over the overlay).
    const bars = await a.evaluate(() => {
      const styleOf = (selector: string): { width: string; color: string; radius: string } | null => {
        const el = document.querySelector(selector);
        if (el === null) return null;
        const c = getComputedStyle(el);
        return { width: c.borderTopWidth, color: c.borderTopColor, radius: c.borderRadius };
      };
      return {
        inline: styleOf('[data-slot="docblocks/image-pdf-preview"] [data-slot="docblocks/image-pdf-controls"]'),
        overlay: styleOf(
          '[data-slot="docblocks/image-pdf-fullscreen-overlay"] [data-slot="docblocks/image-pdf-controls"]'
        ),
      };
    });
    expect(bars.inline, "the inline's control bar stands").not.toBeNull();
    expect(bars.overlay, "the overlay's control bar stands").not.toBeNull();
    expect(bars.overlay!.width).toBe(bars.inline!.width);
    expect(bars.overlay!.color).toBe(bars.inline!.color);
    expect(bars.overlay!.radius).toBe(bars.inline!.radius);
    expect(bars.overlay!.width, "the border stands thin (not the 0px / 3px fallback)").not.toBe("0px");
    expect(await overlay.locator('[data-slot="docblocks/image-pdf-minimize"]').count()).toBe(1);
    expect(await overlay.locator('[data-slot="docblocks/image-pdf-fullscreen"]').count()).toBe(0);

    // The outside click's exit: a click over the page's canvas stands the
    // overlay, a click over the overlay's own surface (the background
    // around the page) closes the fullscreen mode.
    const canvasBox = (await overlay.locator('[data-slot="docblocks/image-pdf-fullscreen-canvas"]').boundingBox())!;
    await a.mouse.click(canvasBox.x + canvasBox.width / 2, canvasBox.y + canvasBox.height / 2);
    await expect(overlay).toBeVisible();
    const overlayBox = (await overlay.boundingBox())!;
    await a.mouse.click(overlayBox.x + 5, overlayBox.y + 5);
    await expect(overlay).toBeHidden(SETTLE);

    // Re-opened, the Escape key exits the overlay.
    await fullscreen.click();
    await expect(overlay).toBeVisible(SETTLE);
    await a.keyboard.press("Escape");
    await expect(overlay).toBeHidden(SETTLE);
  } finally {
    await context.close();
  }
});
