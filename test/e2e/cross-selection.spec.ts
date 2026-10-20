import { type Browser, type Page, expect, test } from "@playwright/test";

import { insertBlockType } from "./helpers";

// Each test gets its own room via ?syncUrl= — the relay keeps rooms for
// the dev server's lifetime, so a shared room would be polluted by other
// spec files (and by manually opened tabs).
const RELAY = "ws://localhost:5199";
const SETTLE = { timeout: 15_000 };

async function openPane(page: Page, client: "a" | "b", room: string): Promise<void> {
  await page.goto(`/?client=${client}&syncUrl=${RELAY}/${room}`);
  await expect(page.getByTestId(`status-${client}`)).toHaveText("connected");
}

function pane(page: Page, client: "a" | "b") {
  return page.locator(`[data-testid="doc-${client}"]`);
}

/** The inner contenteditables of the pane's text blocks, in order. */
function inners(page: Page, client: "a" | "b") {
  return pane(page, client).locator('[data-slot="docblocks/block-content"]');
}

/** The pane's floating format toolbar. */
function toolbar(page: Page, client: "a" | "b") {
  return pane(page, client).locator('[data-slot="docblocks/format-toolbar"]');
}

/** The block ids and texts of the pane's doc, in root order. */
async function blocksOf(page: Page, client: "a" | "b"): Promise<{ id: string; text: string }[]> {
  return page.evaluate((c) => {
    const doc = window.__paneDocs?.[c];
    if (doc === null || doc === undefined) throw new Error("the pane's doc is not mounted");
    const json = doc.toJSON();
    return doc.getChildren(json.id).map((id) => {
      const block = doc.getBlock(id);
      const text = (block?.content ?? []).map((run) => run.text).join("");
      return { id, text };
    });
  }, client);
}

/** The snapshot of one block (the pane's live doc). */
async function blockOf(
  page: Page,
  client: "a" | "b",
  id: string
): Promise<{ content?: { text: string; marks: Record<string, unknown> }[] } | null> {
  return page.evaluate(({ client, id }) => window.__paneDocs?.[client]?.getBlock(id) ?? null, { client, id });
}

/**
 * Type the room's starter paragraph (pane "a" seeds it once after the
 * sync settles) and a second paragraph (an Enter split at the first
 * block's end), both typed.
 */
async function typeTwoBlocks(page: Page, client: "a" | "b"): Promise<void> {
  await expect(inners(page, client)).toHaveCount(1); // the starter has settled
  await inners(page, client).first().click();
  await page.keyboard.type("hello world");
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  // The split lands in the DOM on the next store flush: wait for the new
  // row and re-seat the caret in it (a stale caret in the first block's
  // contenteditable would absorb the early keystrokes).
  await expect(inners(page, client)).toHaveCount(2);
  await inners(page, client).nth(1).click();
  await page.keyboard.type("another world");
}

/**
 * Compose the cross-block selection from block 1's start, over `downSteps`
 * blocks, to `rightSteps` into the last block's text (optionally to its
 * end) with the editor's keyboard gestures: the browser cannot extend a
 * selection across a contenteditable boundary (neither a mouse drag nor a
 * native shift+arrow), so the cross range is composed from the editor's
 * shift+arrow edge extensions — caret at the start of block 1, shift+end
 * to its end, shift+down extends across into the next block (repeated per
 * block), shift+right / shift+end into the last block's text.
 */
async function selectAcrossBlocks(
  page: Page,
  client: "a" | "b",
  rightSteps = 3,
  downSteps = 1,
  toEnd = false
): Promise<void> {
  const box1 = (await inners(page, client).nth(0).boundingBox())!;
  await page.mouse.click(box1.x + 5, box1.y + box1.height / 2);
  await page.keyboard.press("Home");
  await page.keyboard.down("Shift");
  for (let i = 0; i < downSteps; i += 1) {
    await page.keyboard.press("End");
    await page.keyboard.press("ArrowDown");
  }
  for (let i = 0; i < rightSteps; i += 1) await page.keyboard.press("ArrowRight");
  if (toEnd) await page.keyboard.press("End");
  await page.keyboard.up("Shift");
}

/** The live DOM selection's endpoints (block id + the container offset); null when none. */
async function domSelection(
  page: Page
): Promise<{ startBlock: string; startOffset: number; endBlock: string; endOffset: number } | null> {
  return page.evaluate(() => {
    const s = window.getSelection();
    if (s === null || s.rangeCount === 0) return null;
    const r = s.getRangeAt(0);
    const blockOf = (node: Node) =>
      (node.parentElement ?? null)?.closest?.("[data-block-id]")?.getAttribute("data-block-id") ?? "";
    return {
      startBlock: blockOf(r.startContainer),
      startOffset: r.startOffset,
      endBlock: blockOf(r.endContainer),
      endOffset: r.endOffset,
    };
  });
}

