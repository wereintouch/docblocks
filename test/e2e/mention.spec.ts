// The @ mention's picker's behavior: the trigger's open + the pick's chip over both panes, the
// query's space + the Enter pick's caret seat, the mid-line pick, the doc kind + the query's
// sections' filter, and the pick's one undo step.
import { expect, test } from "@playwright/test";

import { SETTLE, insertBlockType, twoPanes } from "./helpers";
import { editorOf, typeMentionPhrase } from "./mention-helpers";

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
