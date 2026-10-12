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
  await expect(page.getByTestId("status-a")).toHaveText("connected", SETTLE);
  // The catalog is built locally on mount; the divider lands with it.
  await expect(page.locator('hr[data-slot="docblocks/divider"]')).toHaveCount(1, SETTLE);
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
  // and so does the canvas scene (a frame paragraph + a frame heading) and
  // the nested-under-text sample (a container + an indented paragraph + an
  // indented list item).
  expect(await doc.locator('[data-block-type="paragraph"]').count()).toBe(13);
  expect(await doc.locator('[data-block-type="heading"]').count()).toBe(8);
  expect(await doc.locator('[data-block-type="list-item"]').count()).toBe(8);
  expect(await doc.locator('[data-block-type="callout"]').count()).toBe(4);
  expect(await doc.locator('[data-block-type="code"]').count()).toBe(2);
  expect(await doc.locator('[data-block-type="code"][data-language="mermaid"]').count()).toBe(1);
  // The mermaid block renders the diagram (not the plain code view): wait
  // for the async render, then pin the preview state.
  await expect(doc.locator('[data-slot="docblocks/mermaid"] svg'), SETTLE).toHaveCount(1);
  await expect(doc.locator('[data-slot="docblocks/mermaid"][data-state="diagram"]')).toHaveCount(1);
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

  // Lists: one list per variant, the nested level inside the second bullet
  // (plus the nested sample's bullet under a paragraph), the task checkbox
  // via data-checked.
  expect(await doc.locator('[data-slot="docblocks/list"][data-list="bullet"]').count()).toBe(3);
  expect(await doc.locator('[data-slot="docblocks/list"][data-list="number"]').count()).toBe(1);
  expect(await doc.locator('[data-slot="docblocks/list"][data-list="task"]').count()).toBe(1);
  expect(await doc.locator('li[data-checked="true"]').count()).toBe(1);

  // Callout variants: the explicit ones carry data-variant, the default does not.
  expect(await doc.locator('[data-block-type="callout"][data-variant="info"]').count()).toBe(1);
  expect(await doc.locator('[data-block-type="callout"][data-variant="warning"]').count()).toBe(1);
  expect(await doc.locator('[data-block-type="callout"][data-variant="danger"]').count()).toBe(1);
  expect(await doc.locator('[data-block-type="callout"]:not([data-variant])').count()).toBe(1);

  // Table 2x2, the cell text via its child paragraph.
  expect(await doc.locator("tr").count()).toBe(2);
  expect(await doc.locator('td[data-slot="docblocks/table-cell"]').count()).toBe(4);
  await expect(doc.locator("td").first()).toHaveText("cell 1-1");

  // Code blocks: the language attrs (the ts block is the mono pin below; the
  // mermaid block renders the diagram — waited for above).
  const pre = doc.locator('pre[data-block-type="code"][data-language="ts"]');
  expect(await pre.getAttribute("data-language")).toBe("ts");
  expect((await styleProps(pre, "font-family"))["font-family"]).toContain("mono");

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
  await expect(doc.locator('[data-slot="docblocks/shape"]'), SETTLE).toHaveCount(4);
  expect(await doc.locator('[data-slot="docblocks/frame"]').count()).toBe(1);
  expect(await doc.locator('[data-block-type="canvas-text"]').count()).toBe(1);
  await expect(doc.locator('[data-slot="docblocks/connector-layer"] line'), SETTLE).toHaveCount(1);

  // Divider.
  expect(await doc.locator('hr[data-slot="docblocks/divider"]').count()).toBe(1);

  // Nested under text: the docblocks/nested slot inside the sample's
  // container (the CSS indent is pinned by test/e2e/nesting.spec.ts).
  const nested = doc.locator('[data-slot="docblocks/nested"]');
  expect(await nested.count()).toBe(1);
  expect(await nested.locator('[data-block-type="paragraph"]').count()).toBe(1);
  expect(await nested.locator('li[data-block-type="list-item"]').count()).toBe(1);
});

test("a live edit after the catalog reaches the render and the JSON", async ({ page }) => {
  await openCatalogPane(page);
  // The pane's current block is the last top-level paragraph (the
  // catalog's nested-under-text container, after the trailing one): the
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

// The marker cycle (the pane renders the motion view, whose root run is
// level 1): a 3-level nested run per kind gives disc → circle → square and
// decimal → lower-alpha → lower-roman in the real browser (computed style —
// jsdom cannot compute list-style). A unique room: the relay keeps rooms
// for the dev server's lifetime, so a shared room would be polluted.
test("the list markers cycle per nesting level", async ({ page }) => {
  const room = `vreg01l-${Math.random().toString(36).slice(2, 8)}`;
  await page.goto(`/?client=a&syncUrl=${RELAY}/${room}`);
  await expect(page.getByTestId("status-a")).toHaveText("connected", SETTLE);

  // A 3-level nested run per kind, seeded through the pane's own doc
  // commands (the established harness pattern).
  const seeded = await page.evaluate(() => {
    const d = window.__paneDocs?.a ?? null;
    if (d === null) return false;
    for (const list of ["bullet", "number"] as const) {
      const ids: string[] = [];
      for (let level = 0; level < 3; level++) {
        const parent = ids[level - 1];
        const id = d.insertBlock("list-item", { list }, parent === undefined ? undefined : { parent });
        d.insertText(id, 0, `${list} level ${level + 1}`);
        ids.push(id);
      }
    }
    return true;
  });
  expect(seeded, "the pane's doc should be mounted").toBe(true);

  // Settle: the motion view animates the root entries in (6 lists: three
  // per kind, each run nesting one level deeper).
  await expect
    .poll(async () => page.locator('[data-testid="doc-a"] [data-slot="docblocks/list"]').count(), SETTLE)
    .toBe(6);

  /** Every list element of the kind in DOM order: the cycle index + the real computed marker. */
  const markers = (kind: "bullet" | "number") =>
    page.$$eval(`[data-testid="doc-a"] [data-slot="docblocks/list"][data-list="${kind}"]`, (els) =>
      els.map((el) => ({ depth: el.getAttribute("data-depth"), style: getComputedStyle(el).listStyleType }))
    );

  expect(await markers("bullet")).toEqual([
    { depth: "1", style: "disc" },
    { depth: "2", style: "circle" },
    { depth: "3", style: "square" },
  ]);
  expect(await markers("number")).toEqual([
    { depth: "1", style: "decimal" },
    { depth: "2", style: "lower-alpha" },
    { depth: "3", style: "lower-roman" },
  ]);
});
