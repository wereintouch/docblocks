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

test("the page's content column stands the centered max width (the narrow stand full width; the wide stand's block zone 900 px + the symmetric margins; the token's override stands on the blocks; the gutter follows the content)", async ({
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
      content: { x: number; width: number };
      grip: { x: number };
      paddingLeft: number;
    }
    const boxes = async (): Promise<Boxes> => {
      const [r, c, content, grip, paddingLeft] = await Promise.all([
        root.boundingBox(),
        column.boundingBox(),
        a.locator(`${ROOT} [data-slot="docblocks/block-content"]`).first().boundingBox(),
        a.locator(`${ROOT} [data-slot="docblocks/gutter"]`).first().boundingBox(),
        column.evaluate((el) => parseFloat(getComputedStyle(el).paddingLeft)),
      ]);
      if (r === null || c === null || content === null || grip === null) {
        throw new Error("the box stands none");
      }
      return { r, c, content, grip, paddingLeft };
    };

    // The NARROW stand (the doc area pinned over the golden width 720 —
    // the harness's catalog pin — < the column's derived max width):
    // the limit stands no compression — the column stands the full width
    // (no margins, no over-constraint).
    await a.evaluate(() => {
      document.querySelector<HTMLElement>('[data-testid="doc-a"]')!.style.width = "720px";
    });
    const narrow = await boxes();
    expect(narrow.c.width).toBeCloseTo(narrow.r.width, 0);
    expect(Math.abs(narrow.c.x - narrow.r.x)).toBeLessThan(2);

    // The WIDE stand (the doc area's width over the column's derived max
    // width): the BLOCK ZONE stands 900 px (the token stands on the blocks'
    // content-box — the column's box is 900 + 2×padding, centered; the
    // symmetric margins; the gutter's grip stands at the column's edge,
    // the outer clearance past it — the grip's relative geometry over the
    // blocks stands: the column is wider by the two paddings, the grip
    // and the blocks stand as before).
    await a.evaluate(() => {
      document.querySelector<HTMLElement>('[data-testid="doc-a"]')!.style.width = "1100px";
    });
    const wide = await boxes();
    expect(wide.content.width).toBeCloseTo(900, 0);
    expect(wide.c.width - 2 * wide.paddingLeft).toBeCloseTo(900, 0);
    const leftMargin = wide.c.x - wide.r.x;
    const rightMargin = wide.r.x + wide.r.width - (wide.c.x + wide.c.width);
    expect(Math.abs(leftMargin - rightMargin)).toBeLessThan(2);
    expect(wide.grip.x - wide.c.x).toBeCloseTo(8, 0);

    // The consumer's token override stands (the 700 px stands on the
    // blocks' content — the column's box re-stands 700 + 2×padding; the
    // margins re-stand symmetric over the re-measured column).
    await a.evaluate(() => {
      document
        .querySelector<HTMLElement>('[data-slot="docblocks/editor"]')!
        .style.setProperty("--docblocks-page-max-width", "700px");
    });
    const overridden = await boxes();
    expect(overridden.content.width).toBeCloseTo(700, 0);
    expect(overridden.c.width - 2 * overridden.paddingLeft).toBeCloseTo(700, 0);
    expect(Math.abs(overridden.c.x - overridden.r.x)).toBeCloseTo(
      overridden.r.x + overridden.r.width - (overridden.c.x + overridden.c.width),
      0
    );
  } finally {
    await context.close();
  }
});

test("the playground's doc area's page box hugs the page column (the fixed 1080 px stand over the wide window; the catalog mode keeps the golden pin)", async ({
  browser,
}) => {
  const context = await browser.newContext({ viewport: { width: 1600, height: 900 } });
  const a = await context.newPage();
  try {
    // The DEFAULT mode (the everyday view): the doc area's page box stands
    // a fixed width over the wide window — the box hugs the page column
    // (the 1060 px's column — the 900 px's block zone + the two 80 px's
    // gutter paddings — + the editor card's 2x1 border + the box's 2x1
    // border + 2x8 padding = 1080 border-box): the blocks stand exactly
    // the token's width over the box, and the box stands centered over
    // the pane.
    const room = `docarea-${Math.random().toString(36).slice(2, 8)}`;
    await a.goto(`/?client=a&syncUrl=${RELAY}/${room}`);
    await expect(a.getByTestId("status-a")).toHaveText("connected");
    const docArea = a.locator('[data-testid="doc-a"]');
    const root = a.locator(`${ROOT} [data-slot="docblocks/editor"]`);
    const column = a.locator(`${ROOT} [data-slot="docblocks/page"]`);
    const content = a.locator(`${ROOT} [data-slot="docblocks/block-content"]`).first();
    const [areaBox, rootBox, colBox, contentBox, pad, parentBox] = await Promise.all([
      docArea.boundingBox(),
      root.boundingBox(),
      column.boundingBox(),
      content.boundingBox(),
      column.evaluate((el) => parseFloat(getComputedStyle(el).paddingLeft)),
      a.evaluate(() => {
        const p = document.querySelector<HTMLElement>("[data-testid=doc-a]")!.parentElement!.getBoundingClientRect();
        return { x: p.x, width: p.width };
      }),
    ]);
    if (areaBox === null || rootBox === null || colBox === null || contentBox === null) {
      throw new Error("the box stands none");
    }
    // The fixed box's stand (1080 border-box; the narrow window stands
    // the full width — the maxWidth's 100% stand).
    expect(areaBox.width).toBeCloseTo(1080, 0);
    // The box stands centered over the pane (the section's width over
    // the box's margins).
    expect(Math.abs(parentBox.x + parentBox.width / 2 - (areaBox.x + areaBox.width / 2))).toBeLessThan(2);
    // The editor root stands the box's content width (1060), the column
    // stands the editor's width (the box hugs the column), and the block
    // zone stands the token's 900 px.
    expect(rootBox.width).toBeCloseTo(1060, 0);
    expect(colBox.width).toBeCloseTo(1060, 0);
    expect(colBox.width - 2 * pad).toBeCloseTo(900, 0);
    expect(contentBox.width).toBeCloseTo(900, 0);

    // The CATALOG mode (?catalog=1): the harness keeps the visual-golden
    // editor width (the 720 px's border-box pin — the goldens' fixture);
    // the column stands the full width over it (the narrow stand).
    const room2 = `docarea-cat-${Math.random().toString(36).slice(2, 8)}`;
    await a.goto(`/?catalog=1&client=a&syncUrl=${RELAY}/${room2}`);
    await expect(a.getByTestId("status-a")).toHaveText("connected");
    const catArea = (await a.locator('[data-testid="doc-a"]').boundingBox())!;
    expect(catArea.width).toBeCloseTo(720, 0);
    // The outer editor / page column (the catalog doc's sync-embeds mount
    // nested editors — .first() picks the outermost stand).
    const catRoot = (await a.locator(`${ROOT} [data-slot="docblocks/editor"]`).first().boundingBox())!;
    const catColumn = (await a.locator(`${ROOT} [data-slot="docblocks/page"]`).first().boundingBox())!;
    expect(catColumn.width).toBeCloseTo(catRoot.width, 0);
  } finally {
    await context.close();
  }
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
