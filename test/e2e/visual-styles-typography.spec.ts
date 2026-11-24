// The text rendering's pins — the caret rect over the known offsets, the
// list markers' cycle per indent level (the computed style over the real
// browser), and the editor root's typography + the block spacing's tokens.
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
  // One transact stands the whole seed (one render, not six) so the rows
  // settle together.
  const seeded = await page.evaluate(() => {
    const d = window.__paneDocs?.a ?? null;
    if (d === null) return false;
    d.transact(() => {
      for (const list of ["bullet", "number"] as const) {
        for (let level = 0; level < 3; level++) {
          d.insertBlock("list-item", { list, ...(level > 0 ? { indent: level } : {}) });
        }
      }
    });
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

test("the editor root typography and the block spacing read the tokens", async ({ page }) => {
  await openCatalogPane(page);
  // The catalog doc carries one nested editor (the sync-embed — the
  // page-frame's window is inert content, not an editor) — the pane's own
  // root is the first one in DOM order.
  const root = editor(page).first();

  // The root typography (the old editor-root rule is the root's classes):
  // the 16px font and its 1.6 line-height.
  const rootStyle = await styleProps(root, "font-size", "line-height");
  expect(rootStyle["font-size"]).toBe("16px");
  expect(rootStyle["line-height"]).toBe("25.6px");

  // A block wrapper's vertical spacing reads the spacing token (the old
  // generic wrapper rule is the wrappers' classes), and the gutter stands
  // in the left margin at the derived left-edge tokens: the grip at the
  // band's left edge, the quick-insert plus one slot right of it.
  const paragraph = root.locator('[data-slot="docblocks/block"]').first();
  const margin = await styleProps(paragraph, "margin-top", "margin-bottom");
  expect(margin["margin-top"]).toBe("8px");
  expect(margin["margin-bottom"]).toBe("8px");
  const gutterStyle = await styleProps(paragraph.locator('[data-slot="docblocks/gutter"]'), "left", "top");
  expect(gutterStyle["left"]).toBe("-72px");
  // Centered on the first line: (16px * 1.6 - 20px) / 2 at the default font.
  expect(gutterStyle["top"]).toBe("2.8px");
  const gutterPlusStyle = await styleProps(paragraph.locator('[data-slot="docblocks/gutter-plus"]'), "left");
  expect(gutterPlusStyle["left"]).toBe("-48px");

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
