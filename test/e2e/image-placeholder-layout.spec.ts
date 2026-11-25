// The blob placeholder's box: the width stays inside the page column (the
// inline aspect ratio alone lets a very wide figure's card outgrow it and
// the document scroller stands a horizontal overflow), and the content
// stands centered in the reserved height. The harness's fixed blob keys
// carry the intrinsic dimensions: `demo-image-banner` stands the 1132x43
// ratio (far wider than the column), `demo-image-tall` the 320x240 one.
import { type Page, expect, test } from "@playwright/test";

import { SETTLE, openPane } from "./helpers";

const PANE = '[data-testid="doc-a"]';

/** The banner's ratio is thin, so the placeholder's content height (not the
 *  aspect) drives its box: the tail of a long sequence stays outside the
 *  preload band (the viewport plus the 200% margin on each side) and keeps
 *  its placeholder. */
const BANNER_COUNT = 200;

/** The tall fixture's placeholder reserves ~675 px at the column's width:
 *  a short sequence is enough to leave the tail outside the band. */
const TALL_COUNT = 8;

const room = (): string => `image-box-${Math.random().toString(36).slice(2, 8)}`;

/** Insert image blocks over the harness's doc hook; returns their ids. */
async function insertImages(page: Page, src: string, count: number): Promise<string[]> {
  return page.evaluate(
    ({ src: source, total }) => {
      const doc = window.__paneDocs?.a ?? null;
      if (doc === null) throw new Error("the pane's doc is not mounted");
      const ids: string[] = [];
      for (let index = 0; index < total; index += 1) ids.push(doc.insertBlock("image", { src: source }));
      return ids;
    },
    { src, total: count }
  );
}

function placeholders(page: Page) {
  return page.locator(`${PANE} [data-slot="docblocks/image-placeholder"]`);
}

function images(page: Page) {
  return page.locator(`${PANE} img[data-slot="docblocks/image"]`);
}

/** Wait until every block stands resolved or pending. */
async function imagesSettled(page: Page, count: number): Promise<void> {
  await expect.poll(async () => (await placeholders(page).count()) + (await images(page).count()), SETTLE).toBe(count);
}

test("the wide placeholder never outgrows the page column", async ({ page }) => {
  await openPane(page, "a", room());
  await insertImages(page, "demo-image-banner", BANNER_COUNT);
  await imagesSettled(page, BANNER_COUNT);

  const stand = await page.evaluate((selector) => {
    const row = document.querySelector<HTMLElement>(`${selector} [data-slot="docblocks/row"]`);
    if (row === null) throw new Error("the pane's row is absent");
    const pending = [
      ...document.querySelectorAll<HTMLElement>(`${selector} [data-slot="docblocks/image-placeholder"]`),
    ];
    const boxes = [
      ...pending,
      ...document.querySelectorAll<HTMLElement>(`${selector} img[data-slot="docblocks/image"]`),
    ];
    return {
      pending: pending.length,
      rowWidth: row.getBoundingClientRect().width,
      maxBoxWidth: Math.max(...boxes.map((element) => element.getBoundingClientRect().width)),
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    };
  }, PANE);

  expect(stand.pending, "the off-band blocks keep their placeholders").toBeGreaterThan(0);
  expect(stand.maxBoxWidth).toBeLessThanOrEqual(stand.rowWidth + 0.5);
  expect(stand.scrollWidth, "the document scroller stands no horizontal overflow").toBeLessThanOrEqual(
    stand.clientWidth
  );
});

test("the placeholder's content is centered in the reserved box", async ({ page }) => {
  await openPane(page, "a", room());
  await insertImages(page, "demo-image-tall", TALL_COUNT);
  await imagesSettled(page, TALL_COUNT);

  const stand = await page.evaluate((selector) => {
    const pending = [
      ...document.querySelectorAll<HTMLElement>(`${selector} [data-slot="docblocks/image-placeholder"]`),
    ];
    const box = pending[pending.length - 1];
    if (box === undefined) throw new Error("the off-band placeholder is absent");
    const content = box.querySelector<HTMLElement>('[data-slot="card-content"]');
    if (content === null) throw new Error("the placeholder's content is absent");
    const boxRect = box.getBoundingClientRect();
    const contentRect = content.getBoundingClientRect();
    return {
      height: boxRect.height,
      contentHeight: contentRect.height,
      contentOffset: contentRect.top + contentRect.height / 2 - (boxRect.top + boxRect.height / 2),
    };
  }, PANE);

  expect(stand.height, "the reserved box is taller than the content").toBeGreaterThan(stand.contentHeight * 2);
  expect(Math.abs(stand.contentOffset), "the content's center stands on the box's center").toBeLessThanOrEqual(1);
});
