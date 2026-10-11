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
  // render as structural <tr>/<td>, not data-block-type elements).
  expect(await doc.locator('[data-block-type="paragraph"]').count()).toBe(7);
  expect(await doc.locator('[data-block-type="heading"]').count()).toBe(6);
  expect(await doc.locator('[data-block-type="list-item"]').count()).toBe(7);
  expect(await doc.locator('[data-block-type="callout"]').count()).toBe(4);
  expect(await doc.locator('[data-block-type="code"]').count()).toBe(1);
  expect(await doc.locator('[data-block-type="latex"]').count()).toBe(1);
  expect(await doc.locator('[data-block-type="table"]').count()).toBe(1);
  expect(await doc.locator('[data-block-type="image"]').count()).toBe(1);
  expect(await doc.locator('[data-block-type="divider"]').count()).toBe(1);

  // Headings 1..6 as their own tags.
  for (const tag of ["h1", "h2", "h3", "h4", "h5", "h6"]) {
    expect(await doc.locator(`${tag}[data-block-type="heading"]`).count()).toBe(1);
  }

  // Lists: one list per variant, the nested level inside the second bullet;
  // the task checkbox via data-checked.
  expect(await doc.locator('[data-slot="docblocks/list"][data-list="bullet"]').count()).toBe(2);
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

  // Code block: the language attr and the mono font from the tokens.
  const pre = doc.locator('pre[data-block-type="code"]');
  expect(await pre.getAttribute("data-language")).toBe("ts");
  expect((await styleProps(pre, "font-family"))["font-family"]).toContain("mono");

  // Image: the fixed key resolved by the harness's blob map.
  const img = doc.locator('img[data-slot="docblocks/image"]');
  expect(await img.count()).toBe(1);
  expect((await img.getAttribute("src")) ?? "").toContain("data:image/svg+xml");

  // Divider.
  expect(await doc.locator('hr[data-slot="docblocks/divider"]').count()).toBe(1);
});

test("a live edit after the catalog reaches the render and the JSON", async ({ page }) => {
  await openCatalogPane(page);
  // The pane's current block is the catalog's trailing paragraph (the last
  // paragraph in reading order): the data-current label keeps working.
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
