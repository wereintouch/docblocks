import { type Locator, type Page, expect, test } from "@playwright/test";

// The catalog pane: ?catalog=1 makes the pane build the deterministic v1
// catalog document (apps/playground/src/catalog.ts) instead of the empty
// seed. A unique room per test: the relay keeps rooms for the dev server's
// lifetime, so a shared room would be polluted by other specs.
const RELAY = "ws://localhost:5199";
const SETTLE = { timeout: 15_000 };

async function openCatalogPane(page: Page): Promise<void> {
  const room = `vreg01s-${Math.random().toString(36).slice(2, 8)}`;
  await page.goto(`/?client=a&catalog=1&syncUrl=${RELAY}/${room}`);
  await expect(page.getByTestId("status-a")).toHaveText("connected");
  // The harness loads dark by default; every pin in this spec is a light
  // value, so clear the `.dark` class explicitly.
  await page.evaluate(() => document.documentElement.classList.remove("dark"));
  // The catalog is built locally on mount; the divider lands with it.
  await expect(page.locator('hr[data-slot="docblocks/divider"]')).toHaveCount(1);
}

/** The pane's editor root. */
function editor(page: Page) {
  return page.locator('[data-slot="docblocks/editor"]');
}

/** The catalog's marks paragraph (the only one carrying the combined run). */
function marksParagraph(page: Page) {
  return editor(page).locator('[data-block-type="paragraph"]', { hasText: "bold italic" });
}

/**
 * The computed values of the given properties on the locator's (unique)
 * element. Read per property: a serialized CSSStyleDeclaration is an empty
 * object (its properties are prototype getters, not own properties).
 */
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
interface CaretRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

async function caretRect(page: Page): Promise<CaretRect | null> {
  return page.evaluate(() => {
    const selection = window.getSelection();
    if (selection === null || selection.rangeCount === 0) return null;
    const rect = selection.getRangeAt(0).getBoundingClientRect();
    return { x: rect.left, y: rect.top, width: rect.width, height: rect.height };
  });
}

test("every v1 mark renders with its expected style", async ({ page }) => {
  await openCatalogPane(page);
  const marks = marksParagraph(page);

  // bold / italic: structural <strong>/<em> elements (two each: the plain
  // run and the combined bold+italic run); the UA weight/style apply.
  await expect(marks.locator("strong")).toHaveCount(2);
  expect((await styleProps(marks.locator("strong").first(), "font-weight"))["font-weight"]).toBe("700");
  await expect(marks.locator("em")).toHaveCount(2);
  expect((await styleProps(marks.locator("em").first(), "font-style"))["font-style"]).toBe("italic");

  expect((await styleProps(marks.locator("s"), "text-decoration-line"))["text-decoration-line"]).toContain(
    "line-through"
  );
  expect((await styleProps(marks.locator("u"), "text-decoration-line"))["text-decoration-line"]).toContain("underline");

  // link: the anchor's href plus the link token color.
  const link = marks.locator("a");
  expect(await link.getAttribute("href")).toBe("https://example.com");
  expect((await styleProps(link, "color"))["color"]).toBe("rgb(9, 105, 218)");

  // color / highlight: inline styles on the run's span (user data, not theme).
  expect((await styleProps(marks.locator("span", { hasText: "color" }), "color"))["color"]).toBe("rgb(207, 34, 46)");
  expect(
    (await styleProps(marks.locator("span", { hasText: "highlight" }), "background-color"))["background-color"]
  ).toBe("rgb(255, 221, 0)");

  // code (exclusive): a lone <code>; the mono family is the UA default for
  // the element (the package stylesheet styles only its background).
  expect((await styleProps(marks.locator('code:not([data-mark="math"])'), "font-family"))["font-family"]).toContain(
    "mono"
  );

  // math (exclusive): the tex source is the visible text.
  const math = marks.locator('code[data-mark="math"]');
  expect(await math.textContent()).toBe("x^2");
});

