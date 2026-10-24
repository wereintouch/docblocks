import { type Browser, type Page, expect, test } from "@playwright/test";

// Each test gets its own room via ?syncUrl= — the relay keeps rooms for
// the dev server's lifetime, so a shared room would be polluted by other
// spec files (and by manually opened tabs).
const RELAY = "ws://localhost:5199";
const SETTLE = { timeout: 20_000 };
const FIXTURE = new URL("./fixtures/sample.pdf", import.meta.url).pathname;

async function openPane(page: Page, client: "a" | "b", room: string): Promise<void> {
  await page.goto(`/?client=${client}&syncUrl=${RELAY}/${room}`);
  await expect(page.getByTestId(`status-${client}`).first()).toHaveText("connected");
}

async function twoPanes(browser: Browser, room: string): Promise<{ a: Page; b: Page; close: () => Promise<void> }> {
  const contextA = await browser.newContext();
  const contextB = await browser.newContext();
  const a = await contextA.newPage();
  const b = await contextB.newPage();
  const uniqueRoom = `${room}-${Math.random().toString(36).slice(2, 8)}`;
  await openPane(a, "a", uniqueRoom);
  await openPane(b, "b", uniqueRoom);
  return {
    a,
    b,
    close: async () => {
      await contextA.close();
      await contextB.close();
    },
  };
}

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

/** Pick the slash Image and deliver the PDF fixture (the upload path). */
async function uploadPdf(page: Page): Promise<void> {
  const chooserPromise = page.waitForEvent("filechooser");
  await page.locator('[data-slot="docblocks/slash-item"]', { hasText: "Image" }).click();
  const chooser = await chooserPromise;
  await chooser.setFiles(FIXTURE);
}

test("the pdf subtype stands the first-page canvas preview after the upload", async ({ browser }) => {
  const { a, b, close } = await twoPanes(browser, "pdf-preview");
  try {
    // Upload the PDF through the slash Image path (pane A's store).
    const target = a.locator('[data-testid="doc-a"] [data-slot="docblocks/block-content"]').first();
    await target.click();
    await a.keyboard.type("/image");
    await expect(a.locator('[data-slot="docblocks/slash-menu"]').first()).toBeVisible(SETTLE);
    await uploadPdf(a);

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
