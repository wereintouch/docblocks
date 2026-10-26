import { expect, test } from "@playwright/test";

import { switchPaneView } from "./helpers";

// Each test gets its own room via ?syncUrl= — the relay keeps rooms for
// the dev server's lifetime, so a shared room would be polluted by other
// spec files (and by manually opened tabs).
const RELAY = "ws://localhost:5199";

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

  // Switch to the page view: the page flows, the surface renders as the
  // embedded viewport, and the page card is gone.
  await switchPaneView(page, "a", "page");
  await expect(card).toBeHidden();
  await expect(page.locator(`${ROOT} [data-slot="docblocks/canvas"]`)).toBeVisible();

  // Switch back: the canvas view returns (the toggle is view state — the
  // document data is untouched by the switch) and the layout is intact
  // (the card center is back at the canvas center).
  await switchPaneView(page, "a", "canvas");
  const cardBoxBack = (await card.boundingBox())!;
  expect(cardBoxBack, "the page card must be laid out after switching back").not.toBeNull();
  expect(Math.abs(cardBoxBack.y + cardBoxBack.height / 2 - (areaBox.y + areaBox.height / 2))).toBeLessThan(40);
  await expect(page.locator(`${ROOT} [data-slot="docblocks/canvas-item"]`)).toHaveCount(4);
});

test("the page's content column stands the centered max width (the narrow stand full width; the wide stand's 900 px + the symmetric margins; the token's override; the gutter follows the content)", async ({
  browser,
}) => {
  const context = await browser.newContext({ viewport: { width: 1600, height: 900 } });
  const a = await context.newPage();
  try {
    const room = `pagewidth-${Math.random().toString(36).slice(2, 8)}`;
    await a.goto(`/?client=a&syncUrl=${RELAY}/${room}`);
    await expect(a.getByTestId("status-a")).toHaveText("connected");
    const root = a.locator(`${ROOT} [data-slot="docblocks/editor"]`);
    const column = a.locator(`${ROOT} [data-slot="docblocks/page"]`);
    await expect(column).toBeVisible();
    interface Boxes {
      r: { x: number; width: number };
      c: { x: number; width: number };
      grip: { x: number };
    }
    const boxes = async (): Promise<Boxes> => {
      const [r, c, grip] = await Promise.all([
        root.boundingBox(),
        column.boundingBox(),
        a.locator(`${ROOT} [data-slot="docblocks/gutter"]`).first().boundingBox(),
      ]);
      if (r === null || c === null || grip === null) throw new Error("the box stands none");
      return { r, c, grip };
    };

    // The NARROW stand (the harness's golden width 720 < the 900 px
    // token): the limit stands no compression — the column stands the
    // full width (no margins, no over-constraint).
    const narrow = await boxes();
    expect(narrow.c.width).toBeCloseTo(narrow.r.width, 0);
    expect(Math.abs(narrow.c.x - narrow.r.x)).toBeLessThan(2);

    // The WIDE stand (the doc area's width over the token): the column
    // stands 900 px, centered (the symmetric margins), and the gutter's
    // grip stands at the content's edge (the outer clearance over the
    // column's edge — the grip follows the content, not the viewport's
    // edge).
    await a.evaluate(() => {
      document.querySelector<HTMLElement>('[data-testid="doc-a"]')!.style.width = "1100px";
    });
    const wide = await boxes();
    expect(wide.c.width).toBeCloseTo(900, 0);
    const leftMargin = wide.c.x - wide.r.x;
    const rightMargin = wide.r.x + wide.r.width - (wide.c.x + wide.c.width);
    expect(Math.abs(leftMargin - rightMargin)).toBeLessThan(2);
    expect(wide.grip.x - wide.c.x).toBeCloseTo(8, 0);

    // The consumer's token override stands (the 700 px's column; the
    // margins re-stand symmetric over the re-measured column).
    await a.evaluate(() => {
      document
        .querySelector<HTMLElement>('[data-slot="docblocks/editor"]')!
        .style.setProperty("--docblocks-page-max-width", "700px");
    });
    const overridden = await boxes();
    expect(overridden.c.width).toBeCloseTo(700, 0);
    expect(Math.abs(overridden.c.x - overridden.r.x)).toBeCloseTo(
      overridden.r.x + overridden.r.width - (overridden.c.x + overridden.c.width),
      0
    );
  } finally {
    await context.close();
  }
});
