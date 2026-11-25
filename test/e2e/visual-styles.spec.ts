// The catalog pane: ?catalog=1 makes the pane build the deterministic v1
// catalog document (apps/playground/src/catalog.ts) instead of the empty
import { type Locator, type Page, expect, test } from "@playwright/test";

import { RELAY, SETTLE } from "./helpers";

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
  expect((await styleProps(marks.locator("code"), "font-family"))["font-family"]).toContain("mono");
});

test("the catalog covers every v1 block structure", async ({ page }) => {
  await openCatalogPane(page);
  const doc = editor(page);

  // Every data-block-type value the catalog carries (table-row / table-cell
  // render as structural <tr>/<td>, not data-block-type elements). The
  // catalog's sync-embed resolves its master (fixed docId, deterministic
  // seed), so the master's blocks (one h1 + three paragraphs) count too.
  // The canvas scene (the surface + its frames / shapes / canvas-text /
  // connector) is a canvas layer: the page view carries none of it as page
  // rows (the frames are childless — the former frame's heading + paragraph
  // stand out of the counts). The page-frame block (the `frameId` reference
  // to frame A) is a page row, though: its inline window carries the inert
  // copies INSIDE the window's slot, never as rows. The motion view renders
  // the flat page sequence: the nesting is the row step (no nested slot),
  // and the list markers stand as rendered row labels (no list element).
  expect(await doc.locator('[data-block-type="paragraph"]').count()).toBe(12);
  expect(await doc.locator('[data-block-type="quote"]').count()).toBe(2);
  expect(await doc.locator('[data-block-type="heading"]').count()).toBe(7);
  expect(await doc.locator('[data-block-type="list-item"]').count()).toBe(17);
  expect(await doc.locator('[data-block-type="callout"]').count()).toBe(4);
  expect(await doc.locator('[data-block-type="code"]').count()).toBe(3);
  expect(await doc.locator('[data-block-type="code"][data-language="mermaid"]').count()).toBe(1);
  // The curated-language code block renders the highlight layer behind the
  // inner (the plain/unknown-language blocks stand no layer).
  expect(await doc.locator('[data-slot="docblocks/code-highlight"]').count()).toBe(1);
  // The mermaid block stands in its default code mode (the exclusive
  // modes): the editable code with the line numbers stands, the diagram
  // is not rendered (the preview render is pinned by the mermaid spec).
  expect(await doc.locator('[data-slot="docblocks/mermaid"]').count()).toBe(0);
  expect(
    await doc
      .locator('[data-block-type="code"][data-language="mermaid"] [data-slot="docblocks/code-line-numbers"]')
      .count()
  ).toBe(1);
  expect(await doc.locator('[data-block-type="table"]').count()).toBe(1);
  expect(await doc.locator('[data-block-type="image"]').count()).toBe(1);
  expect(await doc.locator('[data-block-type="embed"]').count()).toBe(1);
  expect(await doc.locator('[data-block-type="divider"]').count()).toBe(1);

  // Headings 1..6 as their own tags; the master's h1 adds a second h1.
  expect(await doc.locator('h1[data-block-type="heading"]').count()).toBe(2);
  expect(await doc.locator('h2[data-block-type="heading"]').count()).toBe(1);
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

  // Table 2x2, the cell text via its child paragraph; the first cell also
  // carries its own runs (the text-cell shape — the runs layer stands
  // above the children).
  expect(await doc.locator("tr").count()).toBe(2);
  expect(await doc.locator('td[data-slot="docblocks/table-cell"]').count()).toBe(4);
  const firstCell = doc.locator("td").first();
  await expect(firstCell.locator('[data-slot="docblocks/block-content"]').first()).toHaveText("own runs");
  await expect(firstCell.locator('[data-block-type="paragraph"]').first()).toHaveText("cell 1-1");

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
  expect((await img.getAttribute("src")) ?? "").toMatch(/^blob:/);

  const file = doc.locator('[data-slot="docblocks/file-card"]');
  await expect(file).toHaveCount(1);
  await expect(file.locator('[data-slot="docblocks/file-name"]')).toHaveText("catalog.txt");
  await expect(file.locator('[data-slot="docblocks/file-download"]')).toHaveAttribute("download", "catalog.txt");

  // Embed: the fixed data: URL src and the kind on the wrapper.
  const embed = doc.locator('iframe[data-slot="docblocks/embed"]');
  expect(await embed.count()).toBe(1);
  expect((await embed.getAttribute("src")) ?? "").toContain("data:text/html");
  expect(await doc.locator('[data-block-type="embed"][data-kind="html"]').count()).toBe(1);

  // Sync-embed: the resolved master content renders inside the wrapper
  // (the outer JSON carries the ref only, pinned by the JSON golden).
  const syncEmbed = doc.locator('[data-block-type="sync-embed"]');
  expect(await syncEmbed.count()).toBe(1);
  expect(await syncEmbed.locator('[data-slot="docblocks/sync-embed-body"]').count()).toBe(1);
  expect((await syncEmbed.getAttribute("data-doc-id")) ?? "").toBe("master-catalog");
  expect(await syncEmbed.locator('h1[data-block-type="heading"]').count()).toBe(1);
  expect(await syncEmbed.locator('[data-block-type="paragraph"]').count()).toBe(3);

  // Canvas (v2): the seeded demo scene is a canvas layer — the page view
  // carries none of it as page rows (no surface viewport, no shapes /
  // canvas-text / connector line as rows). The page-frame block renders its
  // window over the canvas content instead: the inert copies stand inside
  // the window's slot (the referenced frame A stands out of its own window;
  // frame B stands its boundary over the window — the canvas frame's mirror
  // is gone, so the surface's copies stand once, no nested re-render).
  expect(await doc.locator('[data-block-type="surface"]').count()).toBe(0);
  // The page-frame block's row (the window's wrapper + the box over the
  // canvas's background; the reference's title stands the box's aria).
  expect(await doc.locator('[data-block-type="frame"]').count()).toBe(1);
  expect(await doc.locator('[data-slot="docblocks/frame-page"]').count()).toBe(1);
  const pageWindow = doc.locator('[data-slot="docblocks/frame-page-window"]');
  expect(await pageWindow.count()).toBe(1);
  expect(await pageWindow.getAttribute("aria-label")).toBe("Frame: Frame A");
  // The window's inert copies (the surface's children over the referenced
  // frame's region, clipped to the box — 4 shapes, frame B's boundary, the
  // canvas-text, the connector, each once: the canvas frame's boundary
  // renders no nested window's copy).
  expect(await pageWindow.locator('[data-slot="docblocks/shape"]').count()).toBe(4);
  expect(await pageWindow.locator('[data-slot="docblocks/frame"]').count()).toBe(1);
  expect(await pageWindow.locator('[data-block-type="canvas-text"]').count()).toBe(1);
  expect(await pageWindow.locator('[data-slot="docblocks/connector-layer"] path[data-connector-id]').count()).toBe(1);
  expect(await pageWindow.locator('[data-slot="docblocks/connector-label-chip"]').count()).toBe(1);
  // And the canvas layer stands nowhere OUTSIDE the window (the page rows
  // carry no canvas element — the copies are the window's content, not
  // rows).
  const outsideWindow = (selector: string) =>
    page.evaluate((sel) => {
      const elements = Array.from(document.querySelectorAll(sel));
      return elements.filter((el) => el.closest('[data-slot="docblocks/frame-page-window"]') === null).length;
    }, selector);
  for (const selector of [
    '[data-slot="docblocks/shape"]',
    '[data-slot="docblocks/frame"]',
    '[data-block-type="canvas-text"]',
    '[data-slot="docblocks/connector-layer"] path[data-connector-id]',
  ]) {
    expect(await outsideWindow(selector)).toBe(0);
  }

  // Divider.
  expect(await doc.locator('[data-slot="docblocks/divider"]').count()).toBe(1);

  // Nested under text: the flat model renders the indented segment as the
  // sequence's own rows (the per-level row step — no nested slot): the
  // indented paragraph steps one level (24px), the indented list item the
  // step plus its marker zone (the row's first character, 24px + 24px).
  const rowPaddingOf = (id: string) =>
    doc
      .locator(`[data-block-id="${id}"]`)
      .first()
      .evaluate((el) => getComputedStyle(el.parentElement!).paddingLeft);
  expect(await rowPaddingOf("c0065")).toBe("24px");
  expect(await rowPaddingOf("c0066")).toBe("48px");
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
