import { type Browser, type Page, expect, test } from "@playwright/test";

import { insertBlockType } from "./helpers";

// Each test gets its own room via ?syncUrl= — the relay keeps rooms for the
// dev server's lifetime, so a shared room would be polluted by other spec
// files (and by manually opened tabs).
const RELAY = "ws://localhost:5199";
const SETTLE = { timeout: 15_000 };

async function openPane(page: Page, client: "a" | "b", room: string): Promise<void> {
  await page.goto(`/?client=${client}&syncUrl=${RELAY}/${room}`);
  await expect(page.getByTestId(`status-${client}`)).toHaveText("connected");
}

async function twoPanes(browser: Browser, room: string): Promise<{ a: Page; b: Page; close: () => Promise<void> }> {
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

/** The top-level editor of a pane (the non-catalog panes hold one editor). */
function editorOf(page: Page, client: "a" | "b") {
  return page.locator(`[data-testid="doc-${client}"] [data-slot="docblocks/editor"]`).first();
}

/** Click into a paragraph's inner and type the trigger phrase. */
async function typeMentionPhrase(page: Page, client: "a" | "b", blockId: string, phrase: string): Promise<void> {
  const inner = page.locator(
    `[data-testid="doc-${client}"] [data-block-id="${blockId}"][data-slot="docblocks/block-content"]`
  );
  await inner.click();
  await page.keyboard.type(phrase);
}

test("the @ trigger opens the picker and a user pick stands the chip in both panes", async ({ browser }) => {
  const { a, b, close } = await twoPanes(browser, "mention-user");
  const blockId = await insertBlockType(a, "a", "paragraph");
  await typeMentionPhrase(a, "a", blockId, "@Ada");

  // The picker stands (the people section over the demo provider).
  const picker = a.locator('[data-slot="docblocks/mention-menu"]');
  await expect.poll(async () => picker.isVisible(), SETTLE).toBe(true);
  await expect(picker.locator('[data-slot="docblocks/mention-users"]')).toBeVisible();
  const adaItem = picker.getByText("Ada Lovelace");
  await expect.poll(async () => adaItem.isVisible(), SETTLE).toBe(true);

  // The pick (a click): the phrase strips and the mention stands (one step).
  await adaItem.click();
  const editorA = editorOf(a, "a");
  const chipA = editorA.locator('[data-slot="docblocks/mention"]');
  await expect.poll(async () => chipA.count(), SETTLE).toBe(1);
  await expect(chipA).toHaveText("Ada Lovelace");
  await expect(chipA).toHaveAttribute("data-mention-kind", "user");

  // The pane B parity: the chip stands (the data syncs over the wire).
  const chipB = editorOf(b, "b").locator('[data-slot="docblocks/mention"]');
  await expect.poll(async () => chipB.count(), SETTLE).toBe(1);
  await expect(chipB).toHaveText("Ada Lovelace");
  await expect(chipB).toHaveAttribute("data-mention-kind", "user");

  // The JSON: the mention mark (the kind, the id, the label snapshot).
  const jsonA = a.getByTestId("json-a");
  await expect.poll(async () => (await jsonA.innerText()).includes('"mention"'), SETTLE).toBe(true);
  const jsonText = await jsonA.innerText();
  expect(jsonText).toContain('"kind": "user"');
  expect(jsonText).toContain('"id": "u1"');
  expect(jsonText).toContain('"label": "Ada Lovelace"');

  await close();
});

test("a doc pick stands the doc kind and the query filters the sections", async ({ browser }) => {
  const { a, b, close } = await twoPanes(browser, "mention-doc");
  const blockId = await insertBlockType(a, "a", "paragraph");
  await typeMentionPhrase(a, "a", blockId, "@Api");

  const picker = a.locator('[data-slot="docblocks/mention-menu"]');
  await expect.poll(async () => picker.isVisible(), SETTLE).toBe(true);
  // The query "Api" filters: the people section stands empty (no match), the
  // documents section stands the "API Reference".
  await expect.poll(async () => picker.getByText("API Reference").count(), SETTLE).toBe(1);
  await expect(picker.getByText("Ada Lovelace")).toHaveCount(0);

  await picker.getByText("API Reference").click();
  const chipA = editorOf(a, "a").locator('[data-slot="docblocks/mention"]');
  await expect.poll(async () => chipA.count(), SETTLE).toBe(1);
  await expect(chipA).toHaveText("API Reference");
  await expect(chipA).toHaveAttribute("data-mention-kind", "doc");
  await expect.poll(async () => editorOf(b, "b").locator('[data-slot="docblocks/mention"]').count(), SETTLE).toBe(1);

  await close();
});

test("the mention pick is one undo step (the @query text reverts)", async ({ browser }) => {
  const { a, close } = await twoPanes(browser, "mention-undo");
  const blockId = await insertBlockType(a, "a", "paragraph");
  await typeMentionPhrase(a, "a", blockId, "@Ada");
  const picker = a.locator('[data-slot="docblocks/mention-menu"]');
  await expect.poll(async () => picker.getByText("Ada Lovelace").isVisible(), SETTLE).toBe(true);
  await picker.getByText("Ada Lovelace").click();
  await expect.poll(async () => editorOf(a, "a").locator('[data-slot="docblocks/mention"]').count(), SETTLE).toBe(1);

  // The undo: the mention reverts to the `@Ada` phrase (one step).
  await a.keyboard.press("Control+z");
  const text = await a.evaluate(
    ({ client, id }) => {
      const docs = window.__paneDocs;
      const doc = (client === "a" ? docs?.a : docs?.b) ?? null;
      const block = doc?.getBlock(id);
      return block === null || block === undefined || !("content" in block)
        ? ""
        : block.content?.map((r) => r.text).join("");
    },
    { client: "a", id: blockId }
  );
  expect(text).toBe("@Ada");
  expect(await editorOf(a, "a").locator('[data-slot="docblocks/mention"]').count()).toBe(0);

  await close();
});

test("@ in a code block is plain text (no picker)", async ({ browser }) => {
  const { a, close } = await twoPanes(browser, "mention-code");
  const blockId = await insertBlockType(a, "a", "code");
  await typeMentionPhrase(a, "a", blockId, "@Ada");

  // The picker does not stand (code is excluded — the exclusion idiom).
  await a.waitForTimeout(300);
  expect(await a.locator('[data-slot="docblocks/mention-menu"]').count()).toBe(0);
  const text = await a.evaluate(
    ({ client, id }) => {
      const docs = window.__paneDocs;
      const doc = (client === "a" ? docs?.a : docs?.b) ?? null;
      const block = doc?.getBlock(id);
      return block === null || block === undefined || !("content" in block)
        ? ""
        : block.content?.map((r) => r.text).join("");
    },
    { client: "a", id: blockId }
  );
  expect(text).toBe("@Ada");

  await close();
});
