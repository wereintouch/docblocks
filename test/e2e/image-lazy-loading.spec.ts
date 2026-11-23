// The lazy blob resolution: the image blocks' bytes resolve only when the
// block enters the viewport's preload band (the metadata's head lookup runs
// at mount — the placeholder reserves the aspect ratio from it); the blocks
// above the fold resolve eagerly, the cover stands eager over any scroll,
// the read-only view keeps the resolution, and the explicit eager policy
// resolves every block at mount. The harness's blob store records its `get`
// calls on `window.__blobGets` (the probe).
import { type Page, expect, test } from "@playwright/test";

import { SETTLE, openPane, twoPanes } from "./helpers";

const paneOf = (client: "a" | "b"): string => `[data-testid="doc-${client}"]`;

const PANE = paneOf("a");

/** Ten images stand the band's boundary well inside the document: the
 *  demo image renders at the column's width (the 120x80 viewBox's 1.5
 *  ratio — roughly 600 px tall at the harness's 900 px column), so the
 *  band (the viewport plus the 200% preload margin) covers the first few
 *  blocks only. */
const IMAGE_COUNT = 10;

const room = (): string => `lazy-img-${Math.random().toString(36).slice(2, 8)}`;

function placeholders(page: Page) {
  return page.locator(`${PANE} [data-slot="docblocks/image-placeholder"]`);
}

function images(page: Page) {
  return page.locator(`${PANE} img[data-slot="docblocks/image"]`);
}

/** The store's `get` calls (the file ids, in order). */
async function blobGets(page: Page): Promise<string[]> {
  return page.evaluate(() => [...(window.__blobGets ?? [])]);
}

/** Insert the images through the harness's insert hook; returns their ids. */
async function insertImages(page: Page, count: number): Promise<string[]> {
  return page.evaluate((total) => {
    const ids: string[] = [];
    for (let index = 0; index < total; index += 1) {
      const id = window.__insertBlock?.("a", "image") ?? null;
      if (id !== null) ids.push(id);
    }
    return ids;
  }, count);
}

/** Wait until every image block renders its resolved element or placeholder. */
async function imagesSettled(page: Page, count: number): Promise<void> {
  await expect.poll(async () => (await placeholders(page).count()) + (await images(page).count()), SETTLE).toBe(count);
}

/** The measured stand of the pane's first placeholder (the aspect-ratio
 *  reservation's probe) and the page's height. */
async function firstPlaceholderStand(
  page: Page
): Promise<{ id: string; aspect: string; height: number; rowTop: number; scrollHeight: number }> {
  return page.evaluate((selector) => {
    const element = document.querySelector<HTMLElement>(`${selector} [data-slot="docblocks/image-placeholder"]`);
    if (element === null) throw new Error("the pane's image placeholder is absent");
    const row = element.closest<HTMLElement>('[data-slot="docblocks/row"]');
    if (row === null) throw new Error("the placeholder's row is absent");
    return {
      id: element.dataset.blockId ?? "",
      aspect: getComputedStyle(element).aspectRatio.replace(/\s+/g, ""),
      height: element.getBoundingClientRect().height,
      rowTop: row.getBoundingClientRect().top + window.scrollY,
      scrollHeight: document.documentElement.scrollHeight,
    };
  }, PANE);
}

/** Scroll so the block's top sits `viewports` viewport heights below the
 *  frame (inside the preload band, outside the viewport). */
async function scrollBelowFold(page: Page, top: number, viewports: number): Promise<void> {
  await page.evaluate(
    ({ top: blockTop, viewports: distance }) => {
      window.scrollTo(0, Math.max(0, blockTop - window.innerHeight * distance));
    },
    { top, viewports }
  );
}

test("only the blocks in the viewport's preload band resolve at mount", async ({ page }) => {
  await openPane(page, "a", room());
  await insertImages(page, IMAGE_COUNT);
  await imagesSettled(page, IMAGE_COUNT);

  // The first screen's images stand resolved (the eager priority), the
  // off-band ones hold their placeholders: the store's get calls stand one
  // per resolved block and never cover the whole document.
  const gets = await blobGets(page);
  const pending = await placeholders(page).count();
  expect(gets.length, "the band's blocks resolved").toBeGreaterThan(0);
  expect(pending, "the off-band blocks stand placeholders").toBeGreaterThan(0);
  expect(gets.length + pending, "every block stands resolved or pending").toBe(IMAGE_COUNT);
  await expect(images(page).first()).toBeVisible();
});

test("the scroll resolves the next image from the preload band before it enters the frame", async ({ page }) => {
  await openPane(page, "a", room());
  await insertImages(page, IMAGE_COUNT);
  await imagesSettled(page, IMAGE_COUNT);

  // The last placeholder stands well below the band: scroll so its top sits
  // 1.5 viewport heights below the frame — inside the band, off screen.
  const target = await page.evaluate((selector) => {
    const all = [...document.querySelectorAll<HTMLElement>(`${selector} [data-slot="docblocks/image-placeholder"]`)];
    const element = all[all.length - 1];
    if (element === undefined) throw new Error("no pending image stands");
    return { id: element.dataset.blockId ?? "", top: element.getBoundingClientRect().top + window.scrollY };
  }, PANE);
  await scrollBelowFold(page, target.top, 1.5);

  const resolved = page.locator(`${PANE} img[data-slot="docblocks/image"][data-block-id="${target.id}"]`);
  await expect(resolved).toHaveCount(1, SETTLE);
  // The bytes landed while the block still stood below the frame (the band's
  // preload — no spinner over the entry).
  const offscreen = await resolved.evaluate((element) => element.getBoundingClientRect().top > window.innerHeight);
  expect(offscreen, "the image resolved before entering the frame").toBe(true);
});

