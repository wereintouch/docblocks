import { type Page, expect, test } from "@playwright/test";

import { SETTLE, insertBlockType, twoPanes } from "./helpers";

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

  // The JSON: the mention mark (the kind + the id — the id-only stand, the
  // label is the run's text + the consumer's resolution, never the mark).
  const jsonA = a.getByTestId("json-a");
  await expect.poll(async () => (await jsonA.innerText()).includes('"mention"'), SETTLE).toBe(true);
  const jsonText = await jsonA.innerText();
  expect(jsonText).toContain('"kind": "user"');
  expect(jsonText).toContain('"id": "u1"');
  expect(jsonText).not.toContain('"label"');

  // The pick's seat: the caret stands after the chip (the type's
  // continuation keeps the editable — no re-click).
  await a.keyboard.type(" typed");
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
  expect(text).toBe("Ada Lovelace typed");

  await close();
});

test("the space stands the query (the picker over the @word phrase) and the Enter pick seats the caret", async ({
  browser,
}) => {
  const { a, b, close } = await twoPanes(browser, "mention-space");
  const blockId = await insertBlockType(a, "a", "paragraph");
  // The space is part of the query (the `Ada L`'s search, not the `Ada`'s
  // — the picker stays open over the phrase's continuation).
  await typeMentionPhrase(a, "a", blockId, "@Ada L");

  const picker = a.locator('[data-slot="docblocks/mention-menu"]');
  await expect.poll(async () => picker.isVisible(), SETTLE).toBe(true);
  const adaItem = picker.getByText("Ada Lovelace");
  await expect.poll(async () => adaItem.isVisible(), SETTLE).toBe(true);

  // The Enter's pick (the keyboard's stand): the chip over the whole
  // phrase (the `@Ada L`'s stand strips) + the caret after it (the type's
  // continuation stands the chip's end, not the document's loss).
  await a.keyboard.press("Enter");
  const chipA = editorOf(a, "a").locator('[data-slot="docblocks/mention"]');
  await expect.poll(async () => chipA.count(), SETTLE).toBe(1);
  await expect(chipA).toHaveText("Ada Lovelace");
  await a.keyboard.type(" after");
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
  expect(text).toBe("Ada Lovelace after");

  // The pane B's parity: the chip stands (the data syncs over the wire).
  await expect.poll(async () => editorOf(b, "b").locator('[data-slot="docblocks/mention"]').count(), SETTLE).toBe(1);

  await close();
});

test("a mid-line pick seats the caret in the following text (not the block's end)", async ({ browser }) => {
  const { a, close } = await twoPanes(browser, "mention-midline");
  const blockId = await insertBlockType(a, "a", "paragraph");
  const inner = a.locator(`[data-testid="doc-a"] [data-block-id="${blockId}"][data-slot="docblocks/block-content"]`);
  await inner.click();
  await a.keyboard.type("hello world");
  // The caret before "world": the mention lands mid-line and the trailing
  // text survives the pick.
  for (let i = 0; i < 5; i += 1) await a.keyboard.press("ArrowLeft");
  await a.keyboard.type("@Ada");
  const picker = a.locator('[data-slot="docblocks/mention-menu"]');
  await expect.poll(async () => picker.getByText("Ada Lovelace").isVisible(), SETTLE).toBe(true);
  await picker.getByText("Ada Lovelace").click();
  await expect.poll(async () => editorOf(a, "a").locator('[data-slot="docblocks/mention"]').count(), SETTLE).toBe(1);

  // The seat: the chip's adjacent trailing text's start (the island's
  // element slot is the last resort — engines place a caret next to a
  // contenteditable=false island unreliably).
  const seat = await a.evaluate((id) => {
    const selection = window.getSelection();
    const el = document.querySelector<HTMLElement>(
      `[data-testid="doc-a"] [data-block-id="${id}"][data-slot="docblocks/block-content"]`
    );
    if (selection === null || selection.rangeCount === 0 || el === null) return null;
    const range = selection.getRangeAt(0);
    if (!el.contains(range.startContainer)) return null;
    const text = range.startContainer.textContent ?? "";
    return { text, offset: range.startOffset };
  }, blockId);
  expect(seat).toEqual({ text: "world", offset: 0 });

  // The continuation stands mid-line (not appended to the block's end).
  await a.keyboard.type("X");
  const text = await a.evaluate((id) => {
    const docs = window.__paneDocs;
    const doc = docs?.a ?? null;
    const block = doc?.getBlock(id);
    return block === null || block === undefined || !("content" in block)
      ? ""
      : block.content?.map((run) => run.text).join("");
  }, blockId);
  expect(text).toBe("hello Ada LovelaceXworld");

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

test("the chip stands as plain text (the kind's icon, bold + underline, the row height unchanged)", async ({
  browser,
}) => {
  const { a, close } = await twoPanes(browser, "mention-stand");
  // The plain baseline row + the mention row (a user pick over `@Ada`).
  const plainId = await insertBlockType(a, "a", "paragraph");
  const plainInner = a.locator(
    `[data-testid="doc-a"] [data-block-id="${plainId}"][data-slot="docblocks/block-content"]`
  );
  await plainInner.click();
  await a.keyboard.type("plain text line");

  const mentionId = await insertBlockType(a, "a", "paragraph");
  await typeMentionPhrase(a, "a", mentionId, "@Ada");
  const picker = a.locator('[data-slot="docblocks/mention-menu"]');
  await expect.poll(async () => picker.getByText("Ada Lovelace").isVisible(), SETTLE).toBe(true);
  await picker.getByText("Ada Lovelace").click();

  const chip = editorOf(a, "a").locator(`[data-block-id="${mentionId}"] [data-slot="docblocks/mention"]`);
  await expect.poll(async () => chip.count(), SETTLE).toBe(1);

  // The stand: the kind's decorative inline icon + the label (the chip
  // carries the target id for the consumer's live-label stands).
  await expect(chip.locator("svg")).toHaveCount(1);
  await expect(chip).toHaveAttribute("data-mention-id", "u1");

  // The computed stand: the semibold + the underline, no pill of its own.
  const style = await chip.evaluate((el) => {
    const cs = window.getComputedStyle(el);
    return { weight: cs.fontWeight, line: cs.textDecorationLine, background: cs.backgroundColor };
  });
  expect(style.weight).toBe("600");
  expect(style.line).toBe("underline");
  expect(style.background).toBe("rgba(0, 0, 0, 0)");

  // The row height: the mention row stands the plain row's height (the
  // chip is an inline run — no box of its own over the text line).
  const [plainHeight, mentionHeight] = await a.evaluate(
    ({ plain, mention }) => {
      const row = (id: string) => document.querySelector<HTMLElement>(`[data-block-id="${id}"]`);
      return [row(plain)!.getBoundingClientRect().height, row(mention)!.getBoundingClientRect().height];
    },
    { plain: plainId, mention: mentionId }
  );
  expect(Math.abs(plainHeight - mentionHeight)).toBeLessThanOrEqual(0.5);

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

test("@ after a character is plain text (no picker — the email's stand)", async ({ browser }) => {
  const { a, close } = await twoPanes(browser, "mention-email");
  const blockId = await insertBlockType(a, "a", "paragraph");
  // The email: the `@` at a non-boundary (after a letter) declines the
  // trigger — the picker must not stand while the email is typed.
  await typeMentionPhrase(a, "a", blockId, "john@yandex.ru");

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
  expect(text).toBe("john@yandex.ru");

  await close();
});
