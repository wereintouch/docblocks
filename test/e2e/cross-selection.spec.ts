import { expect, test } from "@playwright/test";

import {
  blockOf,
  blocksOf,
  domSelection,
  inners,
  selectAcrossBlocks,
  toolbar,
  typeTwoBlocks,
} from "./cross-selection-helpers";
import { SETTLE, insertBlockType, twoPanes } from "./helpers";

// The two-pane's settle stands the default 30s budget at its edge (the 15s
// SETTLE's panes + the page loads): the raised budget keeps the timeout
// class out of the loaded machine's flake zone (a true stall stays visible).
test.setTimeout(45_000);

test("a cross-block selection raises the toolbar; bold marks the per-block segments", async ({ browser }) => {
  const { a, b, close } = await twoPanes(browser, "c5d-cross-bold", {
    permissions: ["clipboard-read", "clipboard-write"],
  });
  await typeTwoBlocks(a, "a");
  await expect.poll(async () => (await blocksOf(b, "b")).length, SETTLE).toBe(2);
  const blocks = await blocksOf(a, "a");
  const [first, second] = [blocks[0]!, blocks[1]!];

  await selectAcrossBlocks(a, "a", 3);
  const sel = await domSelection(a);
  expect(sel, "the gesture should leave a cross DOM selection").not.toBeNull();
  expect(sel!.startBlock).toBe(first.id);
  expect(sel!.startOffset).toBe(0);
  expect(sel!.endBlock).toBe(second.id);
  expect(sel!.endOffset).toBe(3);

  // The toolbar is up for the cross range; the list-type menu (single-block
  // only) is absent: six marks (the link's included) + three aligns + the
  // palette = 10 buttons.
  const bar = toolbar(a, "a");
  await expect(bar).toBeVisible();
  await expect(bar.locator("button")).toHaveCount(10);

  await bar.locator('[data-mark="bold"]').click();

  // Block 1 is marked in full (the range starts at its start); block 2's
  // head is marked, its tail is not.
  const runOf = (block: { content?: { text: string; marks: Record<string, unknown> }[] } | null, text: string) =>
    block?.content?.find((run) => run.text === text);
  expect(runOf(await blockOf(a, "a", first.id), first.text)?.marks.bold).toBe(true);
  expect(runOf(await blockOf(a, "a", second.id), second.text.slice(0, 3))?.marks.bold).toBe(true);
  expect(runOf(await blockOf(a, "a", second.id), second.text.slice(3))?.marks.bold).toBeUndefined();

  // The segments reached the other pane (doc-level sync).
  await expect.poll(async () => runOf(await blockOf(b, "b", first.id), first.text)?.marks.bold, SETTLE).toBe(true);
  await expect
    .poll(async () => runOf(await blockOf(b, "b", second.id), second.text.slice(0, 3))?.marks.bold, SETTLE)
    .toBe(true);

  // Bold off: the range toggle clears the segments (one undo step).
  await bar.locator('[data-mark="bold"]').click();
  expect((await blockOf(a, "a", second.id))?.content?.some((run) => run.marks.bold === true)).toBe(false);
  await close();
});

test("typing over the cross range replaces it; one Control+z restores it", async ({ browser }) => {
  const { a, close } = await twoPanes(browser, "c5d-cross-replace", {
    permissions: ["clipboard-read", "clipboard-write"],
  });
  await typeTwoBlocks(a, "a");
  const blocks = await blocksOf(a, "a");
  const [first, second] = [blocks[0]!, blocks[1]!];

  await selectAcrossBlocks(a, "a", 2);
  const sel = await domSelection(a);
  expect(sel!.startBlock).toBe(first.id);
  expect(sel!.endBlock).toBe(second.id);

  await a.keyboard.type("X");

  // The range is replaced as text at the seam: the range starts at block 1's
  // start, so block 1 is fully consumed and the character lands at block 2's
  // start; block 2 keeps its tail.
  expect(await blockOf(a, "a", first.id)).toBeNull();
  const b2 = await blockOf(a, "a", second.id);
  expect(b2?.content?.map((run) => run.text).join("")).toBe("X" + second.text.slice(sel!.endOffset));

  // The seam caret is seated on the next frame (the structural change
  // removed the block the focus sat in) — settle it before the undo
  // hotkey, which the editor root receives by bubbling from the focus.
  // The seated caret stands inside the second block's inner (the page's
  // single editable's focus is the container, the caret's block is read
  // over the live selection's anchor).
  await expect
    .poll(
      async () =>
        a.evaluate((id) => {
          const selection = window.getSelection();
          if (selection === null || selection.anchorNode === null) return "";
          const inner = document.querySelector(`[data-block-id="${id}"] [data-slot='docblocks/block-content']`);
          return inner !== null && inner.contains(selection.anchorNode) ? id : "";
        }, second.id),
      SETTLE
    )
    .toBe(second.id);

  await a.keyboard.press("Control+z");
  const b1 = await blockOf(a, "a", first.id);
  expect(b1?.content?.map((run) => run.text).join("")).toBe(first.text);
  expect((await blockOf(a, "a", second.id))?.content?.map((run) => run.text).join("")).toBe(second.text);
  await close();
});

