import { type Page, expect, test } from "@playwright/test";

import { openPane, twoPanes } from "./helpers";

const SETTLE = { timeout: 20_000 };
const FIXTURE = new URL("./fixtures/sample.pdf", import.meta.url).pathname;
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
  await page.locator('[data-slot="docblocks/slash-item"]', { hasText: "Image" }).click();
  const chooser = await chooserPromise;
  await chooser.setFiles(fixture);
}

test("the pdf subtype stands the first-page canvas preview after the upload", async ({ browser }) => {
  const { a, b, close } = await twoPanes(browser, "pdf-preview");
  try {
    // Upload the PDF through the slash Image path (pane A's store).
    const target = a.locator('[data-testid="doc-a"] [data-slot="docblocks/block-content"]').first();
    await target.click();
    await a.keyboard.type("/image");
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
    await a.keyboard.type("/image");
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
