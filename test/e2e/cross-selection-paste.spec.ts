// The cross range as the document's replace seam — the divider inside the
// composed chain (skipped by the extension, removed by the replace) and the
// plain / rich paste's materialize at the seam (the seam block's stand, one
// undo step each).
import { expect, test } from "@playwright/test";

import { blockOf, blocksOf, domSelection, inners, selectAcrossBlocks, typeTwoBlocks } from "./cross-selection-helpers";
import { SETTLE, insertBlockType, pasteFromClipboard, seedClipboardPayload, twoPanes } from "./helpers";

// The two-pane's settle stands the default 30s budget at its edge (the 15s
// SETTLE's panes + the page loads): the raised budget keeps the timeout
// class out of the loaded machine's flake zone (a true stall stays visible).
test.setTimeout(45_000);

test("a divider inside the composed chain is skipped by the extension and removed by the replace", async ({
  browser,
}) => {
  const { a, close } = await twoPanes(browser, "c5d-cross-divider", {
    permissions: ["clipboard-read", "clipboard-write"],
  });
  // The room's starter is typed, then a second empty paragraph is split
  // off, a divider and a paragraph are appended, and the last is typed:
  // [p1, p2 (empty), divider, p3].
  await expect(inners(a, "a")).toHaveCount(1);
  await inners(a, "a").first().click();
  await a.keyboard.type("hello world");
  await a.keyboard.press("End");
  await a.keyboard.press("Enter");
  await expect(inners(a, "a")).toHaveCount(2);
  await insertBlockType(a, "a", "divider");
  // The non-text tail stands its guaranteed trailing paragraph over the
  // wire (the remote peer's guard): the guard's paragraph lands at the
  // sequence's end, so the next insert's position pins the chain — wait
  // for the guard's write to converge before the paragraph insert (the
  // guard's and the insert's race is engine-timing-dependent, so the
  // layout stand is the settled 4-block chain, not the engine's luck).
  await expect.poll(async () => (await blocksOf(a, "a")).length, SETTLE).toBe(4);
  await insertBlockType(a, "a", "paragraph");
  await inners(a, "a").last().click();
  await a.keyboard.type("three four");
  // The harness inserts land at the sequence's end. Wait for the
  // convergence (a one-shot read can catch A before the settle under
  // full-suite load), then capture the blocks: p1, p2, the divider, the
  // tail paragraph, p3.
  await expect.poll(async () => (await blocksOf(a, "a")).length, SETTLE).toBe(5);
  const blocks = await blocksOf(a, "a");
  const p1 = blocks[0]!;
  const p3 = blocks[4]!;

  // From p1's start to 3 chars into p3: the shift+down extensions cross
  // the empty p2 and must skip the divider (findSiblingTextBlock) to land
  // in p3 (over the tail paragraph in between).
  await selectAcrossBlocks(a, "a", 3, 3, false);
  const sel = await domSelection(a);
  expect(sel!.startBlock).toBe(p1.id);
  expect(sel!.endBlock).toBe(p3.id);
  expect(sel!.endOffset).toBe(3);

  await a.keyboard.type("X");

  // p1 is fully consumed, the covered middle (p2, the divider, the tail
  // paragraph) is cascade-removed, and p3 keeps its tail.
  expect(await blockOf(a, "a", p1.id)).toBeNull();
  const remaining = await blocksOf(a, "a");
  expect(remaining).toHaveLength(1);
  expect(remaining[0]?.id).toBe(p3.id);
  expect(remaining[0]?.text).toBe("X" + p3.text.slice(3));
  await close();
});

test("a cross paste replaces the range at the seam (one undo step)", async ({ browser }) => {
  const { a, b, close } = await twoPanes(browser, "c5d-cross-paste", {
    permissions: ["clipboard-read", "clipboard-write"],
  });
  await typeTwoBlocks(a, "a");
  const blocks = await blocksOf(a, "a");
  const [first, second] = [blocks[0]!, blocks[1]!];

  // Seed the page's paste payload with the payload (headless engines do not
  // write it from a keyboard copy, so the copy side is simulated; the paste
  // side is the real pipeline over the engine's clipboard's stand).
  await seedClipboardPayload(a, { plain: "XY" });

  // Compose the cross range with partial endpoints: (block 1, 0) to
  // (block 2, 5) — both blocks survive the replace with their outside
  // parts.
  await selectAcrossBlocks(a, "a", 5, 1, false);
  const sel = await domSelection(a);
  expect(sel!.startBlock).toBe(first.id);
  expect(sel!.endBlock).toBe(second.id);

  // Paste the payload into the focused inner (the synthetic paste event's
  // stand — the headless engine does not synthesize the event from Control+v).
  await pasteFromClipboard(a);

  // The range starts at block 1's start: block 1 is fully covered and
  // removed; the seam is (block 2, 0), so the paste lands at block 2's
  // start and block 2 keeps its tail from the range end.
  await expect.poll(async () => blockOf(a, "a", first.id), SETTLE).toBeNull();
  await expect
    .poll(async () => (await blockOf(a, "a", second.id))?.content?.map((run) => run.text).join(""), SETTLE)
    .toBe("XY" + second.text.slice(sel!.endOffset));

  // The other pane sees the replace over the wire.
  await expect
    .poll(async () => (await blockOf(b, "b", second.id))?.content?.map((run) => run.text).join(""), SETTLE)
    .toBe("XY" + second.text.slice(sel!.endOffset));

  // The seam caret is seated on the next frame (the replace removed the
  // block the focus sat in) — settle it before the undo hotkey, which the
  // editor root receives by bubbling from the focus. The seat is read over
  // the live selection's range (the page's single editable's focus is the
  // container, the caret's block stands in the range's endpoints).
  await expect.poll(async () => (await domSelection(a))?.startBlock ?? "", SETTLE).toBe(second.id);

  // ONE undo step restores the whole replace (delete + insert were one
  // transaction); redo re-applies it.
  await a.keyboard.press("Control+z");
  expect((await blockOf(a, "a", first.id))?.content?.map((run) => run.text).join("")).toBe(first.text);
  expect((await blockOf(a, "a", second.id))?.content?.map((run) => run.text).join("")).toBe(second.text);
  await a.keyboard.press("Control+Shift+z");
  expect(await blockOf(a, "a", first.id)).toBeNull();
  expect((await blockOf(a, "a", second.id))?.content?.map((run) => run.text).join("")).toBe(
    "XY" + second.text.slice(sel!.endOffset)
  );
  await close();
});

