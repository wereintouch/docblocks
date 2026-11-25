// The page's width stands over the page column: the centered max width's pins (the wide/narrow/
// the token's override + the `none`'s full-width's stands) + the doc area's page box's hug
// over the page column (the fixed width + the catalog mode's golden pin).
import { expect, test } from "@playwright/test";

import { RELAY } from "./helpers";

const ROOT = '[data-testid="doc-a"]';

test("the page's content column stands the centered max width (the narrow stand full width; the wide stand's block zone 900 px + the symmetric margins; the token's override stands on the blocks; the `none`'s override stands the full width; the gutter follows the content)", async ({
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

    // The FULL WIDTH stand (the consumer's `none` override over the token —
    // the column's max width stands unconstrained, the block zone spans the
    // whole available width): the column stands the editor root's full width
    // (no margins), and the block zone stands the column's box minus the two
    // gutter paddings.
    await a.evaluate(() => {
      document
        .querySelector<HTMLElement>('[data-slot="docblocks/editor"]')!
        .style.setProperty("--docblocks-page-max-width", "none");
    });
    const fullWidth = await boxes();
    expect(fullWidth.c.width).toBeCloseTo(fullWidth.r.width, 0);
    expect(Math.abs(fullWidth.c.x - fullWidth.r.x)).toBeLessThan(2);
    expect(fullWidth.content.width).toBeCloseTo(fullWidth.c.width - 2 * fullWidth.paddingLeft, 0);
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
