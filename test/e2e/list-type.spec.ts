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

/** The pane's floating format toolbar (absent while no eligible range is selected). */
function toolbar(page: Page, client: "a" | "b") {
  return pane(page, client).locator('[data-slot="docblocks/format-toolbar"]');
}

/** The pane's root entry-list ids (plain values across the evaluate bridge). */
async function rootIds(page: Page, client: "a" | "b"): Promise<string[]> {
  return page.evaluate((c) => {
    const d = window.__paneDocs?.[c];
    if (d === null || d === undefined) throw new Error(`the ${c} pane's doc is not mounted`);
    return d.getChildren(d.toJSON().id);
  }, client);
}

/** A block's plain snapshot (the doc object itself never crosses the bridge). */
async function blockOf(
  page: Page,
  client: "a" | "b",
  id: string
): Promise<{ type: string; attrs?: Record<string, unknown> } | null> {
  return page.evaluate(
    ({ c, id }) => {
      const d = window.__paneDocs?.[c];
      if (d === null || d === undefined) throw new Error(`the ${c} pane's doc is not mounted`);
      return d.getBlock(id);
    },
    { c: client, id }
  );
}

/** The children ids of a block (plain values across the bridge). */
async function childrenOf(page: Page, client: "a" | "b", id: string): Promise<string[] | null> {
  return page.evaluate(
    ({ c, id }) => {
      const d = window.__paneDocs?.[c];
      if (d === null || d === undefined) throw new Error(`the ${c} pane's doc is not mounted`);
      return d.getBlock(id) === null ? null : (d.toJSON().blocks[id]?.children ?? []);
    },
    { c: client, id }
  );
}

/** Type the fixture text into the seeded paragraph and select the whole line. */
async function typeAndSelectAll(page: Page, client: "a" | "b"): Promise<void> {
  const inner = pane(page, client).locator('[data-slot="docblocks/block-content"]').first();
  await inner.click();
  await page.keyboard.type("hello world");
  // The caret is at the end; Shift+Home selects the whole line.
  await page.keyboard.down("Shift");
  await page.keyboard.press("Home");
  await page.keyboard.up("Shift");
}

/** The wire log's outbound doc-update count. */
async function outCount(page: Page, client: "a" | "b"): Promise<number> {
  const text = await page.getByTestId(`wire-${client}`).innerText();
  return text.match(/\] out \d+B/g)?.length ?? 0;
}

async function twoPanes(browser: Browser, seed: string): Promise<{ a: Page; b: Page; close: () => Promise<void> }> {
  const room = `${seed}-${Math.random().toString(36).slice(2, 8)}`;
  const contextA = await browser.newContext();
  const contextB = await browser.newContext();
  const a = await contextA.newPage();
  const b = await contextB.newPage();
  await openPane(a, "a", room);
  await openPane(b, "b", room);
  return {
    a,
    b,
    close: async () => {
      await contextA.close();
      await contextB.close();
    },
  };
}

test("the toolbar menu turns a paragraph into a list and back (one undo step)", async ({ browser }) => {
  const { a, b, close } = await twoPanes(browser, "c4-para-list");
  await typeAndSelectAll(a, "a");
  const bar = toolbar(a, "a");
  await expect(bar).toBeVisible(SETTLE);

  await bar.locator('button[aria-label="List type"]').click();
  // The menu content is portaled to the document body (radix), so the
  // locator is page-scoped.
  const menu = a.locator('[data-slot="docblocks/format-list-menu"]');
  await expect(menu.locator('[data-list-option="number"]')).toBeVisible();
  await menu.locator('[data-list-option="number"]').click();

  // The block is a numbered list item (the text survived the change).
  const id = (await rootIds(a, "a"))[0];
  const block = await blockOf(a, "a", id);
  expect(block?.type).toBe("list-item");
  expect(block?.attrs).toMatchObject({ list: "number" });
  await expect(pane(a, "a").locator("ol").first()).toContainText("hello world");

  // The other pane sees the same block over the wire.
  const blockB = await blockOf(b, "b", id);
  expect(blockB?.type).toBe("list-item");
  expect(blockB?.attrs).toMatchObject({ list: "number" });

  // One undo step restores the paragraph (the change was one command).
  // The type change swapped the wrapper tag (div -> li) and remounted the
  // block: the gesture re-seats the selection on the rebuilt block, so the
  // undo hotkey reaches the doc without a re-focus.
  await a.keyboard.press("Control+z");
  expect((await blockOf(a, "a", id))?.type).toBe("paragraph");
  await expect(pane(a, "a").locator("ol")).toHaveCount(0, SETTLE);
  await expect(pane(a, "a")).toContainText("hello world", SETTLE);

  await close();
});

test("the toolbar menu swaps a list item's kind (an attr update, the type stands)", async ({ browser }) => {
  const { a, b, close } = await twoPanes(browser, "c4-list-swap");
  await typeAndSelectAll(a, "a");

  // Turn the paragraph into a bullet list first.
  const bar = toolbar(a, "a");
  await expect(bar).toBeVisible(SETTLE);
  await bar.locator('button[aria-label="List type"]').click();
  await a.locator('[data-slot="docblocks/format-list-menu"] [data-list-option="bullet"]').click();
  const id = (await rootIds(a, "a"))[0];
  expect(await blockOf(a, "a", id)).toMatchObject({ type: "list-item", attrs: { list: "bullet" } });

  // The selection survived the change: the menu shows the new active kind
  // (the radix radio state).
  await bar.locator('button[aria-label="List type"]').click();
  const menu = a.locator('[data-slot="docblocks/format-list-menu"]');
  await expect(menu.locator('[data-list-option="bullet"]')).toHaveAttribute("data-state", "checked");
  await menu.locator('[data-list-option="task"]').click();

  expect(await blockOf(a, "a", id)).toMatchObject({ type: "list-item", attrs: { list: "task" } });
  // The task affordance appears in both panes.
  await expect(pane(a, "a").locator('[data-slot="docblocks/checkbox"]')).toHaveCount(1, SETTLE);
  await expect(pane(b, "b").locator('[data-slot="docblocks/checkbox"]')).toHaveCount(1, SETTLE);

  await close();
});