test("Delete over a cross range removes the covered blocks; undo restores them", async ({ browser }) => {
  const { a, b, close } = await twoPanes(browser, "c5d-cross-delete", {
    permissions: ["clipboard-read", "clipboard-write"],
  });
  await typeTwoBlocks(a, "a");
  await insertBlockType(a, "a", "paragraph");
  await inners(a, "a").nth(2).click();
  await a.keyboard.type("three four");
  await expect.poll(async () => (await blocksOf(a, "a")).length, SETTLE).toBe(3);
  const blocks = await blocksOf(a, "a");
  const [first, middle, third] = [blocks[0]!, blocks[1]!, blocks[2]!];

  // From the start of block 1 to the end of block 3: all three blocks are
  // fully covered (the middle one included).
  await selectAcrossBlocks(a, "a", 0, 2, true);
  const sel = await domSelection(a);
  expect(sel!.startBlock).toBe(first.id);
  expect(sel!.endBlock).toBe(third.id);
  expect(sel!.endOffset).toBe(third.text.length);

  await a.keyboard.press("Delete");

  // The covered blocks are gone from the doc (local delete, then sync to
  // the other pane).
  expect((await blocksOf(a, "a")).map((block) => block.id)).not.toContain(middle.id);
  await expect.poll(async () => (await blocksOf(b, "b")).some((block) => block.id === middle.id), SETTLE).toBe(false);

  await a.keyboard.press("Control+z");
  await expect.poll(async () => (await blocksOf(a, "a")).some((block) => block.id === middle.id), SETTLE).toBe(true);
  await close();
});

test("a cross range selected in pane B renders as a range highlight in pane A", async ({ browser }) => {
  const { a, b, close } = await twoPanes(browser, "c5d-cross-presence", {
    permissions: ["clipboard-read", "clipboard-write"],
  });
  await typeTwoBlocks(a, "a");
  await expect.poll(async () => (await blocksOf(b, "b")).length, SETTLE).toBe(2);
  const blocks = await blocksOf(b, "b");
  const [first, second] = [blocks[0]!, blocks[1]!];

  // The sharing's grant (the default is off — the privacy stand): B flips
  // to "everyone" (the plaintext stand) before the range lands.
  await b.getByTestId("share-b-everyone").click();

  // B composes the cross selection; A renders the range highlight boxes
  // (one per chain block — the box carries the segment's block id).
  await selectAcrossBlocks(b, "b", 3);
  await expect
    .poll(
      async () => a.locator(`[data-slot="docblocks/presence-range"][data-range-block="${second.id}"]`).count(),
      SETTLE
    )
    .toBe(1);
  await expect
    .poll(
      async () => a.locator(`[data-slot="docblocks/presence-range"][data-range-block="${first.id}"]`).count(),
      SETTLE
    )
    .toBe(1);

  // A caret in B (the range collapsed) drops the range boxes.
  await inners(b, "b").first().click();
  await expect.poll(async () => a.locator('[data-slot="docblocks/presence-range"]').count(), SETTLE).toBe(0);
  await close();
});

test("an arrow key from the cross range collapses it to a caret", async ({ browser }) => {
  const { a, close } = await twoPanes(browser, "c5d-cross-arrow", {
    permissions: ["clipboard-read", "clipboard-write"],
  });
  await typeTwoBlocks(a, "a");
  const blocks = await blocksOf(a, "a");

  await selectAcrossBlocks(a, "a", 2);
  await expect(toolbar(a, "a")).toBeVisible();

  // The arrow passes through to the browser (the range collapses to the
  // caret at the focus end); the selectionchange mapping then updates the
  // view — the toolbar dismisses.
  await a.keyboard.press("ArrowRight");
  await expect.poll(async () => toolbar(a, "a").count(), SETTLE).toBe(0);

  // The doc is untouched.
  expect(await blocksOf(a, "a")).toEqual(blocks);
  await close();
});
