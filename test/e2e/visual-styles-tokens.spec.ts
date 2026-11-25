// The block zone's token reads — the callout / divider / table's zone-2,
// the image / embed / sync-embed's zone-3, and the canvas's zone-4 (the
// surfaces over the page view, the document canvas view + the page card).
import { type Locator, type Page, expect, test } from "@playwright/test";

import { RELAY, switchPaneView } from "./helpers";

// The catalog pane's settle stands the default 30s budget at its edge (the
// 15s SETTLE + the page loads): the raised budget keeps the timeout class
// out of the loaded machine's flake zone (a true stall stays visible).
test.setTimeout(45_000);

async function openCatalogPane(page: Page): Promise<void> {
  const room = `vreg01s-${Math.random().toString(36).slice(2, 8)}`;
  await page.goto(`/?client=a&catalog=1&syncUrl=${RELAY}/${room}`);
  await expect(page.getByTestId("status-a")).toHaveText("connected");
  // The harness loads dark by default; every pin in this spec is a light
  // value, so clear the `.dark` class explicitly.
  await page.evaluate(() => document.documentElement.classList.remove("dark"));
  // The catalog is built locally on mount; the divider lands with it.
  await expect(page.locator('[data-slot="docblocks/divider"]')).toHaveCount(1);
}

/** The pane's editor root. */

function editor(page: Page) {
  return page.locator('[data-slot="docblocks/editor"]');
}

/** The catalog's marks paragraph (the only one carrying the combined run). */

async function styleProps(locator: Locator, ...properties: string[]): Promise<Record<string, string>> {
  await expect(locator).toHaveCount(1);
  return locator.evaluate((el, names) => {
    const style = getComputedStyle(el);
    const result: Record<string, string> = {};
    for (const name of names) result[name] = style.getPropertyValue(name);
    return result;
  }, properties);
}

/** The DOM selection's caret rect (a collapsed caret: width ~0). */

test("the callout, divider and table read the zone-2 tokens", async ({ page }) => {
  await openCatalogPane(page);
  const doc = editor(page).first();

  // The default callout: the border-left width/style, the padding and the
  // radius tokens (the info color follows the standard --primary input and
  // is not pinned — it is seed-dependent). The left padding stands the
  // icon's gutter (the padding-x + the icon zone); the other sides stand the
  // padding tokens.
  const callout = doc.locator('[data-block-type="callout"]:not([data-variant])').first();
  await expect(callout).toHaveCount(1);
  const calloutStyle = await styleProps(callout, "border-left-width", "border-left-style", "padding", "border-radius");
  expect(calloutStyle).toEqual({
    "border-left-width": "4px",
    "border-left-style": "solid",
    padding: "8px 12px 8px 38px",
    "border-radius": "10px",
  });
  // The warning variant switches the border color to the package literal.
  const warning = doc.locator('[data-block-type="callout"][data-variant="warning"]');
  await expect(warning).toHaveCount(1);
  expect((await styleProps(warning, "border-left-color"))["border-left-color"]).toBe("rgb(154, 103, 0)");

  // The divider: the box's height (the margin token's two stands + the
  // line — the line stands centered over the box, the hover zone's stand;
  // the margin stands 0, so the spacing never collapses out of the box)
  // + the line's border width/style (the inner hr).
  const divider = doc.locator('[data-slot="docblocks/divider"]');
  const dividerStyle = await styleProps(divider, "height", "margin-top");
  expect(dividerStyle).toEqual({ height: "41px", "margin-top": "0px" });
  const dividerLine = divider.locator("hr");
  const lineStyle = await styleProps(dividerLine, "border-top-width", "border-top-style");
  expect(lineStyle).toEqual({ "border-top-width": "1px", "border-top-style": "solid" });

  // The table: the collapsed borders + the cell width/padding tokens;
  // the fixed layout pins the explicit-layout contract.
  const table = doc.locator('table[data-slot="docblocks/table"]');
  await expect(table).toHaveCount(1);
  const tableStyle = await styleProps(table, "border-collapse", "table-layout");
  expect(tableStyle).toEqual({ "border-collapse": "collapse", "table-layout": "fixed" });
  const cellStyle = await styleProps(table.locator("td").first(), "border-top-width", "padding");
  expect(cellStyle).toEqual({ "border-top-width": "1px", padding: "4px 8px" });

  // The page-frame block's wrapper (the inline window's row): the block's
  // vertical spacing reads the block-spacing token (the page rows' parity —
  // the window's own box centers over the row, the wrapper's horizontal
  // margin stands 0).
  const pageFrame = doc.locator('[data-slot="docblocks/frame-page"]');
  await expect(pageFrame).toHaveCount(1);
  const pageFrameStyle = await styleProps(pageFrame, "margin-top", "margin-bottom", "margin-right");
  expect(pageFrameStyle).toEqual({ "margin-top": "8px", "margin-bottom": "8px", "margin-right": "0px" });
});

