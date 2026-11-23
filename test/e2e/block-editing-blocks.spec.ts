// The block-level operations over the rows — the Tab's indent step and the
// no-op Tab's stand, the gutter's single / multi selection's delete, and
// the hover grip's reveal stand over the typing session.
import { type Page, expect, test } from "@playwright/test";

import { SETTLE, expectStays, insertBlockType, twoPanes } from "./helpers";

function pane(page: Page, client: "a" | "b") {
  return page.locator(`[data-testid="doc-${client}"]`);
}

/** The inner contenteditables of the pane's text blocks, in order. */

function inners(page: Page, client: "a" | "b") {
  return pane(page, client).locator('[data-slot="docblocks/block-content"]');
}

/** The pane's block wrappers (the inner editables are not blocks). */

function wrappers(page: Page, client: "a" | "b") {
  return pane(page, client).locator('[data-block-id]:not([data-slot="docblocks/block-content"])');
}

/** The pane's list item rows (the flat model: each item is its own row — no list element wraps it in the motion view). */

function listItems(page: Page, client: "a" | "b") {
  return pane(page, client).locator('[data-block-type="list-item"]');
}

async function insertType(page: Page, client: "a" | "b", type: string): Promise<void> {
  await insertBlockType(page, client, type);
}

/**
 * Press ArrowLeft n times. Playwright's `count` option is unreliable inside
 * a contenteditable (one discrete press lands, the repeats coalesce), so
 * the keys are pressed one by one.
 */

test("Tab indents the list item (an indent attr update); Shift+Tab brings it back", async ({ browser }) => {
  const { a, b, close } = await twoPanes(browser, "ui03b-tab");

  await insertType(a, "a", "list-item");
  await insertType(a, "a", "list-item");
  await expect(listItems(b, "b")).toHaveCount(2);

  // The ids of the two items (root order: the room's starter row first).
  const rootOrder = await a.evaluate((c) => {
    const d = window.__paneDocs?.[c as "a" | "b"] ?? null;
    if (d === null) throw new Error("the pane's doc is not mounted");
    return d.getChildren(d.toJSON().id);
  }, "a");
  const secondId = rootOrder[2]!;

  // Caret in the second item, Tab: the flat model's indent attr update —
  // the sequence stands, the item's row steps in one level. Each pane's
  // doc handle lives on its own page (__paneDocs), so read each pane on
  // its own page.
  const secondInner = listItems(a, "a").nth(1).locator('[data-slot="docblocks/block-content"]');
  await secondInner.click();
  await a.keyboard.press("Tab");

  const indentOf = (client: "a" | "b", id: string) =>
    (client === "a" ? a : b).evaluate(
      ({ c, id }) => {
        const d = window.__paneDocs?.[c as "a" | "b"] ?? null;
        const block = d === null ? null : d.getBlock(id);
        return block === null ? undefined : (block.attrs as { indent?: number } | undefined)?.indent;
      },
      { c: client, id }
    );
  await expect.poll(async () => indentOf("a", secondId), SETTLE).toBe(1);
  await expect.poll(async () => indentOf("b", secondId), SETTLE).toBe(1);
  // The sequence order stands (a Tab is an attr update, never a move), and
  // the indented row's left step is the indent step plus its marker zone
  // (the row's first character, 24px + 24px).
  expect(
    await a.evaluate((c) => window.__paneDocs?.[c as "a"]?.getChildren(window.__paneDocs[c as "a"]!.toJSON().id), "a")
  ).toEqual(rootOrder);
  const secondRow = a.locator(`[data-slot="docblocks/row"]:has([data-block-id="${secondId}"])`);
  expect(await secondRow.evaluate((el) => getComputedStyle(el).paddingLeft)).toBe("48px");

  // Shift+Tab in the indented item brings it back to the top level (the
  // gesture writes the indent as an explicit 0 — the writer omits the
  // default at export; the row keeps its list marker gutter step).
  await secondInner.click();
  await a.keyboard.press("Shift+Tab");
  await expect.poll(async () => indentOf("a", secondId), SETTLE).toBe(0);
  await expect.poll(async () => indentOf("b", secondId), SETTLE).toBe(0);
  expect(await secondRow.evaluate((el) => getComputedStyle(el).paddingLeft)).toBe("24px");

  await close();
});

test("gutter click selects the block; Delete removes it in both panes", async ({ browser }) => {
  const { a, b, close } = await twoPanes(browser, "ui03b-gutter");

  // The room's starter plus an inserted paragraph: two text blocks (the
  // editor root is not a rendered block wrapper).
  await expect(wrappers(a, "a")).toHaveCount(1);
  await insertBlockType(a, "a", "paragraph");
  await expect(wrappers(a, "a")).toHaveCount(2);
  const before = 2;
  const wrapper = wrappers(a, "a").nth(1);
  const gutter = wrapper.locator('button[data-slot="docblocks/gutter"]');

  const wrapperId = (await wrapper.getAttribute("data-block-id")) ?? "";
  await wrapper.hover();
  await gutter.click();
  await expect(wrapper).toHaveAttribute("data-selected", "true");

  await a.keyboard.press("Delete");
  await expect(wrappers(a, "a")).toHaveCount(before - 1);
  await expect(wrappers(b, "b")).toHaveCount(before - 1);
  await expect(b.getByTestId(`block-b-${wrapperId}`)).toHaveCount(0);

  await close();
});