test("the catalog covers every v1 block structure", async ({ page }) => {
  await openCatalogPane(page);
  const doc = editor(page);

  // Every data-block-type value the catalog carries (table-row / table-cell
  // render as structural <tr>/<td>, not data-block-type elements). The
  // catalog's sync-embed resolves its master (fixed docId, deterministic
  // seed), so the master's blocks (one h1 + three paragraphs) count too,
  // and so does the canvas scene (a frame paragraph + a frame heading).
  // The motion view renders the flat page sequence: the nesting is the row
  // step (no nested slot), and the list markers stand as rendered row
  // labels (no list element).
  expect(await doc.locator('[data-block-type="paragraph"]').count()).toBe(13);
  expect(await doc.locator('[data-block-type="quote"]').count()).toBe(2);
  expect(await doc.locator('[data-block-type="heading"]').count()).toBe(8);
  expect(await doc.locator('[data-block-type="list-item"]').count()).toBe(17);
  expect(await doc.locator('[data-block-type="callout"]').count()).toBe(4);
  expect(await doc.locator('[data-block-type="code"]').count()).toBe(2);
  expect(await doc.locator('[data-block-type="code"][data-language="mermaid"]').count()).toBe(1);
  // The mermaid block stands in its default code mode (the exclusive
  // modes): the editable code with the line numbers stands, the diagram
  // is not rendered (the preview render is pinned by the mermaid spec).
  expect(await doc.locator('[data-slot="docblocks/mermaid"]').count()).toBe(0);
  expect(
    await doc
      .locator('[data-block-type="code"][data-language="mermaid"] [data-slot="docblocks/code-line-numbers"]')
      .count()
  ).toBe(1);
  expect(await doc.locator('[data-block-type="latex"]').count()).toBe(1);
  expect(await doc.locator('[data-block-type="table"]').count()).toBe(1);
  expect(await doc.locator('[data-block-type="image"]').count()).toBe(1);
  expect(await doc.locator('[data-block-type="embed"]').count()).toBe(1);
  expect(await doc.locator('[data-block-type="divider"]').count()).toBe(1);

  // Headings 1..6 as their own tags; the master's h1 adds a second h1, the
  // canvas frame's heading a second h2.
  expect(await doc.locator('h1[data-block-type="heading"]').count()).toBe(2);
  expect(await doc.locator('h2[data-block-type="heading"]').count()).toBe(2);
  for (const tag of ["h3", "h4", "h5", "h6"]) {
    expect(await doc.locator(`${tag}[data-block-type="heading"]`).count()).toBe(1);
  }

  // Lists: the flat rows stand without a list element; the markers are
  // rendered row labels (the bullet/number kinds; the task items carry the
  // checkbox instead), and the checked task via data-checked.
  expect(await doc.locator('[data-slot="docblocks/list"]').count()).toBe(0);
  expect(await doc.locator('[data-slot="docblocks/row-marker"]').count()).toBe(12);
  expect(await doc.locator('[data-slot="docblocks/row-marker"][data-kind="bullet"]').count()).toBe(6);
  expect(await doc.locator('[data-slot="docblocks/row-marker"][data-kind="number"]').count()).toBe(6);
  expect(await doc.locator('[data-slot="docblocks/checkbox"]').count()).toBe(5);
  expect(await doc.locator('li[data-checked="true"]').count()).toBe(1);

  // The numbered run's labels (DOM order): the numbering continues across
  // the sublist (1. [sub] 2.) and the marker style cycles by the indent
  // (decimal / lower-alpha / lower-roman, wrapping to decimal at indent 3).
  expect(
    await doc
      .locator('[data-slot="docblocks/row-marker"][data-kind="number"]')
      .evaluateAll((els) => els.map((el) => el.textContent))
  ).toEqual(["1.", "a.", "2.", "a.", "i.", "1."]);

  // Callout variants: the explicit ones carry data-variant, the default does not.
  expect(await doc.locator('[data-block-type="callout"][data-variant="info"]').count()).toBe(1);
  expect(await doc.locator('[data-block-type="callout"][data-variant="warning"]').count()).toBe(1);
  expect(await doc.locator('[data-block-type="callout"][data-variant="danger"]').count()).toBe(1);
  expect(await doc.locator('[data-block-type="callout"]:not([data-variant])').count()).toBe(1);

  // Table 2x2, the cell text via its child paragraph.
  expect(await doc.locator("tr").count()).toBe(2);
  expect(await doc.locator('td[data-slot="docblocks/table-cell"]').count()).toBe(4);
  await expect(doc.locator("td").first()).toHaveText("cell 1-1");

  // Code blocks: the language attrs (the ts block is the mono pin below —
  // the preflight makes pre mono on its own, so the pin reads the inner
  // content element the class lands on; the mermaid block stands in its
  // default code mode, pinned above).
  const pre = doc.locator('pre[data-block-type="code"][data-language="ts"]');
  expect(await pre.getAttribute("data-language")).toBe("ts");
  expect(
    (await styleProps(pre.locator('[data-slot="docblocks/block-content"]'), "font-family"))["font-family"]
  ).toContain("mono");

  // Image: the fixed key resolved by the harness's blob map.
  const img = doc.locator('img[data-slot="docblocks/image"]');
  expect(await img.count()).toBe(1);
  expect((await img.getAttribute("src")) ?? "").toContain("data:image/svg+xml");

  // Embed: the fixed data: URL src and the kind on the wrapper.
  const embed = doc.locator('iframe[data-slot="docblocks/embed"]');
  expect(await embed.count()).toBe(1);
  expect((await embed.getAttribute("src")) ?? "").toContain("data:text/html");
  expect(await doc.locator('[data-block-type="embed"][data-kind="iframe"]').count()).toBe(1);

  // Sync-embed: the resolved master content renders inside the wrapper
  // (the outer JSON carries the ref only, pinned by the JSON golden).
  const syncEmbed = doc.locator('[data-block-type="sync-embed"]');
  expect(await syncEmbed.count()).toBe(1);
  expect(await syncEmbed.locator('[data-slot="docblocks/sync-embed-body"]').count()).toBe(1);
  expect((await syncEmbed.getAttribute("data-doc-id")) ?? "").toBe("master-catalog");
  expect(await syncEmbed.locator('h1[data-block-type="heading"]').count()).toBe(1);
  expect(await syncEmbed.locator('[data-block-type="paragraph"]').count()).toBe(3);

  // Canvas (v2): the seeded demo scene — the surface viewport, the four
  // shape SVGs, the frame box, the canvas-text, the connector line.
  expect(await doc.locator('[data-block-type="surface"]').count()).toBe(1);
  await expect(doc.locator('[data-slot="docblocks/shape"]')).toHaveCount(4);
  expect(await doc.locator('[data-slot="docblocks/frame"]').count()).toBe(1);
  expect(await doc.locator('[data-block-type="canvas-text"]').count()).toBe(1);
  await expect(doc.locator('[data-slot="docblocks/connector-layer"] line')).toHaveCount(1);

  // Divider.
  expect(await doc.locator('hr[data-slot="docblocks/divider"]').count()).toBe(1);

  // Nested under text: the flat model renders the indented segment as the
  // sequence's own rows (the per-level row step — no nested slot): the
  // indented paragraph steps one level (24px), the indented list item the
  // step plus its marker zone (the row's first character, 24px + 24px).
  const rowPaddingOf = (id: string) =>
    doc
      .locator(`[data-block-id="${id}"]`)
      .first()
      .evaluate((el) => getComputedStyle(el.parentElement!).paddingLeft);
  expect(await rowPaddingOf("c0064")).toBe("24px");
  expect(await rowPaddingOf("c0065")).toBe("48px");
  expect(await doc.locator('[data-slot="docblocks/nested"]').count()).toBe(0);
});

