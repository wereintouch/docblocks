import { type Browser, type Page, expect, test } from "@playwright/test";

import { insertBlockType } from "./helpers";

// Tab / Shift+Tab nesting of arbitrary blocks. Every
// text block holds the full page set as children; Tab indents a block
// under its previous sibling (a registry container), Shift+Tab outdents
// it to right after its parent. The code block keeps the typewriter Tab.
//
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

/** The pane's top-level block ids (reading order), from the live doc. */
async function rootIds(page: Page, client: "a" | "b"): Promise<string[]> {
  const ids = await page.evaluate(
    ({ client }) => {
      const json = window.__paneDocs?.[client]?.toJSON();
      if (json === undefined || json === null) return [];
      const root = json.blocks[json.id];
      return root?.children ?? [];
    },
    { client }
  );
  return ids;
}

/** The children of a block (reading order) in the pane's live doc; null when absent/empty. */
async function childrenOf(page: Page, client: "a" | "b", id: string): Promise<string[] | null> {
  const ids = await page.evaluate(
    ({ client, id }) => {
      const json = window.__paneDocs?.[client]?.toJSON();
      if (json === undefined || json === null) return null;
      return json.blocks[id]?.children ?? null;
    },
    { client, id }
  );
  return ids;
}

/** The flattened text of a block (the run texts joined). */
async function textOf(page: Page, client: "a" | "b", id: string): Promise<string> {
  const text = await page.evaluate(
    ({ client, id }) => {
      const json = window.__paneDocs?.[client]?.toJSON();
      if (json === undefined || json === null) return "";
      return json.blocks[id]?.content?.reduce((t, run) => t + run.text, "") ?? "";
    },
    { client, id }
  );
  return text;
}

/** The inner editable of a block wrapper (direct child: the inners of the block's own descendants carry the same data-block-id on their wrappers). */
function innerOf(page: Page, client: "a" | "b", id: string) {
  return pane(page, client).locator(
    `[data-slot="docblocks/block"][data-block-id="${id}"] > [data-slot="docblocks/block-content"]`
  );
}

/**
 * Wait until the block's inner is unique in the DOM: a structural move
 * remounts the entry (the framer exit of the old position lingers a frame),
 * so a click right after the move can hit the transient duplicate.
 */
async function settled(page: Page, client: "a" | "b", id: string): Promise<void> {
  await expect(innerOf(page, client, id), SETTLE).toHaveCount(1);
}

/** The `out` (local) doc-update count of the wire log (awareness frames are not logged). */
async function outCount(page: Page): Promise<number> {
  const text = await page.getByTestId("wire-a").innerText();
  return text.match(/\] out \d+B/g)?.length ?? 0;
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

test("Tab indents the second paragraph under the first; one mod+z reverts it", async ({ browser }) => {
  const { a, b, close } = await twoPanes(browser, "c5c-indent");

  // Both panes seed their own first paragraph, so the room starts with two.
  // Both panes seed their own first paragraph; B's seed may lag under
  // parallel-suite load, so poll for the shared pair.
  await expect.poll(async () => rootIds(a, "a"), SETTLE).toHaveLength(2);
  const root = await rootIds(a, "a");
  const [firstId, secondId] = root;

  const outBefore = await outCount(a);
  await innerOf(a, "a", secondId).click();
  await a.keyboard.press("Tab");

  // The structural move is one wire update.
  await expect.poll(async () => outCount(a), SETTLE).toBe(outBefore + 1);
  // Pane B's JSON shows the child (over the wire).
  await expect.poll(async () => childrenOf(b, "b", firstId), SETTLE).toEqual([secondId]);

  // The nested wrapper renders with the indent (the list-indent token:
  // 1.5em at the editor's 16px font size).
  const nested = a.locator(`[data-block-id="${firstId}"] [data-slot="docblocks/nested"]`);
  await expect(nested).toHaveCount(1);
  expect(await nested.evaluate((el) => getComputedStyle(el).paddingLeft)).toBe("24px");
  await settled(a, "a", firstId);

  // One mod+z reverts the indent (one undo step). The hotkey fires only
  // for keys targeted inside the editor root — after the move the focused
  // element was remounted (focus dropped to the body), so click back in.
  await innerOf(a, "a", firstId).click();
  await a.keyboard.press("Control+z");
  await expect.poll(async () => rootIds(a, "a"), SETTLE).toEqual([firstId, secondId]);
  await expect(a.locator('[data-slot="docblocks/nested"]')).toHaveCount(0);

  await close();
});