test("the image, embed and sync-embed read the zone-3 tokens", async ({ page }) => {
  await openCatalogPane(page);
  const doc = editor(page).first();

  // The embed: the wrapper box carries the height token (the iframe fills
  // it) + the divider border.
  const embed = doc.locator('[data-block-type="embed"]');
  await expect(embed).toHaveCount(1);
  const embedStyle = await styleProps(embed, "height", "border-style", "overflow");
  expect(embedStyle).toEqual({ height: "300px", "border-style": "solid", overflow: "hidden" });

  // The image: a block-level element capped at the box width.
  const img = doc.locator('img[data-slot="docblocks/image"]');
  await expect(img).toHaveCount(1);
  const imgStyle = await styleProps(img, "display", "max-width");
  expect(imgStyle).toEqual({ display: "block", "max-width": "100%" });

  // The sync-embed: the wrapper frame's border + the scrolling body cap.
  const syncEmbed = doc.locator('[data-block-type="sync-embed"]');
  await expect(syncEmbed).toHaveCount(1);
  expect((await styleProps(syncEmbed, "border-width"))["border-width"]).toBe("1px");
  const bodyStyle = await styleProps(
    syncEmbed.locator('[data-slot="docblocks/sync-embed-body"]'),
    "max-height",
    "overflow-y"
  );
  expect(bodyStyle).toEqual({ "max-height": "200px", "overflow-y": "auto" });

  // The mermaid preview (the ./mermaid subpath): the catalog's mermaid
  // block stands in its default code mode — switch it to preview (the mode
  // attr) so the diagram stands, and read the spacing below the code body
  // once the async render settles.
  await page.evaluate(() => window.__catalogDoc?.updateBlock("c0032", { mermaidMode: "preview" }));
  const mermaid = doc.locator('[data-slot="docblocks/mermaid"]');
  await expect(mermaid.locator("svg")).toHaveCount(1);
  // The block's spacing stands on the preview's viewport wrapper (the
  // diagram's own slot sits inside it).
  const viewport = doc.locator('[data-slot="docblocks/mermaid-viewport"]');
  await expect(viewport).toHaveCount(1);
  expect((await styleProps(viewport, "margin-top"))["margin-top"]).toBe("8px");
});

test("the canvas surfaces read the zone-4 tokens", async ({ page }) => {
  await openCatalogPane(page);
  const doc = editor(page).first();

  // The page view carries no canvas layer (the surface is filtered out of
  // the page sequence — the whole surface renders in the canvas view only).
  // The page-frame block's window stands its own slots there: the
  // `docblocks/frame` slot is the canvas frame's renderer, and the window's
  // inert copies stand one — the referenced frame A stands out of its own
  // window (the frame-chain's stand), so the only copy is frame B's.
  await expect(doc.locator('[data-slot="docblocks/canvas"]')).toHaveCount(0);
  await expect(doc.locator('[data-slot="docblocks/frame"]')).toHaveCount(1);
  await expect(doc.locator('[data-slot="docblocks/frame-page-window"]')).toHaveCount(1);

  // The canvas view: the two seeded frames (the region boundaries — the
  // transparent box, no content copy) + the page miniature's page-frame
  // window's copy (the frame block's mirror over the canvas's content).
  // The boundary's box reads the canvas's tokens: the container's thin
  // rounded ring (the inset shadow over the group-border token) and the
  // radius token — the boundary is transparent (no content copy, no canvas
  // background).
  await switchPaneView(page, "a", "canvas");
  const frame = doc.locator('[data-slot="docblocks/frame"]');
  await expect(frame).toHaveCount(3);
  const boundary = doc.locator('[data-slot="docblocks/frame-boundary"]').first();
  const boundaryStyle = await styleProps(boundary, "box-shadow", "border-radius");
  // The token's own value over a probe element INSIDE the editor root
  // (the --docblocks-* tokens are scoped to the editor's root, not :root —
  // the body's probe resolves them as unset) — the resolved stand over the
  // box's own read: the ring the group-border token as the inset shadow's
  // color.
  const tokenProbe = (styleName: string, value: string) =>
    editor(page)
      .first()
      .evaluate(
        (el, names) => {
          const prop = names[0] ?? "";
          const value = names[1] ?? "";
          const probe = document.createElement("div");
          (probe.style as unknown as Record<string, string>)[prop] = value;
          el.appendChild(probe);
          const resolved = getComputedStyle(probe).getPropertyValue(prop);
          probe.remove();
          return resolved ?? "";
        },
        [styleName, value]
      );
  expect(boundaryStyle["box-shadow"]).toBe(
    await tokenProbe("box-shadow", "inset 0 0 0 1px var(--docblocks-canvas-group-border-color)")
  );
  expect(boundaryStyle["border-radius"]).toBe(await tokenProbe("border-radius", "var(--docblocks-radius)"));
});

