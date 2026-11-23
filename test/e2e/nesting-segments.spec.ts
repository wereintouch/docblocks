// The derived segment's gesture stands over the flat page model: Enter on
// an EMPTY root list item resets its type to a paragraph in place (the
// item's derived segment stands under the paragraph that takes its slot);
// Backspace at the start refuses to merge a block that owns a non-empty
// derived segment; a gutter selection + mod+shift+arrow moves the block
// together with its derived segment (one wire update each way).
import { type Page, expect, test } from "@playwright/test";

import { SETTLE, expectStays, outCount, rowsSettled, twoPanes } from "./helpers";

function pane(page: Page, client: "a" | "b") {
  return page.locator(`[data-testid="doc-${client}"]`);
}

/** The pane's root order (the flat sequence, the command API's view). */
async function rootIds(page: Page, client: "a" | "b"): Promise<string[]> {
  return page.evaluate(
    ({ client }) => {
      const d = window.__paneDocs?.[client];
      if (d === null || d === undefined) throw new Error("the pane's doc is not mounted");
      return d.getChildren(d.toJSON().id);
    },
    { client }
  );
}

/** One block's snapshot (the pane's live doc). */
async function blockOf(page: Page, client: "a" | "b", id: string) {
  return page.evaluate(
    ({ client, id }) => {
      const d = window.__paneDocs?.[client];
      if (d === null || d === undefined) throw new Error("the pane's doc is not mounted");
      return d.getBlock(id);
    },
    { client, id }
  );
}

/** One block's indent attr (absent is 0 — the writer omits the default). */
async function indentOf(page: Page, client: "a" | "b", id: string): Promise<number | undefined> {
  const block = await blockOf(page, client, id);
  const attrs = (block?.attrs ?? {}) as { indent?: number };
  return attrs.indent;
}

/** The flattened text of a block. */
async function textOf(page: Page, client: "a" | "b", id: string): Promise<string> {
  const block = await blockOf(page, client, id);
  return (block?.content ?? []).map((run) => run.text).join("");
}

/** The inner editable of a block (a descendant of the wrapper — the code block wraps it in the code body). */
function innerOf(page: Page, client: "a" | "b", id: string) {
  return pane(page, client).locator(
    `[data-slot="docblocks/block"][data-block-id="${id}"] [data-slot="docblocks/block-content"], [data-slot="docblocks/list-item"][data-block-id="${id}"] [data-slot="docblocks/block-content"]`
  );
}

test("an empty root list item + Enter resets its type in place (the segment stands)", async ({ browser }) => {
  const { a, b, close } = await twoPanes(browser, "empty-item-enter-reset");

  // The room starts with pane "a"'s single starter; the pane's doc handle
  // adds an EMPTY bullet item with a nested item (its derived segment) at
  // indent 1.
  const seeded = await a.evaluate(() => {
    const d = window.__paneDocs?.a ?? null;
    if (d === null) return null;
    const item = d.insertBlock("list-item", { list: "bullet" });
    const sub = d.insertBlock("list-item", { list: "bullet", indent: 1 });
    d.insertText(sub, 0, "the sublist");
    return { item, sub };
  });
  if (seeded === null) throw new Error("the pane's doc is not mounted");
  await rowsSettled(a);

  const outBefore = await outCount(a, "a");

  // Caret in the empty item, Enter: the root-level non-text block resets
  // its type to a plain paragraph IN PLACE (one updateBlock-class command,
  // one wire update) — the derived segment stands under the paragraph.
  await innerOf(a, "a", seeded.item).click();
  await a.keyboard.press("Enter");

  await expect.poll(async () => outCount(a, "a"), SETTLE).toBe(outBefore + 1);
  const after = await rootIds(a, "a");
  // The item's slot is a paragraph now (the same block id — the reset is
  // in place), the sublist and the starter stand.
  expect(after).toContain(seeded.item);
  expect(after).toContain(seeded.sub);
  expect(await blockOf(a, "a", seeded.item)).toMatchObject({ type: "paragraph" });
  expect(await textOf(a, "a", seeded.item)).toBe("");
  expect(await blockOf(a, "a", seeded.sub)).toMatchObject({ type: "list-item" });

  // The reset reached the other pane over the wire.
  await expect
    .poll(
      async () => (await b.evaluate((id) => window.__paneDocs?.b?.getBlock(id)?.type, seeded.item)) === "paragraph",
      SETTLE
    )
    .toBe(true);
  await expect.poll(async () => (await rootIds(b, "b")).some((id) => id === seeded.sub), SETTLE).toBe(true);

  // One undo step restores the list item.
  await innerOf(a, "a", seeded.item).click();
  await a.keyboard.press("Control+z");
  await expect
    .poll(
      async () => (await a.evaluate((id) => window.__paneDocs?.a?.getBlock(id)?.type, seeded.item)) === "list-item",
      SETTLE
    )
    .toBe(true);
  await expect.poll(async () => indentOf(a, "a", seeded.sub), SETTLE).toBe(1);

  await close();
});

