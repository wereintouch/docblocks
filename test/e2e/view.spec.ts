// The page/canvas view's switch over the pane: the view toggle's render, the mode switcher's
// pill's back-out settle, and the view switch's closing of the page's transient surfaces.
import { expect, test } from "@playwright/test";

import { RELAY, expectStays, switchPaneView } from "./helpers";

const ROOT = '[data-testid="doc-a"]';

test("the page/canvas view toggle (the DocHeader's switcher — the pane's single mode control) renders the page miniature and the surface elements on one canvas", async ({
  page,
}) => {
  const room = `view-${Math.random().toString(36).slice(2, 8)}`;
  await page.goto(`/?canvas=1&syncUrl=${RELAY}/${room}`);
  await expect(page.getByTestId("status-a")).toHaveText("connected");

  // The switcher's regression stand: the DocHeader's switcher is the pane's
  // single mode control — the former toggle buttons stand removed (no
  // testid) and the switcher's buttons stand over the group slot.
  await expect(page.getByTestId("view-a-page")).toHaveCount(0);
  await expect(page.getByTestId("view-a-canvas")).toHaveCount(0);
  const headerView = page.locator(`[data-slot="docblocks/doc-header-view"]`);
  await expect(headerView.getByRole("button", { name: "Page view" })).toBeVisible();
  await expect(headerView.getByRole("button", { name: "Canvas view" })).toBeVisible();

  const card = page.locator(`${ROOT} [data-slot="docblocks/page-card"]`);
  const area = page.locator(ROOT);

  // The canvas pane starts in the canvas view: the page is a miniature
  // rectangle with the page content inside. Assert the real bounding box —
  // a collapsed canvas view (zero height, overflow hidden) clips its
  // children out of the box, which toBeVisible cannot catch. The miniature
  // is taller than the canvas viewport (it scrolls inside the card), so the
  // checks are: the card center coincides with the canvas center (the
  // center-anchor origin) and the card substantially intersects the area.
  const cardBox = (await card.boundingBox())!;
  const areaBox = (await area.boundingBox())!;
  expect(cardBox, "the page card must be laid out").not.toBeNull();
  expect(Math.abs(cardBox.y + cardBox.height / 2 - (areaBox.y + areaBox.height / 2))).toBeLessThan(40);
  expect(cardBox.y).toBeLessThan(areaBox.y + areaBox.height);
  expect(cardBox.y + cardBox.height).toBeGreaterThan(areaBox.y);
  // The card is centered horizontally on the canvas (the center-anchor
  // origin), and the page content renders inside it.
  expect(Math.abs(cardBox.x + cardBox.width / 2 - (areaBox.x + areaBox.width / 2))).toBeLessThan(4);
  await expect(card).toContainText("Page content");

  // The surface elements share the canvas (the seeded doc has four canvas
  // items: two shapes, the canvas text, the connector), each laid out
  // inside the doc area, and the connector line resolves its endpoints
  // within the surface (an unresolved endpoint skips the line — presence
  // is the assertion).
  await expect(page.locator(`${ROOT} [data-slot="docblocks/canvas-item"]`)).toHaveCount(4);
  const itemBox = (await page.locator(`${ROOT} [data-slot="docblocks/canvas-item"]`).first().boundingBox())!;
  expect(itemBox, "the first canvas item must be laid out inside the doc area").not.toBeNull();
  expect(itemBox.y).toBeGreaterThanOrEqual(areaBox.y);
  await expect(page.locator(`${ROOT} [data-slot="docblocks/connector-layer"] path[data-connector-id]`)).toHaveCount(1);
  // The embedded surface viewport (the page-view rendering) is absent in
  // the canvas view.
  await expect(page.locator(`${ROOT} [data-slot="docblocks/canvas"]`)).toHaveCount(0);

  // Switch to the page view: the page flows, and the surface viewport is
  // absent (the surface is a canvas layer — its whole rendering stands in
  // the canvas view only), the page card is gone.
  await switchPaneView(page, "a", "page");
  await expect(card).toBeHidden();
  await expect(page.locator(`${ROOT} [data-slot="docblocks/canvas"]`)).toHaveCount(0);

  // Switch back: the canvas view returns (the toggle is view state — the
  // document data is untouched by the switch) and the layout is intact
  // (the card center is back at the canvas center).
  await switchPaneView(page, "a", "canvas");
  const cardBoxBack = (await card.boundingBox())!;
  expect(cardBoxBack, "the page card must be laid out after switching back").not.toBeNull();
  expect(Math.abs(cardBoxBack.y + cardBoxBack.height / 2 - (areaBox.y + areaBox.height / 2))).toBeLessThan(40);
  await expect(page.locator(`${ROOT} [data-slot="docblocks/canvas-item"]`)).toHaveCount(4);
});

// The sliding pill's boxes stand exactly over the given button (the
// measured geometry — the settled stand).
async function pillOverButton(
  page: import("@playwright/test").Page,
  pill: import("@playwright/test").Locator,
  button: import("@playwright/test").Locator
): Promise<void> {
  await expect
    .poll(
      async () => {
        const p = await pill.boundingBox();
        const t = await button.boundingBox();
        if (p === null || t === null) return Number.POSITIVE_INFINITY;
        return Math.abs(p.x - t.x) + Math.abs(p.y - t.y) + Math.abs(p.width - t.width);
      },
      { timeout: 15_000 }
    )
    .toBeLessThan(1);
}

