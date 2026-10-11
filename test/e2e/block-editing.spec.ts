import { type Browser, type Page, expect, test } from "@playwright/test";

// Each test gets its own room via ?syncUrl= — the relay keeps rooms for
// the dev server's lifetime, so a shared room would be polluted by other
// spec files (and by manually opened tabs).
const RELAY = "ws://localhost:5199";
const SETTLE = { timeout: 15_000 };

async function openPane(page: Page, client: "a" | "b", room: string): Promise<void> {
  await page.goto(`/?client=${client}&syncUrl=${RELAY}/${room}`);
  await expect(page.getByTestId(`status-${client}`)).toHaveText("connected", SETTLE);
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

/** The top-level list items (the list rendered directly under the editor root). */
function topLis(page: Page, client: "a" | "b") {
  return pane(page, client).locator('[data-slot="docblocks/editor"] > ul[data-slot="docblocks/list"] > li');
}

async function insertType(page: Page, client: "a" | "b", type: string): Promise<void> {
  await page.getByTestId(`block-type-select-${client}`).selectOption(type);
  await page.getByTestId(`block-type-btn-${client}`).click();
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

  // Both panes seed their own first paragraph, so the room starts with two.
  await expect(inners(a, "a"), SETTLE).toHaveCount(2);
  const beforeInners = await inners(a, "a").count();

  const first = inners(a, "a").first();
  await first.click();
  await a.keyboard.type("hello world");
  await expect(inners(b, "b").first(), SETTLE).toHaveText("hello world");

  // Caret to offset 6, then split: "hello " / "world".
  await a.keyboard.press("End");
  await leftKeys(a, 5);
  await a.keyboard.press("Enter");

  await expect(inners(a, "a"), SETTLE).toHaveCount(beforeInners + 1);
  await expect(inners(b, "b"), SETTLE).toHaveCount(beforeInners + 1);
  await expect(inners(a, "a").first()).toHaveText("hello");
  await expect(inners(a, "a").nth(1)).toHaveText("world");
  await expect(inners(b, "b").first(), SETTLE).toHaveText("hello");
  await expect(inners(b, "b").nth(1), SETTLE).toHaveText("world");

  // The caret is in the new block at offset 0 — B's presence line shows it.
  const tailId = await inners(a, "a").nth(1).getAttribute("data-block-id");
  expect(tailId).not.toBe(null);
  await expect.poll(() => b.getByTestId("presence-b").innerText(), SETTLE).toContain(`a:${tailId}:0`);

  await close();
});

test("Backspace at the block start merges into the previous block", async ({ browser }) => {
  const { a, b, close } = await twoPanes(browser, "ui03b-backspace");

  // Both panes seed their own first paragraph, so the room starts with two.
  await expect(inners(a, "a"), SETTLE).toHaveCount(2);
  const beforeInners = await inners(a, "a").count();

  const first = inners(a, "a").first();
  await first.click();
  await a.keyboard.type("hello world");
  await a.keyboard.press("End");
  await leftKeys(a, 5);
  await a.keyboard.press("Enter");
  await expect(inners(a, "a"), SETTLE).toHaveCount(beforeInners + 1);

  const second = inners(a, "a").nth(1);
  await second.click();
  await a.keyboard.press("Home");
  await a.keyboard.press("Backspace");

  await expect(inners(a, "a"), SETTLE).toHaveCount(beforeInners);
  await expect(inners(a, "a").first()).toHaveText("hello world");
  await expect(inners(b, "b"), SETTLE).toHaveCount(beforeInners);
  await expect(inners(b, "b").first(), SETTLE).toHaveText("hello world");

  await close();
});

test("Tab nests the list item under the previous one; Shift+Tab un-nests", async ({ browser }) => {
  const { a, b, close } = await twoPanes(browser, "ui03b-tab");

  await insertType(a, "a", "list-item");
  await insertType(a, "a", "list-item");
  await expect(topLis(b, "b"), SETTLE).toHaveCount(2);

  // Caret in the second item, Tab: it moves into the first item's children.
  const secondInner = topLis(a, "a").nth(1).locator('[data-slot="docblocks/block-content"]');
  await secondInner.click();
  await a.keyboard.press("Tab");

  await expect(topLis(b, "b"), SETTLE).toHaveCount(1);
  const nested = topLis(b, "b").first().locator('ul[data-slot="docblocks/list"] > li');
  await expect(nested, SETTLE).toHaveCount(1);
  await expect(nested.first().locator('[data-slot="docblocks/block-content"]'), SETTLE).toHaveText("", SETTLE);

  // Shift+Tab in the nested item brings it back to the top level (click and
  // key on the same page: the caret must sit in the nested item there).
  const nestedInner = topLis(a, "a")
    .first()
    .locator('ul[data-slot="docblocks/list"] > li')
    .first()
    .locator('[data-slot="docblocks/block-content"]');
  await nestedInner.click();
  await a.keyboard.press("Shift+Tab");

  await expect(topLis(a, "a"), SETTLE).toHaveCount(2);
  await expect(topLis(b, "b"), SETTLE).toHaveCount(2);
  await expect(topLis(b, "b").first().locator("ul"), SETTLE).toHaveCount(0);

  await close();
});

test("gutter click selects the block; Delete removes it in both panes", async ({ browser }) => {
  const { a, b, close } = await twoPanes(browser, "ui03b-gutter");

  // Both panes seed their own first paragraph: two text blocks (the editor
  // root is not a rendered block wrapper).
  await expect(wrappers(a, "a"), SETTLE).toHaveCount(2);
  const before = 2;
  const wrapper = wrappers(a, "a").nth(1);
  const gutter = wrapper.locator('button[data-slot="docblocks/gutter"]');

  const wrapperId = (await wrapper.getAttribute("data-block-id")) ?? "";
  await wrapper.hover();
  await gutter.click();
  await expect(wrapper).toHaveAttribute("data-selected", "true");

  await a.keyboard.press("Delete");
  await expect(wrappers(a, "a"), SETTLE).toHaveCount(before - 1);
  await expect(wrappers(b, "b"), SETTLE).toHaveCount(before - 1);
  await expect(b.getByTestId(`block-b-${wrapperId}`)).toHaveCount(0);

  await close();
});
