// The link popover's session's stands over the real browser: the close's
// paths (the outside's click's stand, the document's Escape over the input's
// no-focus's stand — the no-write's stand over both) and the input's focus's
// stand over a lost focus (the mousedown's default's stand — the typing's
// land over the input, not the doc; the edit's commit over the prefill).
import { type Page, expect, test } from "@playwright/test";

import { SETTLE, twoPanes } from "./helpers";

const HREF = "https://example.org/page";
// The "world"'s run (the link's range over the text).
const MARK_FROM = 6;
const MARK_TO = 11;
const TEXT = "go to world now";

const firstInner = (page: Page, client: "a" | "b") =>
  page.locator(`[data-testid="doc-${client}"]`).locator('[data-slot="docblocks/block-content"]').first();

/** Type the fixture's text into the seeded (empty) paragraph. */
async function seedText(page: Page, client: "a" | "b"): Promise<void> {
  const inner = firstInner(page, client);
  await inner.click();
  await page.keyboard.type(TEXT);
}

/** Select the whole line (the caret at the end + Shift+Home). */
async function selectAll(page: Page): Promise<void> {
  await page.keyboard.down("Shift");
  await page.keyboard.press("Home");
  await page.keyboard.up("Shift");
}

/** The pane's live doc's runs (the harness's `__paneDocs` stand). */
async function runsOf(page: Page, client: "a" | "b"): Promise<{ text: string; marks: Record<string, unknown> }[]> {
  return page.evaluate((c) => {
    const doc = window.__paneDocs?.[c];
    if (doc === null || doc === undefined) throw new Error("the pane's doc is not mounted");
    const id = doc.getChildren(doc.toJSON().id)[0]!;
    const block = doc.getBlock(id)!;
    return block.content ?? [];
  }, client);
}

const linkRuns = (runs: { text: string; marks: Record<string, unknown> }[]) =>
  runs.filter((run) => run.marks.link !== undefined);

const toolbar = (page: Page) => page.locator('[data-slot="docblocks/format-toolbar"]');
const linkButton = (page: Page) => toolbar(page).locator("[data-link-btn]");
const popover = (page: Page) => page.locator('[data-slot="docblocks/link-popover"]');
const popoverInput = (page: Page) => popover(page).locator("input");

/** Seed the "world"'s run over the link mark (the semantic API). */
async function seedLink(page: Page): Promise<void> {
  await page.evaluate(
    ({ from, to, href }) => {
      const docs = window.__paneDocs;
      const doc = docs?.a;
      if (doc === null || doc === undefined) throw new Error("the pane's doc stands absent");
      const id = doc.getChildren(doc.toJSON().id)[0]!;
      doc.setMark(id, from, to, { type: "link", href });
    },
    { from: MARK_FROM, to: MARK_TO, href: HREF }
  );
}

test("the popover's close over the outside's click (the no-write's stand)", async ({ browser }) => {
  const { a, close } = await twoPanes(browser, "link-editor-outside-close");
  try {
    await seedText(a, "a");
    await selectAll(a);
    await linkButton(a).click();
    await expect(popover(a)).toBeVisible(SETTLE);

    // The doc's stand: the line's right edge's point (the popover's anchor's
    // left's stand keeps it clear over the short line's stand).
    const rootBox = (await a.locator('[data-slot="docblocks/editor"]').first().boundingBox())!;
    const lineBox = (await firstInner(a, "a").boundingBox())!;
    await a.mouse.click(rootBox.x + rootBox.width - 15, lineBox.y + lineBox.height / 2);

    await expect(popover(a)).toBeHidden(SETTLE);
    const runs = await runsOf(a, "a");
    expect(linkRuns(runs)).toEqual([]); // the no-write's stand
  } finally {
    await close();
  }
});

test("the popover's input's focus stand over a lost focus (the typing's land over the input)", async ({ browser }) => {
  const { a, close } = await twoPanes(browser, "link-editor-input-focus");
  try {
    await seedText(a, "a");
    await seedLink(a);
    const anchor = firstInner(a, "a").locator("a[data-slot='docblocks/link']");
    // The caret inside the link + the mod+k's open (the prefill's stand).
    await anchor.click({ position: { x: 10, y: 8 } });
    await a.keyboard.down("Control");
    await a.keyboard.press("k");
    await a.keyboard.up("Control");
    await expect(popover(a)).toBeVisible(SETTLE);
    await expect(popoverInput(a)).toHaveValue(HREF);

    // The input's focus's loss without the close (the Tab's stand over the
    // popover's controls), then the input's click's re-seat (the mousedown's
    // default's stand — the focus's stand).
    await a.keyboard.press("Tab");
    await popoverInput(a).click();
    await expect(popoverInput(a)).toBeFocused();

    // The address's replace over the prefill (the select-all's stand) + the
    // commit (the href's change over the word's range, the text's stand).
    await a.keyboard.press("Control+a");
    await a.keyboard.type("https://edited.example");
    await a.keyboard.press("Enter");
    await expect(popover(a)).toBeHidden(SETTLE);

    const runs = await runsOf(a, "a");
    expect(linkRuns(runs).map((run) => [run.text, run.marks.link])).toEqual([
      ["world", { href: "https://edited.example" }],
    ]);
  } finally {
    await close();
  }
});

test("the document's Escape stands the close (the input's no-focus's stand, the no-write's stand)", async ({
  browser,
}) => {
  const { a, close } = await twoPanes(browser, "link-editor-doc-escape");
  try {
    await seedText(a, "a");
    await selectAll(a);
    await linkButton(a).click();
    await expect(popover(a)).toBeVisible(SETTLE);

    // The input's focus's loss without the close (the Tab's stand over the
    // popover's controls), then the Escape over the non-input's target.
    await a.keyboard.press("Tab");
    await a.keyboard.press("Escape");
    await expect(popover(a)).toBeHidden(SETTLE);
    const runs = await runsOf(a, "a");
    expect(linkRuns(runs)).toEqual([]); // the no-write's stand
  } finally {
    await close();
  }
});