test("the mode switcher's pill stands the back-out settle (the easing stand, the exact final stand over both modes, the rapid double switch's stable stand)", async ({
  page,
}) => {
  const room = `viewpill-${Math.random().toString(36).slice(2, 8)}`;
  await page.goto(`/?syncUrl=${RELAY}/${room}`);
  await expect(page.getByTestId("status-a")).toHaveText("connected");

  const headerView = page.locator('[data-slot="docblocks/doc-header-view"]');
  const pill = headerView.locator('[data-slot="docblocks/doc-header-view-pill"]');
  const pageButton = headerView.locator('[data-doc-header-view-button="page"]');
  const canvasButton = headerView.locator('[data-doc-header-view-button="canvas"]');
  await expect(pill).toBeVisible();

  // The easing stand: the pill's travel runs the back-out cubic-bezier (the
  // slight overshoot's settle — the framer-free house stand over the base
  // entry).
  expect(await pill.evaluate((el) => getComputedStyle(el).transitionTimingFunction)).toBe(
    "cubic-bezier(0.34, 1.56, 0.64, 1)"
  );

  // The initial stand (the default page mode): the pill stands exactly
  // over the page button (the measured geometry).
  await pillOverButton(page, pill, pageButton);

  // The switch to the canvas: the pill slides (the overshoot's animation)
  // and settles EXACTLY over the canvas button (the end stand — no
  // residual offset over the measured geometry).
  await canvasButton.click();
  await pillOverButton(page, pill, canvasButton);

  // The rapid double switch (the second click lands inside the first's
  // 200 ms transition): the pill settles over the last-picked button (the
  // state's stable stand — the CSS transition retargets from the current
  // position; it never drifts off the measured stand).
  await canvasButton.click();
  await page.waitForTimeout(60);
  await pageButton.click();
  await pillOverButton(page, pill, pageButton);
  await canvasButton.click();
  await pillOverButton(page, pill, canvasButton);
});

test("the view switch closes the page's transient surfaces (the slash menu, the mention picker, the format toolbar, the link editor)", async ({
  page,
}) => {
  const room = `view-popovers-${Math.random().toString(36).slice(2, 8)}`;
  await page.goto(`/?syncUrl=${RELAY}/${room}`);
  await expect(page.getByTestId("status-a")).toHaveText("connected");
  const headerView = page.locator(`[data-slot="docblocks/doc-header-view"]`);
  const toCanvas = () => headerView.getByRole("button", { name: "Canvas view" }).click();
  const toPage = () => headerView.getByRole("button", { name: "Page view" }).click();
  const inner = page.locator(`${ROOT} [data-slot="docblocks/block-content"]`).first();

  // The slash menu: a standing menu is a page affordance — the canvas view
  // drops it, and the page view does not resurrect the stale one.
  await inner.click();
  await page.keyboard.type("/div");
  const slashMenu = page.locator('[data-slot="docblocks/slash-menu"]');
  await expect(slashMenu).toHaveCount(1);
  await toCanvas();
  await expectStays(async () => {
    expect(await slashMenu.count()).toBe(0);
  });
  await toPage();
  await expectStays(async () => {
    expect(await slashMenu.count()).toBe(0);
  });

  // The mention picker: the same stand over the `@` phrase.
  await inner.click();
  await page.keyboard.press("End");
  await page.keyboard.type(" @Ad");
  const mentionMenu = page.locator('[data-slot="docblocks/mention-menu"]');
  await expect(mentionMenu).toHaveCount(1);
  await toCanvas();
  await expectStays(async () => {
    expect(await mentionMenu.count()).toBe(0);
  });
  await toPage();

  // The format toolbar (a text range's affordance): it renders over the
  // page view only.
  await inner.click();
  await page.keyboard.press("End");
  await page.keyboard.type("abc");
  await page.keyboard.press("Shift+ArrowLeft");
  await page.keyboard.press("Shift+ArrowLeft");
  const formatToolbar = page.locator('[data-slot="docblocks/format-toolbar"]');
  await expect(formatToolbar).toHaveCount(1);
  await toCanvas();
  await expectStays(async () => {
    expect(await formatToolbar.count()).toBe(0);
  });
  await toPage();

  // The link editor (mod+k over a fresh selection): closes with the view
  // too. The canvas round-trip dropped the page's selection, so the range
  // is re-seated first.
  await inner.click();
  await page.keyboard.press("End");
  await page.keyboard.type("xyz");
  await page.keyboard.press("Shift+ArrowLeft");
  await page.keyboard.press("Shift+ArrowLeft");
  await page.keyboard.press("Control+k");
  const linkPopover = page.locator('[data-slot="docblocks/link-popover"]');
  await expect(linkPopover).toHaveCount(1);
  await toCanvas();
  await expectStays(async () => {
    expect(await linkPopover.count()).toBe(0);
  });
  await toPage();
  await expectStays(async () => {
    expect(await linkPopover.count()).toBe(0);
  });
});