test("a live edit after the catalog reaches the render and the JSON", async ({ page }) => {
  await openCatalogPane(page);
  // The pane's current block is the last paragraph in the flat sequence
  // (the catalog's indented paragraph, after the trailing one): the
  // data-current label keeps working.
  const current = page.locator('[data-testid="doc-a"] [data-current="true"]');
  await expect(current).toHaveCount(1);
  await expect(current).toHaveAttribute("data-block-type", "paragraph");

  await current.locator('[data-slot="docblocks/block-content"]').first().click();
  await page.keyboard.type(" live");

  // The real editor commits the input into the doc; both the render and the
  // live JSON view show it (the snapshot is not a frozen render).
  await expect(current).toHaveText(/live/);
  await expect.poll(async () => (await page.getByTestId("json-a").innerText()).includes("live"), SETTLE).toBe(true);
});

test("the caret at known offsets is a real caret inside the block", async ({ page }) => {
  await openCatalogPane(page);
  // The catalog's first paragraph (the table's cell paragraphs come later).
  const block = editor(page).locator('[data-block-type="paragraph"]').first();
  const inner = block.locator('[data-slot="docblocks/block-content"]').first();
  await inner.click();
  await page.keyboard.press("Home");
  const atStart = await caretRect(page);
  // The line end via arrows, not End: on a tall page Chromium scrolls the
  // page on the first End instead of moving the caret to the line end.
  const length = (await inner.textContent())?.length ?? 0;
  for (let i = 0; i < length; i++) await page.keyboard.press("ArrowRight");
  const atEnd = await caretRect(page);
  if (atStart === null || atEnd === null) throw new Error("the caret rect is missing");

  // Inside the block's bounding rect with a 2px tolerance.
  const box = await block.boundingBox();
  if (box === null) throw new Error("the block has no bounding box");
  expect(atStart.x).toBeGreaterThanOrEqual(box.x - 2);
  expect(atStart.y).toBeGreaterThanOrEqual(box.y - 2);
  expect(atStart.x + atStart.width).toBeLessThanOrEqual(box.x + box.width + 2);
  expect(atStart.y + atStart.height).toBeLessThanOrEqual(box.y + box.height + 2);

  // A real line-height caret: positive and under 3x the line box.
  const line = await inner.boundingBox();
  if (line === null) throw new Error("the line box is missing");
  expect(atStart.height).toBeGreaterThan(0);
  expect(atStart.height).toBeLessThan(3 * line.height);

  // Offset 0 (Home) is strictly left of the line's end (the text is non-empty).
  expect(atStart.x).toBeLessThan(atEnd.x);
});