test("a rich cross paste materializes the blocks at the seam (the seam block stands; one undo step)", async ({
  browser,
}) => {
  const { a, b, close } = await twoPanes(browser, "c5d-rich-cross-paste", {
    permissions: ["clipboard-read", "clipboard-write"],
  });
  await typeTwoBlocks(a, "a");
  const blocks = await blocksOf(a, "a");
  const [first, second] = [blocks[0]!, blocks[1]!];

  // The rich payload: two paragraphs (the html wins over the plain at the
  // seam — the rich branch of the pipeline).
  await seedClipboardPayload(a, { html: "<p>m1</p><p>m2</p>", plain: "m1 m2" });

  // The cross range from block 1's start to 5 chars into block 2 (both
  // blocks keep their outside parts; block 1 is fully covered).
  await selectAcrossBlocks(a, "a", 5, 1, false);
  const sel = await domSelection(a);
  expect(sel!.startBlock).toBe(first.id);
  expect(sel!.endBlock).toBe(second.id);

  // Paste the payload into the focused inner (the synthetic paste event's
  // stand — the headless engine does not synthesize it from Control+v).
  await pasteFromClipboard(a);

  // The range starts at block 1's start: block 1 is fully covered and
  // removed; the seam is (block 2, 0) — the first pasted block merges into
  // it (the seam block keeps its id; the peer carets rebase onto it), the
  // second stands its own paragraph, and block 2's tail from the range end
  // (the suffix) lands in the last pasted block.
  await expect.poll(async () => blockOf(a, "a", first.id), SETTLE).toBeNull();
  const tail = second.text.slice(sel!.endOffset);
  await expect
    .poll(async () => (await blockOf(a, "a", second.id))?.content?.map((run) => run.text).join(""), SETTLE)
    .toBe("m1");
  const blocksAfter = await blocksOf(a, "a");
  const m2 = blocksAfter.find((block) => block.id !== second.id);
  expect(m2).toBeDefined();
  expect(m2!.text).toBe("m2" + tail);

  // The other pane converges over the wire (the seam block + the new one).
  await expect
    .poll(async () => (await blockOf(b, "b", second.id))?.content?.map((run) => run.text).join(""), SETTLE)
    .toBe("m1");
  await expect
    .poll(
      async () =>
        (await b.evaluate((id) => {
          const doc = window.__paneDocs?.b;
          if (doc === undefined || doc === null) return null;
          const other = (doc.getChildren(doc.meta.id) as string[]).find((x) => x !== id);
          return other === undefined ? null : doc.getText(other);
        }, second.id)) ?? "",
      SETTLE
    )
    .toBe("m2" + tail);

  // The seam caret stands at the end of the last pasted block (the m2
  // block — the landing of the material) — settle it before the undo
  // hotkey, which the editor root receives by bubbling from the focus. The
  // seat is read over the live selection's range (the page's single
  // editable's focus is the container).
  await expect.poll(async () => (await domSelection(a))?.startBlock ?? "", SETTLE).toBe(m2!.id);

  // ONE undo step restores the whole replace (the delete + the material
  // were one transaction); redo re-applies it.
  await a.keyboard.press("Control+z");
  expect((await blockOf(a, "a", first.id))?.content?.map((run) => run.text).join("")).toBe(first.text);
  expect((await blockOf(a, "a", second.id))?.content?.map((run) => run.text).join("")).toBe(second.text);
  await a.keyboard.press("Control+Shift+z");
  expect(await blockOf(a, "a", first.id)).toBeNull();
  expect((await blockOf(a, "a", second.id))?.content?.map((run) => run.text).join("")).toBe("m1");
  await close();
});
