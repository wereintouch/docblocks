import { type Browser, type Page, expect, test } from "@playwright/test";

import { insertBlockType } from "./helpers";

// Each test gets its own room via ?syncUrl= — the relay keeps rooms for
// the dev server's lifetime, so a shared room would be polluted by other
// spec files (and by manually opened tabs).
const RELAY = "ws://localhost:5199";
const SETTLE = { timeout: 15_000 };

async function openPane(page: Page, client: "a" | "b", room: string): Promise<void> {
  await page.goto(`/?client=${client}&syncUrl=${RELAY}/${room}`);
  await expect(page.getByTestId(`status-${client}`)).toHaveText("connected");
}

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
async function leftKeys(page: Page, n: number): Promise<void> {
  for (let i = 0; i < n; i++) await page.keyboard.press("ArrowLeft");
}

async function twoPanes(
  browser: Browser,
  room: string
): Promise<{
  a: Page;
  b: Page;
  close: () => Promise<void>;
}> {
  const contextA = await browser.newContext();
  const contextB = await browser.newContext();
  const a = await contextA.newPage();
  const b = await contextB.newPage();
  const uniqueRoom = `${room}-${Math.random().toString(36).slice(2, 8)}`;
  await openPane(a, "a", uniqueRoom);
  await openPane(b, "b", uniqueRoom);
  return {
    a,
    b,
    close: async () => {
      await contextA.close();
      await contextB.close();
    },
  };
}

test("Enter splits the block in both panes and the caret lands in the tail", async ({ browser }) => {
  const { a, b, close } = await twoPanes(browser, "ui03b-enter");

  // The room starts with pane "a"'s single starter (seeded once after the
  // sync settles — a reload never re-seeds a non-empty room).
  await expect(inners(a, "a")).toHaveCount(1);
  const beforeInners = await inners(a, "a").count();

  const first = inners(a, "a").first();
  await first.click();
  await a.keyboard.type("hello world");
  await expect(inners(b, "b").first()).toHaveText("hello world");

  // Caret to offset 6, then split: "hello " / "world".
  await a.keyboard.press("End");
  await leftKeys(a, 5);
  await a.keyboard.press("Enter");

  await expect(inners(a, "a")).toHaveCount(beforeInners + 1);
  await expect(inners(b, "b")).toHaveCount(beforeInners + 1);
  await expect(inners(a, "a").first()).toHaveText("hello");
  await expect(inners(a, "a").nth(1)).toHaveText("world");
  await expect(inners(b, "b").first()).toHaveText("hello");
  await expect(inners(b, "b").nth(1)).toHaveText("world");

  // The caret is in the new block at offset 0 — B's presence line shows it.
  const tailId = await inners(a, "a").nth(1).getAttribute("data-block-id");
  expect(tailId).not.toBe(null);
  await expect.poll(() => b.getByTestId("presence-b").innerText(), SETTLE).toContain(`a:${tailId}:0`);

  await close();
});

test("Backspace at the block start merges into the previous block", async ({ browser }) => {
  const { a, b, close } = await twoPanes(browser, "ui03b-backspace");

  // The room starts with pane "a"'s single starter.
  await expect(inners(a, "a")).toHaveCount(1);
  const beforeInners = await inners(a, "a").count();

  const first = inners(a, "a").first();
  await first.click();
  await a.keyboard.type("hello world");
  await a.keyboard.press("End");
  await leftKeys(a, 5);
  await a.keyboard.press("Enter");
  await expect(inners(a, "a")).toHaveCount(beforeInners + 1);

  const second = inners(a, "a").nth(1);
  await second.click();
  await a.keyboard.press("Home");
  await a.keyboard.press("Backspace");

  await expect(inners(a, "a")).toHaveCount(beforeInners);
  await expect(inners(a, "a").first()).toHaveText("hello world");
  await expect(inners(b, "b")).toHaveCount(beforeInners);
  await expect(inners(b, "b").first()).toHaveText("hello world");

  await close();
});

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
  // (the row's first character, 24px + 20px).
  expect(
    await a.evaluate((c) => window.__paneDocs?.[c as "a"]?.getChildren(window.__paneDocs[c as "a"]!.toJSON().id), "a")
  ).toEqual(rootOrder);
  const secondRow = a.locator(`[data-slot="docblocks/row"]:has([data-block-id="${secondId}"])`);
  expect(await secondRow.evaluate((el) => getComputedStyle(el).paddingLeft)).toBe("44px");

  // Shift+Tab in the indented item brings it back to the top level (the
  // gesture writes the indent as an explicit 0 — the writer omits the
  // default at export; the row keeps its list marker gutter step).
  await secondInner.click();
  await a.keyboard.press("Shift+Tab");
  await expect.poll(async () => indentOf("a", secondId), SETTLE).toBe(0);
  await expect.poll(async () => indentOf("b", secondId), SETTLE).toBe(0);
  expect(await secondRow.evaluate((el) => getComputedStyle(el).paddingLeft)).toBe("20px");

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

// The empty-block editing rules (Enter / Backspace): a root-level empty
// non-text block resets its type to a plain paragraph; a child empty block
// outdents one level (the type stands, until the indent reaches 0, where
// the root rules take over); a root-level empty paragraph is removed on
// Backspace when the page carries more than one block.

