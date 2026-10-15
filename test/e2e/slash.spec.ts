import { type Browser, type Page, expect, test } from "@playwright/test";

const RELAY = "ws://localhost:5199";

/**
 * A unique room per test: the relay keeps rooms for the dev server's
 * lifetime, so a fixed name would accumulate the content of failed attempts
 * across runs.
 */
async function openPanes(browser: Browser, seed: string): Promise<{ a: Page; b: Page; close: () => Promise<void> }> {
  const room = `${seed}-${Math.random().toString(36).slice(2, 8)}`;
  const contextA = await browser.newContext();
  const contextB = await browser.newContext();
  const a = await contextA.newPage();
  const b = await contextB.newPage();
  await a.goto(`/?client=a&syncUrl=${RELAY}/${room}`);
  await expect(a.getByTestId("status-a")).toHaveText("connected");
  await b.goto(`/?client=b&syncUrl=${RELAY}/${room}`);
  await expect(b.getByTestId("status-b")).toHaveText("connected");
  return {
    a,
    b,
    close: async () => {
      await contextA.close();
      await contextB.close();
    },
  };
}

function inner(page: Page, client: "a" | "b") {
  return page.locator(`[data-testid="doc-${client}"] [data-slot="docblocks/block-content"]`).first();
}

function menu(page: Page) {
  return page.locator('[data-slot="docblocks/slash-menu"]');
}

/**
 * The pane seeds a single empty paragraph, so the slash trigger (an empty,
 * root-level block) is available in the seeded state.
 */

test("slash: / opens the command menu; the query filters; Enter converts the empty block", async ({ browser }) => {
  const { a, b, close } = await openPanes(browser, "ux01-slash");
  await inner(a, "a").click();
  await a.keyboard.press("/");

  const m = menu(a);
  await expect(m).toBeVisible();
  await expect(m.locator('[role="menuitem"]')).toHaveCount(12);

  // The menu anchors at the triggering block's top-left (the old inline
  // geometry, now the radix content over the zero-size trigger).
  const menuBox = await m.boundingBox();
  const blockBox = await a
    .locator('[data-block-type="paragraph"]')
    .first()
    .locator('[data-slot="docblocks/block-content"]')
    .boundingBox();
  if (menuBox !== null && blockBox !== null) {
    expect(Math.abs(menuBox.x - blockBox.x)).toBeLessThanOrEqual(4);
    expect(Math.abs(menuBox.y - blockBox.y)).toBeLessThanOrEqual(4);
  }

  // The typed query filters the list (case-insensitive substring).
  await a.keyboard.type("head");
  await expect(m.locator('[role="menuitem"]')).toHaveCount(3);
  await expect(m.locator('[role="menuitem"]')).toHaveText(["Heading 1", "Heading 2", "Heading 3"]);

  // ArrowDown moves the active item; Enter applies it (Heading 2).
  await a.keyboard.press("ArrowDown");
  await a.keyboard.press("Enter");
  await expect(m).toHaveCount(0);

  // The block converted in place to a level-2 heading (the h2 tag) and the
  // typed query never reached the doc: the converted block has no text.
  const heading = a.locator('[data-testid="doc-a"] h2[data-block-type="heading"]');
  await expect(heading).toHaveCount(1);
  await expect(heading.locator('[data-slot="docblocks/block-content"]')).toHaveText("");

  // The conversion reached the other pane (the doc-level sync).
  await expect(b.locator('[data-testid="doc-b"] h2[data-block-type="heading"]')).toHaveCount(1);
  await close();
});

test("slash: Escape closes the menu without touching the doc", async ({ browser }) => {
  const { a, close } = await openPanes(browser, "ux02-slash-esc");
  await inner(a, "a").click();
  await a.keyboard.press("/");
  await expect(menu(a)).toBeVisible();

  await a.keyboard.press("Escape");
  await expect(menu(a)).toHaveCount(0);

  // The doc is untouched: the room's starter paragraph is still empty
  // (the "/" character was never inserted).
  await expect(a.locator('[data-testid="doc-a"] [data-block-type="paragraph"]')).toHaveCount(1);
  await expect(inner(a, "a")).toHaveText("");
  await close();
});

test("slash: a click picks the command", async ({ browser }) => {
  const { a, close } = await openPanes(browser, "ux03-slash-click");
  await inner(a, "a").click();
  await a.keyboard.press("/");
  await expect(menu(a)).toBeVisible();

  // The accessible name is the item's label text.
  await menu(a).getByRole("menuitem", { name: "Callout" }).click();
  await expect(menu(a)).toHaveCount(0);
  await expect(a.locator('[data-testid="doc-a"] [data-block-type="callout"]')).toHaveCount(1);
  await close();
});

test("slash: a non-empty block does not open the menu (the / is plain text)", async ({ browser }) => {
  const { a, close } = await openPanes(browser, "ux04-slash-nonempty");
  await inner(a, "a").click();
  await a.keyboard.type("hello");
  await a.keyboard.press("/");

  // No menu; the "/" is a plain character in the text.
  await expect(menu(a)).toHaveCount(0);
  await expect(inner(a, "a")).toHaveText("hello/");
  await close();
});