test("the document canvas view and the page card read the zone-4 tokens", async ({ page }) => {
  const room = `vreg04s-${Math.random().toString(36).slice(2, 8)}`;
  await page.goto(`/?client=a&canvas=1&syncUrl=${RELAY}/${room}`);
  await expect(page.getByTestId("status-a")).toHaveText("connected");

  // The canvas view: the dotted grid (the image and the size read the
  // tokens; the height is the 100% token resolved against the container,
  // so only the non-zero layout is pinned — the box checks live in
  // view.spec).
  const view = page.locator('[data-slot="docblocks/canvas-view"]');
  await expect(view).toHaveCount(1);
  // The fit's entry stand: the canvas demo
  // seeds surface content, so the entry's fit stands a zoom over 100% —
  // reset the zoom to the 100% stand (the grid's token's resolution) before
  // the pin.
  await view.getByRole("toolbar", { name: "Canvas zoom" }).getByLabel("Reset zoom").click();
  const grid = await view.evaluate((el) => {
    const s = getComputedStyle(el);
    return { size: s.backgroundSize, dotted: s.backgroundImage.includes("radial-gradient"), height: s.height };
  });
  expect(grid.size).toBe("24px 24px");
  expect(grid.dotted).toBe(true);
  expect(grid.height).not.toBe("0px");

  // The dot's alpha (the a bit more transparent stand): the token's resolved alpha stands ~20–25% (the first 35%
  // stand's target below). The canvas 2D round-trip resolves the color-mix
  // to an sRGB alpha regardless of the theme's color space.
  const dot = await view.evaluate(() => {
    const el = document.querySelector('[data-slot="docblocks/canvas-view"]');
    if (el === null) return { alpha: null };
    const token = getComputedStyle(el).getPropertyValue("--docblocks-canvas-view-dot").trim();
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 1;
    const ctx = canvas.getContext("2d");
    if (ctx === null) return { alpha: null, token };
    ctx.clearRect(0, 0, 1, 1);
    ctx.fillStyle = token;
    ctx.fillRect(0, 0, 1, 1);
    const data = ctx.getImageData(0, 0, 1, 1).data;
    return { alpha: (data[3] ?? 0) / 255, token };
  });
  expect(dot.alpha).not.toBeNull();
  // A bit more transparent than the first 35% stand (in the ~20–25% band,
  // the rounding tolerance).
  expect(dot.alpha as number).toBeGreaterThanOrEqual(0.19);
  expect(dot.alpha as number).toBeLessThanOrEqual(0.26);
  expect(dot.alpha as number).toBeLessThan(0.35);

  // The page miniature: the padding, the radius and the shadow tokens.
  const card = page.locator('[data-slot="docblocks/page-card"]');
  await expect(card).toHaveCount(1);
  const cardStyle = await styleProps(card, "padding", "border-radius", "box-shadow");
  expect(cardStyle["padding"]).toBe("32px 40px");
  expect(cardStyle["border-radius"]).toBe("10px");
  expect(cardStyle["box-shadow"]).toContain("rgba(0, 0, 0, 0.12)");
});
