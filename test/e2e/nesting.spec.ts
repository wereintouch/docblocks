import { type Browser, type Page, expect, test } from "@playwright/test";

import { insertBlockType } from "./helpers";

// Tab / Shift+Tab over the FLAT page model (schema §3.2): the nesting is
// the block's `indent` attr relative to its PRECEDING block, so the
// gestures are one `updateBlock({ indent })` each (one undo step, one wire
// update) — the sequence order stands (a move is never part of the
// gesture). Boundary rules: Tab on the first block is a no-op (nothing to
// nest under), a jump of more than one level over the preceding block is a
// no-op, Shift+Tab at the top level is a no-op. The code block keeps the
// typewriter Tab (a `\t` at the caret). Enter on an EMPTY list item exits
// the list (the markdown exit: the item's derived segment is removed, a
// paragraph lands at the item's attach level). Backspace at the start
// refuses to merge a block that owns a non-empty derived segment.
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

/** The inner editable of a block (the motion row renders the wrapper directly — no descendant carries the id twice). */
function innerOf(page: Page, client: "a" | "b", id: string) {
  return pane(page, client).locator(
    `[data-slot="docblocks/block"][data-block-id="${id}"] > [data-slot="docblocks/block-content"], [data-slot="docblocks/list-item"][data-block-id="${id}"] > [data-slot="docblocks/block-content"]`
  );
}