async function twoPanes(browser: Browser, seed: string): Promise<{ a: Page; b: Page; close: () => Promise<void> }> {
  const room = `${seed}-${Math.random().toString(36).slice(2, 8)}`;
  const contextA = await browser.newContext();
  const contextB = await browser.newContext();
  // The paste test seeds and reads the OS clipboard (headless Chromium
  // does not write it from a keyboard copy).
  await contextA.grantPermissions(["clipboard-read", "clipboard-write"]);
  await contextB.grantPermissions(["clipboard-read", "clipboard-write"]);
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

test("a cross-block selection raises the toolbar; bold marks the per-block segments", async ({ browser }) => {
  const { a, b, close } = await twoPanes(browser, "c5d-cross-bold");
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
  // only) is absent: five marks + three aligns + the palette = 9 buttons.
  const bar = toolbar(a, "a");
  await expect(bar).toBeVisible();
  await expect(bar.locator("button")).toHaveCount(9);

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
  const { a, close } = await twoPanes(browser, "c5d-cross-replace");
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
  await expect
    .poll(
      async () => a.evaluate(() => (document.activeElement as HTMLElement | null)?.getAttribute("data-block-id") ?? ""),
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
  const { a, b, close } = await twoPanes(browser, "c5d-cross-delete");
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
  const { a, b, close } = await twoPanes(browser, "c5d-cross-presence");
  await typeTwoBlocks(a, "a");
  await expect.poll(async () => (await blocksOf(b, "b")).length, SETTLE).toBe(2);
  const blocks = await blocksOf(b, "b");
  const [first, second] = [blocks[0]!, blocks[1]!];

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

test("a divider inside the composed chain is skipped by the extension and removed by the replace", async ({
  browser,
}) => {
  const { a, close } = await twoPanes(browser, "c5d-cross-divider");
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
  await insertBlockType(a, "a", "paragraph");
  await inners(a, "a").last().click();
  await a.keyboard.type("three four");
  const blocks = await blocksOf(a, "a");
  // The harness inserts land at the sequence's end: the non-text tail
  // stands its guaranteed trailing paragraph (the remote peer's guard
  // writes it over the wire), so the sequence is p1, p2, the divider,
  // the tail paragraph, and p3.
  expect(blocks).toHaveLength(5);
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

test("an arrow key from the cross range collapses it to a caret", async ({ browser }) => {
  const { a, close } = await twoPanes(browser, "c5d-cross-arrow");
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

test("a cross paste replaces the range at the seam (one undo step)", async ({ browser }) => {
  const { a, b, close } = await twoPanes(browser, "c5d-cross-paste");
  await typeTwoBlocks(a, "a");
  const blocks = await blocksOf(a, "a");
  const [first, second] = [blocks[0]!, blocks[1]!];

  // Seed the OS clipboard with the payload (headless Chromium does not
  // write it from a keyboard copy, so the copy side is simulated; the
  // paste side reads the real clipboard).
  await a.evaluate(async () => {
    await navigator.clipboard.write([new ClipboardItem({ "text/plain": new Blob(["XY"], { type: "text/plain" }) })]);
  });

  // Compose the cross range with partial endpoints: (block 1, 0) to
  // (block 2, 5) — both blocks survive the replace with their outside
  // parts.
  await selectAcrossBlocks(a, "a", 5, 1, false);
  const sel = await domSelection(a);
  expect(sel!.startBlock).toBe(first.id);
  expect(sel!.endBlock).toBe(second.id);

  // Read the real clipboard and dispatch a paste event to the focused
  // inner (headless Chromium does not synthesize the event from Control+v).
  await a.evaluate(async () => {
    let plain: string | null = null;
    for (const item of await navigator.clipboard.read()) {
      if (item.types.includes("text/plain")) plain = await (await item.getType("text/plain")).text();
    }
    if (plain === null) throw new Error("the clipboard should carry plain text");
    const target = document.activeElement;
    if (!(target instanceof HTMLElement)) throw new Error("the paste target should be focused");
    const transfer = new DataTransfer();
    transfer.setData("text/plain", plain);
    const event = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "clipboardData", { value: transfer });
    target.dispatchEvent(event);
  });

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
  // editor root receives by bubbling from the focus.
  await expect
    .poll(
      async () => a.evaluate(() => (document.activeElement as HTMLElement | null)?.getAttribute("data-block-id") ?? ""),
      SETTLE
    )
    .toBe(second.id);

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

test("a cross copy serializes the range from the doc (the default copy cannot cross the boundary)", async ({
  browser,
}) => {
  const { a, close } = await twoPanes(browser, "c5d-cross-copy");
  await typeTwoBlocks(a, "a");
  const blocks = await blocksOf(a, "a");
  const [first, second] = [blocks[0]!, blocks[1]!];

  // Mark block 1's head so the payload carries a mark tag.
  await a.evaluate((id) => window.__paneDocs?.a?.setMark(id, 0, 5, { type: "bold" }), first.id);

  // (block 1, 0) to (block 2, 5): block 1 is fully covered, block 2 is
  // cut after its head.
  await selectAcrossBlocks(a, "a", 5, 1, false);
  const sel = await domSelection(a);
  expect(sel!.startBlock).toBe(first.id);
  expect(sel!.endBlock).toBe(second.id);

  // Dispatch a copy event on the focused inner and read what the editor
  // put on the clipboard (headless Chromium does not run the default copy
  // for a cross-boundary selection, and the copy side is simulated per
  // the clipboard spec's convention).
  const data = await a.evaluate(() => {
    const target = document.activeElement;
    if (!(target instanceof HTMLElement)) throw new Error("the copy target should be focused");
    const transfer = new DataTransfer();
    const event = new Event("copy", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "clipboardData", { value: transfer });
    target.dispatchEvent(event);
    return {
      prevented: event.defaultPrevented,
      text: transfer.getData("text/plain"),
      html: transfer.getData("text/html"),
    };
  });

  expect(data.prevented).toBe(true);
  expect(data.text).toBe("hello world\n" + second.text.slice(0, sel!.endOffset));
  expect(data.html).toBe(`<div><strong>hello</strong> world</div><div>${second.text.slice(0, sel!.endOffset)}</div>`);
  await close();
});

/**
 * Drag the pointer from a point inside block 1 (a few px in) to a point
 * inside block 2 (a few px in) with a real mouse: the browser's own drag
 * cannot cross the contenteditable boundary, so the editor takes the
 * selection over once the pointer leaves the anchor block.
 */
async function dragAcrossBlocks(page: Page, client: "a" | "b"): Promise<void> {
  const first = (await inners(page, client).nth(0).boundingBox())!;
  const second = (await inners(page, client).nth(1).boundingBox())!;
  await page.mouse.move(first.x + 6, first.y + first.height / 2);
  await page.mouse.down();
  await page.mouse.move(second.x + 6, second.y + second.height / 2, { steps: 8 });
}

test("a mouse drag composes the cross selection (and the in-block drag stands)", async ({ browser }) => {
  const { a, b, close } = await twoPanes(browser, "c5d-cross-drag");
  await typeTwoBlocks(a, "a");
  const blocks = await blocksOf(a, "a");
  const [first, second] = [blocks[0]!, blocks[1]!];

  // Cross drag: the selection stands across the boundary mid-drag and
  // keeps standing after the release (the editor re-seats it over the
  // suppressed browser seat).
  await dragAcrossBlocks(a, "a");
  const during = await domSelection(a);
  expect(during!.startBlock).toBe(first.id);
  expect(during!.endBlock).toBe(second.id);
  await a.mouse.up();
  const after = (await domSelection(a))!;
  expect(after.startBlock).toBe(first.id);
  expect(after.endBlock).toBe(second.id);
  // The toolbar stands over the cross range, and the document focus stands
  // inside the editor (on the base's block — setBaseAndExtent moves the
  // document focus to the base's editable; the keys bubble to the root
  // handlers regardless of the focused block).
  await expect(toolbar(a, "a")).toBeVisible();
  const activeBlock = await a.evaluate(
    () => document.activeElement?.closest?.("[data-block-id]")?.getAttribute("data-block-id") ?? ""
  );
  expect([first.id, second.id]).toContain(activeBlock);

  // The delete of the dragged range removes the covered text over the
  // wire: the endpoint blocks keep their uncovered parts (block 1 the
  // head before the drag start, block 2 the tail after the drag end),
  // nothing in between (there is nothing in between).
  const [firstText, secondText] = [first.text, second.text];
  await a.keyboard.press("Delete");
  await expect
    .poll(async () => {
      const texts = (await blocksOf(b, "b")).map((t) => t.text);
      return (
        JSON.stringify(texts) ===
        JSON.stringify([firstText.slice(0, during!.startOffset), secondText.slice(during!.endOffset)])
      );
    })
    .toBe(true);
  expect((await blockOf(a, "a", first.id))?.content?.map((run) => run.text).join("")).toBe(
    firstText.slice(0, during!.startOffset)
  );

  // An in-block-only drag leaves a plain in-block range (no cross takeover).
  const innersA = inners(a, "a");
  const box = (await innersA.nth(0).boundingBox())!;
  await a.mouse.move(box.x + 4, box.y + box.height / 2);
  await a.mouse.down();
  await a.mouse.move(box.x + 30, box.y + box.height / 2, { steps: 5 });
  const inBlock = (await domSelection(a))!;
  expect(inBlock.startBlock).toBe(inBlock.endBlock);
  await a.mouse.up();

  // A click without a drag seats the caret: typing lands where it stands.
  await innersA.nth(0).click();
  await a.keyboard.type("Z");
  expect((await blockOf(a, "a", first.id))?.content?.map((run) => run.text).join("")).toContain("Z");
  await close();
});