// The marker cycle (the pane renders the motion view, whose flat rows carry
// a rendered row label per list item): a 3-level chain per kind gives
// disc → circle → square and decimal → lower-alpha → lower-roman in the real
// browser (computed style — jsdom cannot compute list-style). The cycle is
// the block's indent (the flat model: indent % 3). A unique room: the relay
// keeps rooms for the dev server's lifetime, so a shared room would be
// polluted.
test("the list markers cycle per indent level", async ({ page }) => {
  const room = `vreg01l-${Math.random().toString(36).slice(2, 8)}`;
  await page.goto(`/?client=a&syncUrl=${RELAY}/${room}`);
  await expect(page.getByTestId("status-a")).toHaveText("connected");

  // A 3-level chain per kind, seeded through the pane's own doc commands
  // (the established harness pattern): the indents 0/1/2 of the flat model.
  const seeded = await page.evaluate(() => {
    const d = window.__paneDocs?.a ?? null;
    if (d === null) return false;
    for (const list of ["bullet", "number"] as const) {
      for (let level = 0; level < 3; level++) {
        d.insertBlock("list-item", { list, ...(level > 0 ? { indent: level } : {}) });
      }
    }
    return true;
  });
  expect(seeded, "the pane's doc should be mounted").toBe(true);

  // Settle: the motion view animates the root rows in.
  await expect
    .poll(async () => page.locator('[data-testid="doc-a"] [data-slot="docblocks/row"]').count(), SETTLE)
    .toBe(7);

  /** The row markers of the kind in DOM order: the cycle + the rendered glyph / label. */
  const markers = (kind: "bullet" | "number") =>
    page.$$eval(`[data-testid="doc-a"] [data-slot="docblocks/row-marker"][data-kind="${kind}"]`, (els) =>
      els.map((el) => ({
        cycle: el.getAttribute("data-cycle"),
        glyph: getComputedStyle(el, "::before").content,
        label: el.textContent,
      }))
    );

  // Bullet: the ::before glyph cycles disc / circle / square per indent.
  expect(await markers("bullet")).toEqual([
    { cycle: "1", glyph: '"\u2022"', label: "" },
    { cycle: "2", glyph: '"\u25E6"', label: "" },
    { cycle: "3", glyph: '"\u25AA"', label: "" },
  ]);
  // Number: the run-position label cycles decimal / lower-alpha / lower-roman.
  expect(await markers("number")).toEqual([
    { cycle: "1", glyph: "none", label: "1." },
    { cycle: "2", glyph: "none", label: "a." },
    { cycle: "3", glyph: "none", label: "i." },
  ]);
});