/** The row's left step (the per-level indent): the computed paddingLeft of the block's flat row. */
async function rowPadding(page: Page, client: "a" | "b", id: string): Promise<string> {
  return pane(page, client)
    .locator(`[data-block-id="${id}"]`)
    .first()
    .evaluate((el) => {
      const row = el.parentElement;
      if (row === null) throw new Error("the wrapper has no row");
      return getComputedStyle(row).paddingLeft;
    });
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

test("Tab indents the second paragraph (an indent attr update); one mod+z reverts it", async ({ browser }) => {
  const { a, b, close } = await twoPanes(browser, "c5c-indent");

  // Both panes seed their own first paragraph, so the room starts with two.
  await expect.poll(async () => rootIds(a, "a"), SETTLE).toHaveLength(2);
  const root = await rootIds(a, "a");
  const [firstId, secondId] = root;

  const outBefore = await outCount(a);
  await innerOf(a, "a", secondId).click();
  await a.keyboard.press("Tab");

  // The flat model: the indent attr is set (one updateBlock in one
  // transact — one wire update), the sequence order stands, and no
  // children field is written anywhere.
  await expect.poll(async () => outCount(a), SETTLE).toBe(outBefore + 1);
  await expect.poll(async () => indentOf(a, "a", secondId), SETTLE).toBe(1);
  await expect.poll(async () => rootIds(a, "a"), SETTLE).toEqual([firstId, secondId]);
  expect((await blockOf(a, "a", firstId))?.children).toBeUndefined();
  // The row's left step is one nested indent (24px at the editor's 16px
  // font size); the top-level row stands at 0.
  expect(await rowPadding(a, "a", secondId)).toBe("24px");
  expect(await rowPadding(a, "a", firstId)).toBe("0px");
  // The indent reached pane B over the wire.
  await expect.poll(async () => indentOf(b, "b", secondId), SETTLE).toBe(1);

  // The flat gesture keeps the block's element where it stands (no
  // remount): the caret stays seated — typing lands in the indented block
  // without any re-click, and reaches the other pane over the wire.
  await a.keyboard.type("Z");
  await expect.poll(async () => textOf(a, "a", secondId), SETTLE).toBe("Z");
  await expect.poll(async () => textOf(b, "b", secondId), SETTLE).toBe("Z");

  // One mod+z reverts the indent (the hotkey reaches the doc from inside
  // the editor root — the focus is still in the indented block's inner).
  await a.keyboard.press("Control+z");
  await expect.poll(async () => textOf(a, "a", secondId), SETTLE).toBe("");
  await a.keyboard.press("Control+z");
  await expect.poll(async () => indentOf(a, "a", secondId), SETTLE).toBeUndefined();
  await expect.poll(async () => indentOf(b, "b", secondId), SETTLE).toBeUndefined();
  expect(await rowPadding(a, "a", secondId)).toBe("0px");

  await close();
});

test("the Tab boundary rules: the first block and the jump of more than one level are no-ops", async ({ browser }) => {
  const { a, b, close } = await twoPanes(browser, "c5c-boundary");

  // The room starts with the panes' two seeded paragraphs; the pane's doc
  // handle adds the fixture: [seedA, seedB, X (indent 1), Y (0), Z (1)] —
  // Z's preceding block is Y (indent 0), so Tab on Z would jump from 1 to
  // 2 over a 0-level block.
  const seeded = await a.evaluate(() => {
    const d = window.__paneDocs?.a ?? null;
    if (d === null) return null;
    const x = d.insertBlock("paragraph", { indent: 1 });
    d.insertText(x, 0, "x");
    const y = d.insertBlock("paragraph");
    d.insertText(y, 0, "y");
    const z = d.insertBlock("paragraph", { indent: 1 });
    d.insertText(z, 0, "z");
    return { x, y, z };
  });
  if (seeded === null) throw new Error("the pane's doc is not mounted");
  const outBefore = await outCount(a);

  // Tab on the first block: no preceding block, nothing to nest under.
  const firstId = (await rootIds(a, "a"))[0];
  await innerOf(a, "a", firstId).click();
  await a.keyboard.press("Tab");
  expect(await outCount(a)).toBe(outBefore);
  expect(await indentOf(a, "a", firstId)).toBeUndefined();

  // Tab on Z: the jump would exceed the preceding block's indent by more
  // than one (the markdown jump rule) — a no-op.
  await innerOf(a, "a", seeded.z).click();
  await a.keyboard.press("Tab");
  expect(await outCount(a)).toBe(outBefore);
  expect(await indentOf(a, "a", seeded.z)).toBe(1);
  // The doc stands: the other pane is unchanged too.
  expect(await rootIds(b, "b")).toEqual(await rootIds(a, "a"));
  await expect.poll(async () => indentOf(b, "b", seeded.z), SETTLE).toBe(1);

  await close();
});

test("Shift+Tab at the top level is a no-op", async ({ browser }) => {
  const { a, close } = await twoPanes(browser, "c5c-outdent-top");

  await expect.poll(async () => rootIds(a, "a"), SETTLE).toHaveLength(2);
  const root = await rootIds(a, "a");
  const [firstId] = root;
  const outBefore = await outCount(a);

  await innerOf(a, "a", firstId).click();
  await a.keyboard.press("Shift+Tab");

  // The top level has no outdent target: no attr, no wire update.
  expect(await outCount(a)).toBe(outBefore);
  expect(await indentOf(a, "a", firstId)).toBeUndefined();
  await expect.poll(async () => rootIds(a, "a"), SETTLE).toEqual(root);

  await close();
});

test("Tab in a code block inserts a tab character (no indent change)", async ({ browser }) => {
  const { a, b, close } = await twoPanes(browser, "c5c-code-tab");

  await expect.poll(async () => rootIds(a, "a"), SETTLE).toHaveLength(2);
  await insertBlockType(a, "a", "code");
  const after = await rootIds(a, "a");
  expect(after).toHaveLength(3);
  const codeId = after[after.length - 1]!;

  await innerOf(a, "a", codeId).click();
  await a.keyboard.type("abc");
  await a.keyboard.press("Tab");

  // The tab character is in the text (one run), in both panes — NOT an
  // indent change: the block's indent is absent, the order stands.
  await expect.poll(async () => textOf(a, "a", codeId), SETTLE).toBe("abc\t");
  await expect.poll(async () => textOf(b, "b", codeId), SETTLE).toBe("abc\t");
  expect(await indentOf(a, "a", codeId)).toBeUndefined();
  await expect.poll(async () => rootIds(a, "a"), SETTLE).toEqual(after);

  await close();
});

test("an empty list item + Enter exits the list (the segment is removed, a paragraph at the attach level)", async ({
  browser,
}) => {
  const { a, b, close } = await twoPanes(browser, "c5c-markdown-exit");

  // The room starts with the panes' two seeded paragraphs; the pane's doc
  // handle adds an EMPTY bullet item with a nested item (its derived
  // segment) at indent 1.
  const seeded = await a.evaluate(() => {
    const d = window.__paneDocs?.a ?? null;
    if (d === null) return null;
    const item = d.insertBlock("list-item", { list: "bullet" });
    const sub = d.insertBlock("list-item", { list: "bullet", indent: 1 });
    d.insertText(sub, 0, "the sublist");
    return { item, sub };
  });
  if (seeded === null) throw new Error("the pane's doc is not mounted");
  await a.waitForTimeout(600); // the enter animations settle

  const outBefore = await outCount(a);

  // Caret in the empty item, Enter: the item's derived segment is removed
  // and a paragraph lands at the item's former position (the markdown
  // exit), at the item's attach level (indent 0 — the top level here).
  await innerOf(a, "a", seeded.item).click();
  await a.keyboard.press("Enter");

  await expect.poll(async () => outCount(a), SETTLE).toBe(outBefore + 1);
  const after = await rootIds(a, "a");
  // The item and its sublist are gone; the paragraph stands in the item's
  // slot (right after the two seeded rows) with no indent.
  expect(after).not.toContain(seeded.item);
  expect(after).not.toContain(seeded.sub);
  const paragraphIndex = after.length - 1;
  expect(paragraphIndex).toBe(2);
  const exitId = after[paragraphIndex]!;
  expect(await blockOf(a, "a", exitId)).toMatchObject({ type: "paragraph" });
  expect(await indentOf(a, "a", exitId)).toBeUndefined();
  expect(await textOf(a, "a", exitId)).toBe("");

  // The exit reached the other pane over the wire.
  await expect.poll(async () => (await rootIds(b, "b")).some((id) => id === exitId), SETTLE).toBe(true);
  await expect.poll(async () => (await blockOf(b, "b", seeded.item)) === null, SETTLE).toBe(true);

  // One undo step restores the item and its sublist.
  await innerOf(a, "a", exitId).click();
  await a.keyboard.press("Control+z");
  await expect.poll(async () => (await rootIds(a, "a")).some((id) => id === seeded.sub), SETTLE).toBe(true);
  await expect.poll(async () => indentOf(a, "a", seeded.sub), SETTLE).toBe(1);

  await close();
});

test("Backspace at the start refuses to merge a block that owns a derived segment", async ({ browser }) => {
  const { a, close } = await twoPanes(browser, "c5c-merge-guard");

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
  await a.waitForTimeout(600); // the enter animations settle

  const before = await rootIds(a, "a");
  const outBefore = await outCount(a);

  // Caret at the blocked block's offset 0, Backspace: merging it into the
  // head would swallow its derived segment — the gesture is refused and
  // the browser default (nothing at the boundary) stands.
  await innerOf(a, "a", seeded.block).click();
  await a.keyboard.press("Home");
  await a.keyboard.press("Backspace");
  await a.waitForTimeout(300);

  // The doc stands: the order, the texts, the indent.
  expect(await outCount(a)).toBe(outBefore);
  await expect.poll(async () => rootIds(a, "a"), SETTLE).toEqual(before);
  expect(await textOf(a, "a", seeded.head)).toBe("the head");
  expect(await textOf(a, "a", seeded.block)).toBe("the blocked");
  expect(await indentOf(a, "a", seeded.child)).toBe(1);

  await close();
});

test("a gutter selection + mod+shift+arrow moves the block's derived segment", async ({ browser }) => {
  const { a, b, close } = await twoPanes(browser, "c5c-gutter-segment");

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
  await a.waitForTimeout(600); // the enter animations settle

  const before = await rootIds(a, "a");
  const headIndex = before.indexOf(seeded.head);
  expect(before[headIndex + 1]).toBe(seeded.child);
  expect(before[headIndex + 2]).toBe(seeded.after);
  const outBefore = await outCount(a);

  // Gutter click: a blocks selection on the head; mod+shift+ArrowDown
  // moves the segment (head + child) one slot down — the "after" row
  // comes first, the child stays indented (its indent stands).
  const wrapper = a.locator(`[data-block-id="${seeded.head}"]`).first();
  await wrapper.hover();
  await wrapper.locator('button[data-slot="docblocks/gutter"]').click();
  await expect(wrapper).toHaveAttribute("data-selected", "true");

  await a.keyboard.press("Control+Shift+ArrowDown");

  await expect.poll(async () => outCount(a), SETTLE).toBe(outBefore + 1);
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
  await expect.poll(async () => outCount(a), SETTLE).toBe(outBefore + 2);
  await expect.poll(async () => rootIds(a, "a"), SETTLE).toEqual(before);
  await expect.poll(async () => rootIds(b, "b"), SETTLE).toEqual(before);

  await close();
});

test("the collapse toggle unmounts the derived segment locally (no wire traffic, the other pane stands)", async ({
  browser,
}) => {
  const { a, b, close } = await twoPanes(browser, "c4-collapse");

  const seeded = await a.evaluate(() => {
    const d = window.__paneDocs?.a ?? null;
    if (d === null) return null;
    const item = d.insertBlock("list-item", { list: "bullet" });
    d.insertText(item, 0, "parent");
    const child = d.insertBlock("list-item", { list: "bullet", indent: 1 });
    d.insertText(child, 0, "child");
    return { item, child };
  });
  if (seeded === null) throw new Error("the pane's doc is not mounted");
  await a.waitForTimeout(600); // the enter animations settle

  // Both panes render the item and its nested child row.
  await expect(a.locator(`[data-block-id="${seeded.item}"]`).first()).toBeVisible();
  await expect(a.locator(`[data-block-id="${seeded.child}"]`).first()).toBeVisible();
  await expect(b.locator(`[data-block-id="${seeded.child}"]`).first()).toBeVisible(SETTLE);
  const wireA = await outCount(a);

  const toggle = a
    .locator(`[data-block-id="${seeded.item}"]`)
    .first()
    .locator('> button[data-slot="docblocks/collapse"]');
  await expect(toggle).toBeVisible();
  await toggle.click();

  // The segment unmounts in A only (view state, per pane): the child row
  // is gone from A's DOM, stands in B, and the toggle issued no doc
  // update (the wire log stands).
  await expect(a.locator(`[data-block-id="${seeded.child}"]`).first()).toHaveCount(0, SETTLE);
  await expect(b.locator(`[data-block-id="${seeded.child}"]`).first()).toBeVisible();
  expect(await outCount(a)).toBe(wireA);
  // The data stands: the child keeps its indent in the doc.
  expect(await indentOf(a, "a", seeded.child)).toBe(1);

  // The expand re-mounts the segment.
  await toggle.click();
  await expect(a.locator(`[data-block-id="${seeded.child}"]`).first()).toBeVisible(SETTLE);
  expect(await indentOf(a, "a", seeded.child)).toBe(1);

  await close();
});