test("the gutter multi-select delete is undone by the hotkey (the focus stays inside the editor)", async ({
  browser,
}) => {
  const { a, b, close } = await twoPanes(browser, "ui03b-gutter-multi-undo");

  // The room's starter plus two inserted paragraphs: three text rows.
  await expect(wrappers(a, "a")).toHaveCount(1);
  await insertBlockType(a, "a", "paragraph");
  await insertBlockType(a, "a", "paragraph");
  await expect(wrappers(a, "a")).toHaveCount(3);

  const first = wrappers(a, "a").nth(1);
  const second = wrappers(a, "a").nth(2);
  await first.hover();
  await first.locator('button[data-slot="docblocks/gutter"]').click();
  await expect(first).toHaveAttribute("data-selected", "true");
  await second.hover();
  await second.locator('button[data-slot="docblocks/gutter"]').click({ modifiers: ["Shift"] });
  await expect(first).toHaveAttribute("data-selected", "true");
  await expect(second).toHaveAttribute("data-selected", "true");

  // The focused row (the last clicked — the gutter click parks the focus)
  // owns the delete key; both rows go with their segments, the starter
  // stands.
  await a.keyboard.press("Delete");
  await expect(wrappers(a, "a")).toHaveCount(1);
  await expect(wrappers(b, "b")).toHaveCount(1);

  // The deleted rows unmounted with the focus: the hotkey reach is the
  // editor root, and the undo restores the rows in both panes.
  await a.keyboard.press("Control+z");
  await expect(wrappers(a, "a")).toHaveCount(3);
  await expect(wrappers(b, "b")).toHaveCount(3);

  await close();
});

// The empty-block editing rules (Enter / Backspace): a root-level empty
// non-text block resets its type to a plain paragraph; a child empty block
// outdents one level (the type stands, until the indent reaches 0, where
// the root rules take over); a root-level empty paragraph is removed on
// Backspace when the page carries more than one block.

test("a no-op Tab keeps the caret in the text (the focus does not escape)", async ({ browser }) => {
  const { a, close } = await twoPanes(browser, "ui03b-tab-noop");

  // The room starts with pane "a"'s single starter — the first block has
  // no preceding block, so a Tab is a no-op.
  await expect(inners(a, "a")).toHaveCount(1);
  const inner = inners(a, "a").first();
  await inner.click();
  await a.keyboard.type("text");

  const outBefore = await a.locator("[data-testid='wire-a'] li", { hasText: " out " }).count();
  await a.keyboard.press("Tab");
  // The gesture is a no-op: no doc command, no wire update (the window's
  // stand — the late commit's false green's guard).
  await expectStays(async () => {
    expect(await a.locator("[data-testid='wire-a'] li", { hasText: " out " }).count()).toBe(outBefore);
  });
  // The browser's default Tab (focus to the next focusable element) is
  // suppressed: the focus stays in the page's single editable (the shared
  // page container — the caret's block is not the focused element in the
  // span model).
  expect(await a.evaluate(() => document.activeElement?.getAttribute("data-slot"))).toBe("docblocks/page");

  // A no-op Shift+Tab on the top level behaves the same.
  await a.keyboard.press("Shift+Tab");
  expect(await a.evaluate(() => document.activeElement?.getAttribute("data-slot"))).toBe("docblocks/page");

  await close();
});

test("the hover grip stands hidden while typing and returns on a pointer move", async ({ browser }) => {
  const { a, close } = await twoPanes(browser, "ui03b-typing-grip");

  await expect(inners(a, "a")).toHaveCount(1);
  const inner = inners(a, "a").first();
  await inner.click();
  await a.keyboard.type("text");

  const row = a.locator('[data-slot="docblocks/row"]').first();
  const gripOpacity = () =>
    row.evaluate((el) => getComputedStyle(el.querySelector('[data-slot="docblocks/gutter"]')!).opacity);

  // Hover: the grip reveals (opacity 1).
  await row.hover();
  await expect.poll(gripOpacity, SETTLE).toBe("1");

  // Typing (the mouse stands still on the row): the grip hides.
  await inner.click();
  await a.keyboard.type("x");
  await expect.poll(gripOpacity, SETTLE).toBe("0");

  // The first pointer move ends the typing session: with the mouse still
  // on the row the hover reveal returns (opacity 1).
  const box = (await row.boundingBox())!;
  await a.mouse.move(box.x + box.width - 10, box.y + box.height / 2, { steps: 4 });
  await expect.poll(gripOpacity, SETTLE).toBe("1");

  // The same rule on a flat list row (the grip stands in its li wrapper —
  // the list-item slot, not the block slot).
  await insertType(a, "a", "list-item");
  await expect(inners(a, "a")).toHaveCount(2);
  const listInner = inners(a, "a").nth(1);
  const listRow = a.locator('[data-slot="docblocks/row"]').nth(1);
  const listGripOpacity = () =>
    listRow.evaluate((el) => getComputedStyle(el.querySelector('[data-slot="docblocks/gutter"]')!).opacity);
  await listRow.hover();
  await expect.poll(listGripOpacity, SETTLE).toBe("1");
  await listInner.click();
  await a.keyboard.type("x");
  await expect.poll(listGripOpacity, SETTLE).toBe("0");

  await close();
});