test("the callout, divider and table read the zone-2 tokens", async ({ page }) => {
  await openCatalogPane(page);
  const doc = editor(page).first();

  // The default callout: the border-left width/style, the padding and the
  // radius tokens (the info color follows the standard --primary input and
  // is not pinned — it is seed-dependent).
  const callout = doc.locator('[data-block-type="callout"]:not([data-variant])').first();
  await expect(callout).toHaveCount(1);
  const calloutStyle = await styleProps(callout, "border-left-width", "border-left-style", "padding", "border-radius");
  expect(calloutStyle).toEqual({
    "border-left-width": "4px",
    "border-left-style": "solid",
    padding: "8px 12px",
    "border-radius": "10px",
  });
  // The warning variant switches the border color to the package literal.
  const warning = doc.locator('[data-block-type="callout"][data-variant="warning"]');
  await expect(warning).toHaveCount(1);
  expect((await styleProps(warning, "border-left-color"))["border-left-color"]).toBe("rgb(154, 103, 0)");

  // The divider: the margin token (the two-value shorthand — margin-top
  // pins the token, margin-right the second value; the bottom margin is
  // not pinned: the computed value of a collapsing margin is the used
  // value after collapse) + the top border width/style.
  const divider = doc.locator('hr[data-slot="docblocks/divider"]');
  const dividerStyle = await styleProps(divider, "margin-top", "margin-right", "border-top-width", "border-top-style");
  expect(dividerStyle).toEqual({
    "margin-top": "16px",
    "margin-right": "0px",
    "border-top-width": "1px",
    "border-top-style": "solid",
  });

  // The table: the collapsed borders + the cell width/padding tokens.
  // The table's vertical margins collapse with the neighbors' — the
  // non-collapsing margin-right pins the margin token instead.
  const table = doc.locator('table[data-slot="docblocks/table"]');
  await expect(table).toHaveCount(1);
  const tableStyle = await styleProps(table, "border-collapse", "margin-top", "margin-right");
  expect(tableStyle).toEqual({ "border-collapse": "collapse", "margin-top": "8px", "margin-right": "0px" });
  const cellStyle = await styleProps(table.locator("td").first(), "border-top-width", "padding");
  expect(cellStyle).toEqual({ "border-top-width": "1px", padding: "4px 8px" });
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
  await page.evaluate(() => window.__catalogDoc?.updateBlock("c0031", { mermaidMode: "preview" }));
  const mermaid = doc.locator('[data-slot="docblocks/mermaid"]');
  await expect(mermaid.locator("svg")).toHaveCount(1);
  expect((await styleProps(mermaid, "margin-top"))["margin-top"]).toBe("8px");
});

test("the canvas surfaces read the zone-4 tokens", async ({ page }) => {
  await openCatalogPane(page);
  const doc = editor(page).first();

  // The surface viewport (the page-view rendering): the height, the table
  // border and the clipping tokens.
  const viewport = doc.locator('[data-slot="docblocks/canvas"]');
  await expect(viewport).toHaveCount(1);
  const viewportStyle = await styleProps(viewport, "height", "border-top-width", "border-top-style", "overflow");
  expect(viewportStyle).toEqual({
    height: "500px",
    "border-top-width": "1px",
    "border-top-style": "solid",
    overflow: "hidden",
  });
  // The viewport background reads the canvas background token (a
  // color-mix of the standard --muted input — not pinned to a value,
  // only to the non-transparent).
  const viewportBackground = await viewport.evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(viewportBackground).not.toBe("rgba(0, 0, 0, 0)");

  // The frame: the table border, the radius, and no clipping (the frame
  // does not clip in v1 — no overflow class, the visible default).
  const frame = doc.locator('[data-slot="docblocks/frame"]');
  await expect(frame).toHaveCount(1);
  const frameStyle = await styleProps(frame, "border-top-width", "border-top-style", "overflow");
  expect(frameStyle).toEqual({
    "border-top-width": "1px",
    "border-top-style": "solid",
    overflow: "visible",
  });
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
  const grid = await view.evaluate((el) => {
    const s = getComputedStyle(el);
    return { size: s.backgroundSize, dotted: s.backgroundImage.includes("radial-gradient"), height: s.height };
  });
  expect(grid.size).toBe("24px 24px");
  expect(grid.dotted).toBe(true);
  expect(grid.height).not.toBe("0px");

  // The page miniature: the padding, the radius and the shadow tokens.
  const card = page.locator('[data-slot="docblocks/page-card"]');
  await expect(card).toHaveCount(1);
  const cardStyle = await styleProps(card, "padding", "border-radius", "box-shadow");
  expect(cardStyle["padding"]).toBe("32px 40px");
  expect(cardStyle["border-radius"]).toBe("10px");
  expect(cardStyle["box-shadow"]).toContain("rgba(0, 0, 0, 0.12)");
});