test("Shift+Tab outdents the indented paragraph back to the top level (after the parent)", async ({ browser }) => {
  const { a, b, close } = await twoPanes(browser, "c5c-outdent");

  // Both panes seed their own first paragraph; B's seed may lag under
  // parallel-suite load, so poll for the shared pair.
  await expect.poll(async () => rootIds(a, "a"), SETTLE).toHaveLength(2);
  const root = await rootIds(a, "a");
  const [firstId, secondId] = root;

  // Indent the second paragraph under the first.
  await innerOf(a, "a", secondId).click();
  await a.keyboard.press("Tab");
  await expect.poll(async () => childrenOf(a, "a", firstId), SETTLE).toEqual([secondId]);

  // Caret in the indented paragraph (now inside the parent's nested slot),
  // Shift+Tab: it lands right after the parent, at the top level.
  await settled(a, "a", secondId);
  await innerOf(a, "a", secondId).click();
  await a.keyboard.press("Shift+Tab");

  await expect.poll(async () => rootIds(a, "a"), SETTLE).toEqual([firstId, secondId]);
  await expect.poll(async () => rootIds(b, "b"), SETTLE).toEqual([firstId, secondId]);
  await expect(a.locator('[data-slot="docblocks/nested"]')).toHaveCount(0);
  await expect(b.locator('[data-slot="docblocks/nested"]'), SETTLE).toHaveCount(0);

  await close();
});

test("Tab whose previous sibling is a non-container (divider) is a no-op", async ({ browser }) => {
  const { a, close } = await twoPanes(browser, "c5c-noop");

  // Both panes seed their own first paragraph; B's seed may lag under
  // parallel-suite load, so poll for the shared pair.
  await expect.poll(async () => rootIds(a, "a"), SETTLE).toHaveLength(2);

  // A divider, then a paragraph: the paragraph's previous sibling is the
  // divider (no children of its own).
  await insertBlockType(a, "a", "divider");
  await insertBlockType(a, "a", "paragraph");
  const after = await rootIds(a, "a");
  expect(after).toHaveLength(4);
  const lastId = after[after.length - 1]!;

  await innerOf(a, "a", lastId).click();
  await a.keyboard.press("Tab");

  // No JSON change (no children anywhere), no nested slot, the order stands.
  await expect.poll(async () => rootIds(a, "a"), SETTLE).toEqual(after);
  expect(await childrenOf(a, "a", lastId)).toBeNull();
  await expect(a.locator('[data-slot="docblocks/nested"]')).toHaveCount(0);

  await close();
});

test("Tab in a code block inserts a tab character (no move)", async ({ browser }) => {
  const { a, b, close } = await twoPanes(browser, "c5c-code-tab");

  // Both panes seed their own first paragraph; B's seed may lag under
  // parallel-suite load, so poll for the shared pair.
  await expect.poll(async () => rootIds(a, "a"), SETTLE).toHaveLength(2);

  await insertBlockType(a, "a", "code");
  const after = await rootIds(a, "a");
  expect(after).toHaveLength(3);
  const codeId = after[after.length - 1]!;

  await innerOf(a, "a", codeId).click();
  await a.keyboard.type("abc");
  await a.keyboard.press("Tab");

  // The tab character is in the text (one run), in both panes — NOT a
  // structural move: the root order stands, no nested slot.
  await expect.poll(async () => textOf(a, "a", codeId), SETTLE).toBe("abc\t");
  await expect.poll(async () => textOf(b, "b", codeId), SETTLE).toBe("abc\t");
  await expect.poll(async () => rootIds(a, "a"), SETTLE).toEqual(after);
  expect(await childrenOf(a, "a", codeId)).toBeNull();
  await expect(a.locator('[data-slot="docblocks/nested"]')).toHaveCount(0);

  await close();
});

test("an indented block syncs to the other pane and survives an undo/redo cycle", async ({ browser }) => {
  const { a, b, close } = await twoPanes(browser, "c5c-undo-redo");

  // Both panes seed their own first paragraph; B's seed may lag under
  // parallel-suite load, so poll for the shared pair.
  await expect.poll(async () => rootIds(a, "a"), SETTLE).toHaveLength(2);
  const root = await rootIds(a, "a");
  const [firstId, secondId] = root;

  const outBefore = await outCount(a);
  await innerOf(a, "a", secondId).click();
  await a.keyboard.press("Tab");
  // The structural move is one wire update (one undo step).
  await expect.poll(async () => outCount(a), SETTLE).toBe(outBefore + 1);
  await expect.poll(async () => childrenOf(b, "b", firstId), SETTLE).toEqual([secondId]);

  // Undo: the indent reverts in both panes (click back in for the hotkey —
  // the move remounted the focused element).
  await settled(a, "a", firstId);
  await innerOf(a, "a", firstId).click();
  await a.keyboard.press("Control+z");
  await expect.poll(async () => rootIds(a, "a"), SETTLE).toEqual([firstId, secondId]);
  await expect.poll(async () => rootIds(b, "b"), SETTLE).toEqual([firstId, secondId]);

  // Redo: the indent comes back in both panes (focus stayed in the first
  // paragraph's inner — that element did not move).
  await a.keyboard.press("Control+Shift+z");
  await expect.poll(async () => childrenOf(a, "a", firstId), SETTLE).toEqual([secondId]);
  await expect.poll(async () => childrenOf(b, "b", firstId), SETTLE).toEqual([secondId]);
  await expect(b.locator(`[data-block-id="${firstId}"] [data-slot="docblocks/nested"]`), SETTLE).toHaveCount(1);

  await close();
});