test("Backspace at the start refuses to merge a block that owns a derived segment", async ({ browser }) => {
  const { a, close } = await twoPanes(browser, "backspace-merge-guard");

  const seeded = await a.evaluate(() => {
    const d = window.__paneDocs?.a ?? null;
    if (d === null) return null;
    const head = d.insertBlock("paragraph");
    d.insertText(head, 0, "the head");
    const block = d.insertBlock("paragraph");
    d.insertText(block, 0, "the blocked");
    const child = d.insertBlock("paragraph", { indent: 1 });
    d.insertText(child, 0, "the child");
    return { head, block, child };
  });
  if (seeded === null) throw new Error("the pane's doc is not mounted");
  await rowsSettled(a);

  const before = await rootIds(a, "a");
  const outBefore = await outCount(a, "a");

  // Caret at the blocked block's offset 0, Backspace: merging it into the
  // head would swallow its derived segment — the gesture is refused and
  // the browser default (nothing at the boundary) stands.
  await innerOf(a, "a", seeded.block).click();
  await a.keyboard.press("Home");
  await a.keyboard.press("Backspace");

  // The gesture's refusal: no doc update left the pane (the stand is held
  // over the settle window — a late commit lands after a single sample).
  await expectStays(async () => {
    expect(await outCount(a, "a")).toBe(outBefore);
  });
  // The doc stands: the order, the texts, the indent.
  await expect.poll(async () => rootIds(a, "a"), SETTLE).toEqual(before);
  expect(await textOf(a, "a", seeded.head)).toBe("the head");
  expect(await textOf(a, "a", seeded.block)).toBe("the blocked");
  expect(await indentOf(a, "a", seeded.child)).toBe(1);

  await close();
});

test("a gutter selection + mod+shift+arrow moves the block's derived segment", async ({ browser }) => {
  const { a, b, close } = await twoPanes(browser, "gutter-arrow-segment-move");

  const seeded = await a.evaluate(() => {
    const d = window.__paneDocs?.a ?? null;
    if (d === null) return null;
    const head = d.insertBlock("paragraph");
    d.insertText(head, 0, "segment head");
    const child = d.insertBlock("paragraph", { indent: 1 });
    d.insertText(child, 0, "segment child");
    const after = d.insertBlock("paragraph");
    d.insertText(after, 0, "after the segment");
    return { head, child, after };
  });
  if (seeded === null) throw new Error("the pane's doc is not mounted");
  await rowsSettled(a);

  const before = await rootIds(a, "a");
  const headIndex = before.indexOf(seeded.head);
  expect(before[headIndex + 1]).toBe(seeded.child);
  expect(before[headIndex + 2]).toBe(seeded.after);
  const outBefore = await outCount(a, "a");

  // Gutter click: a blocks selection on the head; mod+shift+ArrowDown
  // moves the segment (head + child) one slot down — the "after" row
  // comes first, the child stays indented (its indent stands).
  const wrapper = a.locator(`[data-block-id="${seeded.head}"]`).first();
  await wrapper.hover();
  await wrapper.locator('button[data-slot="docblocks/gutter"]').click();
  await expect(wrapper).toHaveAttribute("data-selected", "true");

  await a.keyboard.press("Control+Shift+ArrowDown");

  await expect.poll(async () => outCount(a, "a"), SETTLE).toBe(outBefore + 1);
  const afterOrder = await rootIds(a, "a");
  const newHeadIndex = afterOrder.indexOf(seeded.head);
  expect(afterOrder[newHeadIndex - 1]).toBe(seeded.after);
  expect(afterOrder[newHeadIndex + 1]).toBe(seeded.child);
  expect(await indentOf(a, "a", seeded.child)).toBe(1);
  // The selection follows the block to its new slot.
  await expect(wrapper).toHaveAttribute("data-selected", "true");

  // The move reached the other pane over the wire; mod+shift+ArrowUp
  // brings the segment back (one transact each way).
  await expect.poll(async () => (await rootIds(b, "b")).indexOf(seeded.head), SETTLE).toBe(newHeadIndex);
  await a.keyboard.press("Control+Shift+ArrowUp");
  await expect.poll(async () => outCount(a, "a"), SETTLE).toBe(outBefore + 2);
  await expect.poll(async () => rootIds(a, "a"), SETTLE).toEqual(before);
  await expect.poll(async () => rootIds(b, "b"), SETTLE).toEqual(before);

  await close();
});