test("Backspace on an empty root list item resets its type in place (one undo step)", async ({ browser }) => {
  const { a, b, close } = await twoPanes(browser, "ui03b-bs-reset");

  // The room's starter plus an empty bullet item (the pane's doc handle).
  await expect(inners(a, "a")).toHaveCount(1);
  const item = await a.evaluate(() => {
    const d = window.__paneDocs?.a ?? null;
    if (d === null) throw new Error("the pane's doc is not mounted");
    return d.insertBlock("list-item", { list: "bullet" });
  });
  if (item === null) throw new Error("the insert returned no id");
  await expect(inners(a, "a")).toHaveCount(2);

  const inner = inners(a, "a").nth(1);
  await inner.click();
  await a.keyboard.press("Backspace");

  // The reset is in place (the same block id, now a paragraph), one undo
  // step restores the list item, and the reset reached pane B.
  await expect
    .poll(async () => a.evaluate((id) => window.__paneDocs?.a?.getBlock(id)?.type, item), SETTLE)
    .toBe("paragraph");
  await expect
    .poll(async () => b.evaluate((id) => window.__paneDocs?.b?.getBlock(id)?.type, item), SETTLE)
    .toBe("paragraph");
  await expect(inners(a, "a")).toHaveCount(2);

  await inner.click();
  await a.keyboard.press("Control+z");
  await expect
    .poll(async () => a.evaluate((id) => window.__paneDocs?.a?.getBlock(id)?.type, item), SETTLE)
    .toBe("list-item");

  await close();
});

test("Backspace on an empty child list item outdents; on an empty root paragraph it removes", async ({ browser }) => {
  const { a, close } = await twoPanes(browser, "ui03b-bs-outdent");

  // Ladder: the starter paragraph, a bullet item, an empty child bullet
  // (indent 1).
  await expect(inners(a, "a")).toHaveCount(1);
  const ids = await a.evaluate(() => {
    const d = window.__paneDocs?.a ?? null;
    if (d === null) throw new Error("the pane's doc is not mounted");
    const parent = d.insertBlock("list-item", { list: "bullet" });
    const child = d.insertBlock("list-item", { list: "bullet", indent: 1 });
    return { parent, child };
  });
  await expect(inners(a, "a")).toHaveCount(3);

  // Backspace on the empty child (a non-paragraph type): the type resets
  // to a plain paragraph first, the indent stands.
  await inners(a, "a").nth(2).click();
  await a.keyboard.press("Backspace");
  await expect
    .poll(
      async () =>
        a.evaluate((id) => {
          const d = window.__paneDocs?.a ?? null;
          if (d === null) return null;
          const block = d.getBlock(id);
          return block === null ? null : { type: block.type, indent: block.attrs?.indent ?? 0 };
        }, ids.child),
      SETTLE
    )
    .toMatchObject({ type: "paragraph", indent: 1 });
  // The type reset remounts the row (li -> div): wait for the caret to be
  // re-seated in the new contenteditable before the next key.
  await expect(inners(a, "a").nth(2)).toBeFocused();

  // The next Backspace outdents (the type stands: a paragraph at the root
  // level).
  await a.keyboard.press("Backspace");
  await expect
    .poll(async () => a.evaluate((id) => window.__paneDocs?.a?.getBlock(id)?.type, ids.child), SETTLE)
    .toBe("paragraph");
  await expect
    .poll(
      async () =>
        a.evaluate((id) => {
          const d = window.__paneDocs?.a ?? null;
          if (d === null) return null;
          return d.getBlock(id)?.attrs?.indent ?? 0;
        }, ids.child),
      SETTLE
    )
    .toBe(0);
  await expect(inners(a, "a").nth(2)).toBeFocused();

  // Backspace on the empty root paragraph (the page has more than one
  // block): the block is removed.
  await a.keyboard.press("Backspace");
  await expect
    .poll(
      async () => a.evaluate((id) => (window.__paneDocs?.a?.getBlock(id) === null ? "removed" : "present"), ids.child),
      SETTLE
    )
    .toBe("removed");
  await expect(inners(a, "a")).toHaveCount(2);

  await close();
});

test("a reload does not re-seed the room (the content is stable across reloads)", async ({ browser }) => {
  const context = await browser.newContext();
  const a = await context.newPage();
  const room = `ui03b-reload-${Math.random().toString(36).slice(2, 8)}`;
  await openPane(a, "a", room);

  // The room's single starter settles (pane "a" is the designated seeder,
  // after the sync settles).
  await expect(inners(a, "a")).toHaveCount(1);
  const first = inners(a, "a").first();
  await first.click();
  await a.keyboard.type("hello");
  await insertBlockType(a, "a", "list-item");
  await expect(inners(a, "a")).toHaveCount(2);
  const second = inners(a, "a").nth(1);
  await second.click();
  await a.keyboard.type("an item");
  await expect(inners(a, "a").first()).toHaveText("hello");
  const countBefore = await inners(a, "a").count();

  // Two reloads: the relay's room state survives the reload and the pane
  // resyncs against it — no duplicate starter, the content stands.
  await a.reload({ waitUntil: "domcontentloaded" });
  await expect(inners(a, "a")).toHaveCount(countBefore);
  await expect(inners(a, "a").first()).toHaveText("hello");
  await a.reload({ waitUntil: "domcontentloaded" });
  await expect(inners(a, "a")).toHaveCount(countBefore);
  await expect(inners(a, "a").first()).toHaveText("hello");
  await expect(inners(a, "a").nth(1)).toHaveText("an item");

  await context.close();
});

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
  // The gesture is a no-op: no doc command, no wire update.
  await a.waitForTimeout(300);
  expect(await a.locator("[data-testid='wire-a'] li", { hasText: " out " }).count()).toBe(outBefore);
  // The browser's default Tab (focus to the next focusable element) is
  // suppressed: the focus stays in the block's contenteditable.
  expect(await a.evaluate(() => document.activeElement?.getAttribute("data-slot"))).toBe("docblocks/block-content");

  // A no-op Shift+Tab on the top level behaves the same.
  await a.keyboard.press("Shift+Tab");
  expect(await a.evaluate(() => document.activeElement?.getAttribute("data-slot"))).toBe("docblocks/block-content");

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