test("the placeholder reserves the aspect ratio from the metadata (the landing shifts nothing)", async ({ page }) => {
  await openPane(page, "a", room());
  await insertImages(page, IMAGE_COUNT);
  await imagesSettled(page, IMAGE_COUNT);

  const before = await firstPlaceholderStand(page);
  expect(before.aspect, "the demo image's 120x80 aspect").toBe("120/80");
  expect(before.height, "the placeholder reserves a height").toBeGreaterThan(0);

  // Bring the block into the band: the resolved image keeps the reserved
  // height, so the page's height and the block's document top stay put.
  await scrollBelowFold(page, before.rowTop, 0.5);
  const resolved = page.locator(`${PANE} img[data-slot="docblocks/image"][data-block-id="${before.id}"]`);
  await expect(resolved).toHaveCount(1, SETTLE);

  const after = await resolved.evaluate((element) => {
    const row = element.closest<HTMLElement>('[data-slot="docblocks/row"]');
    if (row === null) throw new Error("the image's row is absent");
    return {
      rowTop: row.getBoundingClientRect().top + window.scrollY,
      height: element.getBoundingClientRect().height,
      scrollHeight: document.documentElement.scrollHeight,
    };
  });
  // The placeholder's reserved box is the image's box: the landing changes
  // neither the block's anchor nor the page's height (the card's border
  // stands the only few-pixel difference).
  expect(Math.abs(after.height - before.height), "the image stands the reserved height").toBeLessThanOrEqual(8);
  expect(Math.abs(after.rowTop - before.rowTop), "the block's anchor stays").toBeLessThanOrEqual(1);
  expect(Math.abs(after.scrollHeight - before.scrollHeight), "the page's height stays").toBeLessThanOrEqual(2);
});

test("the cover resolves eagerly over a scrolled page", async ({ page }) => {
  await openPane(page, "a", room());
  await insertImages(page, IMAGE_COUNT);
  await imagesSettled(page, IMAGE_COUNT);
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));

  // The cover's attribute lands while the banner's slot stands far above
  // the viewport: the cover's resolution is not viewport-gated.
  await page.evaluate(() => {
    const doc = window.__paneDocs?.a ?? null;
    if (doc === null) throw new Error("the pane's doc is not mounted");
    doc.setAttribute("cover", "cover-tile-1");
  });
  await expect(page.locator(`${PANE} [data-slot="docblocks/cover-banner"]`)).toHaveCount(1, SETTLE);
  expect(await blobGets(page)).toContain("cover-tile-1");
});

test("the read-only view keeps resolving the images over the scroll", async ({ page }) => {
  await openPane(page, "a", room());
  await insertImages(page, IMAGE_COUNT);
  await imagesSettled(page, IMAGE_COUNT);
  await page.locator('[data-slot="docblocks/doc-header-mode"] button[aria-label="View mode"]').click();
  await expect(page.locator(`${PANE} [data-slot="docblocks/editor"]`)).toHaveAttribute("data-mode", "view");

  const target = await page.evaluate((selector) => {
    const all = [...document.querySelectorAll<HTMLElement>(`${selector} [data-slot="docblocks/image-placeholder"]`)];
    const element = all[all.length - 1];
    if (element === undefined) throw new Error("no pending image stands");
    return { id: element.dataset.blockId ?? "", top: element.getBoundingClientRect().top + window.scrollY };
  }, PANE);
  await scrollBelowFold(page, target.top, 1.5);

  await expect(page.locator(`${PANE} img[data-slot="docblocks/image"][data-block-id="${target.id}"]`)).toHaveCount(
    1,
    SETTLE
  );
});

test("the explicit eager policy resolves every block at mount", async ({ page }) => {
  await openPane(page, "a", room(), { blobEager: true });
  await insertImages(page, IMAGE_COUNT);
  await imagesSettled(page, IMAGE_COUNT);

  expect(await placeholders(page).count()).toBe(0);
  expect(await blobGets(page)).toHaveLength(IMAGE_COUNT);
});

test("the relay's room carries the same lazy stand to the peer", async ({ browser }) => {
  // The gating is per-view state, never document data: the peer resolves its
  // own viewport's band over the same keys, the rest stand pending.
  const { a, b, close } = await twoPanes(browser, "lazy-img", { first: true });
  try {
    await insertImages(a, IMAGE_COUNT);
    await imagesSettled(a, IMAGE_COUNT);
    const bPane = paneOf("b");
    const both = `${bPane} [data-slot="docblocks/image-placeholder"], ${bPane} img[data-slot="docblocks/image"]`;
    await expect(b.locator(both)).toHaveCount(IMAGE_COUNT, SETTLE);
    await expect(b.locator(`${bPane} [data-slot="docblocks/image-placeholder"]`).first()).toBeVisible();
    expect((await blobGets(b)).length).toBeLessThan(IMAGE_COUNT);
  } finally {
    await close();
  }
});