test("the text option is disabled for a list item with children", async ({ browser }) => {
  const { a, close } = await twoPanes(browser, "c4-with-children");
  // Seed a bullet item with a nested child.
  const ids = await a.evaluate(() => {
    const doc = window.__paneDocs?.a;
    if (doc === null || doc === undefined) throw new Error("the pane's doc is not mounted");
    const parent = doc.insertBlock("list-item", { list: "bullet" });
    doc.insertText(parent, 0, "parent");
    const child = doc.insertBlock("list-item", { list: "bullet" }, { parent });
    doc.insertText(child, 0, "child");
    return { parent, child };
  });
  await a.waitForTimeout(600); // the enter animations settle (boxes move with them)

  // Select the parent's text (the first matching inner is the parent's own).
  const parentInner = pane(a, "a")
    .locator(`[data-block-id="${ids.parent}"] [data-slot="docblocks/block-content"]`)
    .first();
  await parentInner.click();
  await a.keyboard.down("Shift");
  await a.keyboard.press("Home");
  await a.keyboard.up("Shift");

  const bar = toolbar(a, "a");
  await expect(bar).toBeVisible(SETTLE);
  await bar.locator('button[aria-label="List type"]').click();
  const textOption = a.locator('[data-slot="docblocks/format-list-menu"] [data-list-option="paragraph"]');
  await expect(textOption).toBeDisabled();
  // A disabled option takes no click: the type and the child stand.
  await textOption.click({ force: true }).catch(() => {});
  expect((await blockOf(a, "a", ids.parent))?.type).toBe("list-item");
  expect(await childrenOf(a, "a", ids.parent)).toEqual([ids.child]);

  await close();
});

test("a childless list item becomes text through the menu", async ({ browser }) => {
  const { a, b, close } = await twoPanes(browser, "c4-to-text");
  const id = await a.evaluate(() => {
    const doc = window.__paneDocs?.a;
    if (doc === null || doc === undefined) throw new Error("the pane's doc is not mounted");
    const li = doc.insertBlock("list-item", { list: "bullet" });
    doc.insertText(li, 0, "standalone item");
    return li;
  });
  await a.waitForTimeout(600); // the enter animations settle (boxes move with them)

  const inner = pane(a, "a").locator(`[data-block-id="${id}"] [data-slot="docblocks/block-content"]`).first();
  await inner.click();
  await a.keyboard.down("Shift");
  await a.keyboard.press("Home");
  await a.keyboard.up("Shift");

  const bar = toolbar(a, "a");
  await expect(bar).toBeVisible(SETTLE);
  await bar.locator('button[aria-label="List type"]').click();
  await a.locator('[data-slot="docblocks/format-list-menu"] [data-list-option="paragraph"]').click();

  expect((await blockOf(a, "a", id))?.type).toBe("paragraph");
  // The list wrapper is gone in both panes (the change traveled the wire).
  await expect(pane(a, "a").locator("ol, ul")).toHaveCount(0, SETTLE);
  await expect(pane(b, "b").locator("ol, ul")).toHaveCount(0, SETTLE);
  await expect(pane(b, "b").locator(`[data-block-id="${id}"]`).first()).toContainText("standalone item", SETTLE);

  await close();
});

test("collapse hides the children locally (no wire traffic, the other pane stands)", async ({ browser }) => {
  const { a, b, close } = await twoPanes(browser, "c4-collapse");
  const ids = await a.evaluate(() => {
    const doc = window.__paneDocs?.a;
    if (doc === null || doc === undefined) throw new Error("the pane's doc is not mounted");
    const parent = doc.insertBlock("list-item", { list: "bullet" });
    doc.insertText(parent, 0, "parent");
    const child = doc.insertBlock("list-item", { list: "bullet" }, { parent });
    doc.insertText(child, 0, "child");
    return { parent, child };
  });
  await a.waitForTimeout(600); // the enter animations settle (boxes move with them)

  const toggle = pane(a, "a").locator(`[data-block-id="${ids.parent}"] > button[data-slot="docblocks/collapse"]`);
  await expect(toggle).toBeVisible();
  await expect(pane(a, "a").locator(`[data-block-id="${ids.child}"]`).first()).toBeVisible();
  await expect(pane(b, "b").locator(`[data-block-id="${ids.child}"]`).first()).toBeVisible(SETTLE);
  const wireA = await outCount(a, "a");

  await toggle.click();

  await expect(pane(a, "a").locator(`[data-block-id="${ids.child}"]`).first()).toHaveCount(0);
  // The other pane keeps the child (the collapse is view state, per pane).
  await expect(pane(b, "b").locator(`[data-block-id="${ids.child}"]`).first()).toBeVisible();
  // The toggle issued no doc update (the wire log stands).
  expect(await outCount(a, "a")).toBe(wireA);

  await toggle.click();
  await expect(pane(a, "a").locator(`[data-block-id="${ids.child}"]`).first()).toBeVisible();
  expect(await childrenOf(a, "a", ids.parent)).toEqual([ids.child]);

  await close();
});
