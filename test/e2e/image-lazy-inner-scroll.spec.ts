// The lazy preload band over the consumer's own scroll box (`?innerScroll=1`:
// the pane's doc area scrolls, the page stands still). The band's frame is
// the scroll container (`scrollContainer` on the provider): an element
// clipped by the inner scroller never intersects a window-rooted observer,
// so the band would degenerate to the visible area and the preload would
// never run. The harness's store records its `get` calls on
// `window.__blobGets` (the same probe the window-scroll spec uses).
import { type Page, expect, test } from "@playwright/test";

import { SETTLE, openPane } from "./helpers";

const PANE = '[data-testid="doc-a"]';

/** Ten images of the demo ratio (120x80) stand roughly 400 px each at the
 *  harness's column width: the band (the box plus the 200% margin on both
 *  sides) covers the first few blocks, the tail stays pending. */
const IMAGE_COUNT = 12;

const room = (): string => `inner-scroll-${Math.random().toString(36).slice(2, 8)}`;

function placeholders(page: Page) {
  return page.locator(`${PANE} [data-slot="docblocks/image-placeholder"]`);
}

function images(page: Page) {
  return page.locator(`${PANE} img[data-slot="docblocks/image"]`);
}

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

async function imagesSettled(page: Page, count: number): Promise<void> {
  await expect.poll(async () => (await placeholders(page).count()) + (await images(page).count()), SETTLE).toBe(count);
}

interface InnerStand {
  boxHeight: number;
  boxScrolls: boolean;
  resolvedBelow: number;
}

/** The pane's scroll box's frame and the resolved blocks standing below its
 *  visible bottom (the band's preload — an element the reader cannot see). */
async function innerStand(page: Page): Promise<InnerStand> {
  return page.evaluate((selector) => {
    const box = document.querySelector<HTMLElement>(selector);
    if (box === null) throw new Error("the pane's doc area is absent");
    const frame = box.getBoundingClientRect();
    const resolved = [...box.querySelectorAll<HTMLElement>('img[data-slot="docblocks/image"]')];
    return {
      boxHeight: frame.height,
      boxScrolls: box.scrollHeight > box.clientHeight,
      resolvedBelow: resolved.filter((element) => element.getBoundingClientRect().top > frame.bottom).length,
    };
  }, PANE);
}

test("the inner scroller's band preloads the blocks below its visible area", async ({ page }) => {
  await openPane(page, "a", room(), { innerScroll: true });
  const ids = await insertImages(page, IMAGE_COUNT);
  expect(ids).toHaveLength(IMAGE_COUNT);

  // The band's blocks resolve at mount — some of them below the box's
  // visible bottom (a window-rooted observer never sees those: the band
  // stands the visible area only).
  await expect.poll(async () => (await innerStand(page)).resolvedBelow, SETTLE).toBeGreaterThan(0);

  const stand = await innerStand(page);
  expect(stand.boxHeight, "the pane's own box frames the band").toBeGreaterThan(0);
  expect(stand.boxScrolls, "the document scrolls inside the box, not the page").toBe(true);
});

test("the inner scroll resolves the next image from the band before it enters the frame", async ({ page }) => {
  await openPane(page, "a", room(), { innerScroll: true });
  await insertImages(page, IMAGE_COUNT);
  await imagesSettled(page, IMAGE_COUNT);

  // Scroll the pane's box so the last pending block's top stands 1.5 box
  // heights below the visible bottom: inside the band, outside the frame.
  const target = await page.evaluate((selector) => {
    const box = document.querySelector<HTMLElement>(selector);
    if (box === null) throw new Error("the pane's doc area is absent");
    const pending = [...box.querySelectorAll<HTMLElement>('[data-slot="docblocks/image-placeholder"]')];
    const element = pending[pending.length - 1];
    if (element === undefined) throw new Error("no pending image stands");
    const boxRect = box.getBoundingClientRect();
    const offset = element.getBoundingClientRect().top - boxRect.top + box.scrollTop;
    box.scrollTop = Math.max(0, offset - boxRect.height * 1.5);
    return element.dataset.blockId ?? "";
  }, PANE);

  const resolved = page.locator(`${PANE} img[data-slot="docblocks/image"][data-block-id="${target}"]`);
  await expect(resolved).toHaveCount(1, SETTLE);

  // The bytes landed while the block still stood below the box's bottom.
  const belowFrame = await page.evaluate(
    ({ selector, id }) => {
      const box = document.querySelector<HTMLElement>(selector);
      const image = document.querySelector<HTMLElement>(`[data-slot="docblocks/image"][data-block-id="${id}"]`);
      if (box === null || image === null) return null;
      return image.getBoundingClientRect().top > box.getBoundingClientRect().bottom;
    },
    { selector: PANE, id: target }
  );
  expect(belowFrame, "the block stood outside the visible area over the resolve").toBe(true);
});