test("the editor root typography and the block spacing read the tokens", async ({ page }) => {
  await openCatalogPane(page);
  // The catalog doc carries nested editors (the sync-embed and the frame)
  // — the pane's own root is the first one in DOM order.
  const root = editor(page).first();

  // The root typography (the old editor-root rule is the root's classes):
  // the 16px font and its 1.6 line-height.
  const rootStyle = await styleProps(root, "font-size", "line-height");
  expect(rootStyle["font-size"]).toBe("16px");
  expect(rootStyle["line-height"]).toBe("25.6px");

  // A block wrapper's vertical spacing reads the spacing token (the old
  // generic wrapper rule is the wrappers' classes), and the gutter sits
  // in the left margin at the derived left-edge token.
  const paragraph = root.locator('[data-slot="docblocks/block"]').first();
  const margin = await styleProps(paragraph, "margin-top", "margin-bottom");
  expect(margin["margin-top"]).toBe("8px");
  expect(margin["margin-bottom"]).toBe("8px");
  const gutterStyle = await styleProps(paragraph.locator('[data-slot="docblocks/gutter"]'), "left", "top");
  expect(gutterStyle["left"]).toBe("-48px");
  // Centered on the first line: (16px * 1.6 - 20px) / 2 at the default font.
  expect(gutterStyle["top"]).toBe("2.8px");

  // The collapse toggle (a list item with children — the catalog's first
  // collapsible) stands in the gutter band, gap-1 clear of the content,
  // centered on the first line on the same axis as the grip. Its wrapper
  // is shifted by the marker zone, so the row-level column reads the band
  // edge minus the marker width.
  const collapse = root.locator('[data-slot="docblocks/collapse"]').first();
  const collapseStyle = await styleProps(collapse, "left", "top");
  expect(collapseStyle["left"]).toBe("-48px");
  expect(collapseStyle["top"]).toBe("2.8px");

  // The list marker stands in the marker zone (the row's first character):
  // its top edge at the content's top (the marker's own line box equals the
  // first line box — the glyph centers with the first text line), the zone's
  // left edge, the muted-foreground color (light).
  const marker = root.locator('[data-slot="docblocks/row-marker"]').first();
  const markerStyle = await styleProps(marker, "top", "left", "color");
  expect(markerStyle["top"]).toBe("0px");
  expect(markerStyle["left"]).toBe("-24px");
  // The muted-foreground input (the harness loads the standard seed).
  expect(markerStyle["color"]).toBe("oklch(0.556 0 0)");

  // The task checkbox stands in the same zone, centered on the first line
  // like the gutter band: the zone's left edge, (line box - 16px) / 2 down.
  const checkbox = root.locator('[data-slot="docblocks/checkbox"]').first();
  const checkboxStyle = await styleProps(checkbox, "left", "top");
  expect(checkboxStyle["left"]).toBe("-24px");
  expect(checkboxStyle["top"]).toBe("4.8px");

  // The flat list rows are standalone list items (outside a list element):
  // the UA marker dot is suppressed (the row's own marker span / checkbox
  // is the visible marker).
  const listItem = root.locator('[data-slot="docblocks/list-item"]').first();
  const liStyle = await styleProps(listItem, "list-style-type", "display");
  expect(liStyle["list-style-type"]).toBe("none");
  expect(liStyle["display"]).toBe("list-item");
});
