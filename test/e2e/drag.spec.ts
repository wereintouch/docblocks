import { type Browser, type Page, expect, test } from "@playwright/test";

import { insertBlockType } from "./helpers";

// The flat-model drag (the motion subpath): pure framer Reorder over the
// flat page sequence — one `Reorder.Item` per block, the gutter handle the
// only drag trigger. A vertical drag is a reorder only (the level change is
// the Tab/Shift+Tab gesture): the dragged block's derived subtree moves as
// one range, one transact — one undo step, one wire update. A no-op drop
// and a stale drop (the release's derived order is not the current
// sequence with the segment moved — e.g. a drop over the segment's own
// rows) issue no command.
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

/** The pane's block wrappers (the inner editables are not blocks). */
function wrappers(page: Page, client: "a" | "b") {
  return pane(page, client).locator('[data-block-id]:not([data-slot="docblocks/block-content"])');
}

/** The pane's current block wrapper (the harness labels it `data-current`). */
function currentWrapper(page: Page, client: "a" | "b") {
  return pane(page, client).locator('[data-block-id][data-current="true"]');
}

/** The wrapper's gutter handle. */
function gutter(page: Page, client: "a" | "b", index: number) {
  return wrappers(page, client).nth(index).locator('button[data-slot="docblocks/gutter"]');
}

/** The flat row (the Reorder.Item) that wraps the given block — a row is the wrapper's direct parent, and the flat view carries no nesting, so the id is unique within the row. */
function rowOf(page: Page, id: string) {
  return page.locator(`[data-slot="docblocks/row"]:has([data-block-id="${id}"])`);
}

/** The wrapper's block id. */
async function wrapperId(page: Page, client: "a" | "b", index: number): Promise<string> {
  return (await wrappers(page, client).nth(index).getAttribute("data-block-id")) ?? "";
}

/** The pane's root order + one block's indent attr (the command API's view). */
async function rootState(
  page: Page,
  client: "a" | "b"
): Promise<{ order: string[]; indent: (id: string) => number | undefined }> {
  const doc = await page.evaluate((c) => {
    const d = window.__paneDocs?.[c as "a" | "b"] ?? null;
    if (d === null) return null;
    const json = d.toJSON();
    return {
      order: d.getChildren(json.id),
      blocks: json.blocks,
    };
  }, client);
  if (doc === null) throw new Error("the pane's doc is not mounted");
  return {
    order: doc.order,
    indent: (id: string) => (doc.blocks[id]?.attrs as { indent?: number } | undefined)?.indent,
  };
}

/** The wire log's outbound doc-update count (awareness frames are not logged). */
async function outCount(page: Page, client: "a" | "b"): Promise<number> {
  const text = await page.getByTestId(`wire-${client}`).innerText();
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

/**
 * A real pointer drag of a row's gutter handle to a point: hover the handle,
 * press, move in steps (framer's layout projection tracks the pointer only
 * across rendered frames — a single fast move is batched and crosses
 * nothing), release.
 */
async function dragGutterTo(page: Page, client: "a" | "b", index: number, toX: number, toY: number): Promise<void> {
  const handle = gutter(page, client, index);
  await handle.hover();
  const from = await handle.boundingBox();
  if (from === null) throw new Error("the gutter has no box");
  const fromY = from.y + from.height / 2;
  await page.mouse.move(from.x, fromY);
  await page.mouse.down();
  for (let i = 1; i <= 12; i++) {
    await page.mouse.move(from.x + (toX - from.x) * (i / 12), fromY + ((toY - fromY) * i) / 12);
    await page.waitForTimeout(30);
  }
  await page.mouse.up();
}

test("a gutter drag reorders the block, syncs to the other pane, and undoes as one step", async ({ browser }) => {
  const { a, b, close } = await twoPanes(browser, "ui04b-reorder");

  // Both panes seed their own first paragraph, so the room starts with two.
  await expect(wrappers(a, "a"), SETTLE).toHaveCount(2);
  await expect(wrappers(b, "b"), SETTLE).toHaveCount(2);

  // Two more paragraphs via the pane's insert hook (the inserted block is
  // current, so it is labeled), with unique texts for the assertions.
  await insertBlockType(a, "a", "paragraph");
  await currentWrapper(a, "a").locator('[data-slot="docblocks/block-content"]').first().click();
  await a.keyboard.type("one");
  await insertBlockType(a, "a", "paragraph");
  await currentWrapper(a, "a").locator('[data-slot="docblocks/block-content"]').first().click();
  await a.keyboard.type("two");
  await expect(wrappers(a, "a"), SETTLE).toHaveCount(4);
  await expect(wrappers(b, "b"), SETTLE).toHaveCount(4);

  const lastId = await wrapperId(a, "a", 3);
  expect(lastId).not.toBe("");
  const firstBox = await wrappers(a, "a").nth(0).boundingBox();
  const lastBox = await wrappers(a, "a").nth(3).boundingBox();
  if (firstBox === null || lastBox === null) throw new Error("the wrappers have no boxes");

  // Drag the last block above the first one (the pointer lands inside the
  // viewport, so the drag does not trigger page auto-scroll).
  await dragGutterTo(a, "a", 3, lastBox.x + 20, firstBox.y + firstBox.height / 4);

  // The order changed in A and reached B over the wire (B shows the new
  // order as the update arrives).
  await expect(wrappers(a, "a").first(), SETTLE).toHaveAttribute("data-block-id", lastId);
  await expect(wrappers(b, "b").first(), SETTLE).toHaveAttribute("data-block-id", lastId);

  // The drag is A's local undo entry (one command, one undoable unit):
  // the order reverts in both panes.
  await a.keyboard.press("Control+z");
  await expect(wrappers(a, "a").first(), SETTLE).not.toHaveAttribute("data-block-id", lastId);
  await expect(wrappers(b, "b").first(), SETTLE).not.toHaveAttribute("data-block-id", lastId);

  await close();
});

test("a drag back to the same position issues no command", async ({ browser }) => {
  const { a, close } = await twoPanes(browser, "ui04b-noop");

  await expect(wrappers(a, "a"), SETTLE).toHaveCount(2);
  const firstId = await wrapperId(a, "a", 0);
  expect(firstId).not.toBe("");

  // The wire log counts doc updates only (awareness frames do not pass
  // the logged sendUpdate), so a no-op drag adds no `out` line.
  const before = await outCount(a, "a");

  // A small move: no midpoint crossing, so the order stands.
  const handleBox = await gutter(a, "a", 0).boundingBox();
  if (handleBox === null) throw new Error("the first wrapper's gutter has no box");
  await dragGutterTo(a, "a", 0, handleBox.x, handleBox.y + 4);

  await a.waitForTimeout(500);
  expect(await outCount(a, "a")).toBe(before);
  await expect(wrappers(a, "a").first()).toHaveAttribute("data-block-id", firstId);

  await close();
});

test("a drag of a block with a derived subtree moves the whole segment (one wire update, the indents stand)", async ({
  browser,
}) => {
  const { a, b, close } = await twoPanes(browser, "flatdrag-segment");

  // The room starts with the panes' two seeded paragraphs; the pane's doc
  // handle adds the fixture: a paragraph with an indented child (the
  // derived segment) and a paragraph after it.
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
  await a.waitForTimeout(600); // the enter animations settle (the boxes move with them)

  const before = await rootState(a, "a");
  expect(before.order).toContain(seeded.head);
  const headIndex = before.order.indexOf(seeded.head);
  expect(before.order[headIndex + 1]).toBe(seeded.child);
  expect(before.order[headIndex + 2]).toBe(seeded.after);
  expect(before.indent(seeded.child)).toBe(1);
  const outBefore = await outCount(a, "a");

  // The segment head's row: the head follows the two seeded rows (the
  // seeded blocks came first in the room's sequence).
  const headRow = rowOf(a, seeded.head);
  const afterRow = rowOf(a, seeded.after);
  const afterBox = await afterRow.boundingBox();
  const headBox = await headRow.boundingBox();
  if (afterBox === null || headBox === null) throw new Error("the rows have no boxes");

  // Drag the segment head down past the "after" row (stepped moves so
  // framer's layout projection tracks the drag — a single fast move is
  // batched into one frame and crosses nothing): the whole segment
  // (head + child) lands after it, one transact.
  const handle = a.locator(`[data-block-id="${seeded.head}"]`).first().locator('button[data-slot="docblocks/gutter"]');
  await handle.hover();
  const handleBox = await handle.boundingBox();
  if (handleBox === null) throw new Error("the head's gutter has no box");
  const toY = afterBox.y + afterBox.height * 0.75; // below the row's center
  const fromY = handleBox.y + handleBox.height / 2;
  await a.mouse.move(handleBox.x, fromY);
  await a.mouse.down();
  for (let i = 1; i <= 12; i++) {
    await a.mouse.move(afterBox.x + 30, fromY + ((toY - fromY) * i) / 12);
    await a.waitForTimeout(30);
  }
  await a.mouse.up();

  // One wire update: the move was one command.
  await expect.poll(async () => outCount(a, "a"), SETTLE).toBe(outBefore + 1);
  // The segment moved as a unit: the head precedes the child, the child
  // stays indented (the attach rule re-derives it under the moved head),
  // and both follow "after".
  const afterState = await rootState(a, "a");
  const newHeadIndex = afterState.order.indexOf(seeded.head);
  expect(afterState.order[newHeadIndex + 1]).toBe(seeded.child);
  expect(afterState.order[newHeadIndex - 1]).toBe(seeded.after);
  expect(afterState.indent(seeded.child)).toBe(1);
  // The row's left step stands on the indent (one nested-indent step).
  const childRow = rowOf(a, seeded.child);
  expect(await childRow.evaluate((el) => getComputedStyle(el).paddingLeft)).toBe("24px");

  // The other pane converges to the same flat order over the wire.
  await expect.poll(async () => (await rootState(b, "b")).order, SETTLE).toEqual(afterState.order);

  // One undo step restores the pre-drag order in both panes. The undo
  // hotkey reaches the doc only from inside the editor root, so click back
  // in first (the drag left the focus on the gutter handle).
  await a.locator(`[data-block-id="${seeded.head}"]`).first().locator('[data-slot="docblocks/block-content"]').click();
  await a.keyboard.press("Control+z");
  await expect.poll(async () => (await rootState(a, "a")).order, SETTLE).toEqual(before.order);
  await expect.poll(async () => (await rootState(b, "b")).order, SETTLE).toEqual(before.order);

  await close();
});

test("a list row at indent 1 drags within its level (the indent stands) and syncs", async ({ browser }) => {
  const { a, b, close } = await twoPanes(browser, "flatdrag-listlevel");

  const seeded = await a.evaluate(() => {
    const d = window.__paneDocs?.a ?? null;
    if (d === null) return null;
    const parent = d.insertBlock("list-item", { list: "bullet" });
    d.insertText(parent, 0, "parent item");
    const n1 = d.insertBlock("list-item", { list: "bullet", indent: 1 });
    d.insertText(n1, 0, "nested one");
    const n2 = d.insertBlock("list-item", { list: "bullet", indent: 1 });
    d.insertText(n2, 0, "nested two");
    return { parent, n1, n2 };
  });
  if (seeded === null) throw new Error("the pane's doc is not mounted");
  await a.waitForTimeout(600); // the enter animations settle (the boxes move with them)

  const outBefore = await outCount(a, "a");

  // Drag the second nested item up over the first (the vertical reorder of
  // a single row — a drop is a reorder, never a re-nest).
  const n1Row = rowOf(a, seeded.n1);
  const n2Row = rowOf(a, seeded.n2);
  const n1Box = await n1Row.boundingBox();
  const n2Box = await n2Row.boundingBox();
  if (n1Box === null || n2Box === null) throw new Error("the nested rows have no boxes");
  const handle = a.locator(`[data-block-id="${seeded.n2}"]`).first().locator('button[data-slot="docblocks/gutter"]');
  await handle.hover();
  const handleBox = await handle.boundingBox();
  if (handleBox === null) throw new Error("the gutter has no box");
  const fromY = handleBox.y + handleBox.height / 2;
  const toY = n1Box.y + n1Box.height * 0.25; // well above the n1 row's center
  await a.mouse.move(handleBox.x, fromY);
  await a.mouse.down();
  for (let i = 1; i <= 12; i++) {
    await a.mouse.move(n1Box.x + 40, fromY - ((fromY - toY) * i) / 12);
    await a.waitForTimeout(30);
  }
  await a.mouse.up();

  // One wire update; the two nested rows swap, both stay at indent 1
  // (their indent stands — the drag does not re-nest).
  await expect.poll(async () => outCount(a, "a"), SETTLE).toBe(outBefore + 1);
  const afterState = await rootState(a, "a");
  const parentIndex = afterState.order.indexOf(seeded.parent);
  expect(afterState.order[parentIndex + 1]).toBe(seeded.n2);
  expect(afterState.order[parentIndex + 2]).toBe(seeded.n1);
  expect(afterState.indent(seeded.n1)).toBe(1);
  expect(afterState.indent(seeded.n2)).toBe(1);

  // The other pane shows the reordered nested run over the wire.
  await expect.poll(async () => (await rootState(b, "b")).order, SETTLE).toEqual(afterState.order);

  await close();
});

test("a non-text row (a divider) drags by its row-level gutter handle", async ({ browser }) => {
  const { a, b, close } = await twoPanes(browser, "flatdrag-nontext");

  // The room starts with the panes' two seeded paragraphs; the pane's doc
  // handle adds a paragraph, a divider, and a paragraph (the divider is a
  // non-text row — its drag trigger is the row-level handle, not a
  // wrapper-internal one).
  const seeded = await a.evaluate(() => {
    const d = window.__paneDocs?.a ?? null;
    if (d === null) return null;
    const before = d.insertBlock("paragraph");
    d.insertText(before, 0, "before the divider");
    const divider = d.insertBlock("divider");
    const after = d.insertBlock("paragraph");
    d.insertText(after, 0, "after the divider");
    return { before, divider, after };
  });
  if (seeded === null) throw new Error("the pane's doc is not mounted");
  await a.waitForTimeout(600); // the enter animations settle (the boxes move with them)

  const outBefore = await outCount(a, "a");
  const beforeState = await rootState(a, "a");
  // The divider's row carries its own row-level gutter handle (the
  // non-text rows' drag trigger): the handle is a row child, not inside
  // the block's wrapper.
  const dividerRow = rowOf(a, seeded.divider);
  const dividerHandle = dividerRow.locator('button[data-slot="docblocks/gutter"]');
  expect(await dividerHandle.count()).toBe(1);
  expect(
    await a
      .locator(`[data-block-id="${seeded.divider}"]:not([data-slot="docblocks/row"])`)
      .first()
      .locator('button[data-slot="docblocks/gutter"]')
      .count()
  ).toBe(0);

  // Drag the divider above the "before" row (stepped moves so framer's
  // layout projection tracks the pointer).
  const beforeRow = rowOf(a, seeded.before);
  const dividerBox = await dividerRow.boundingBox();
  const beforeBox = await beforeRow.boundingBox();
  if (dividerBox === null || beforeBox === null) throw new Error("the rows have no boxes");
  await dividerHandle.hover();
  const handleBox = await dividerHandle.boundingBox();
  if (handleBox === null) throw new Error("the divider's row gutter has no box");
  const fromY = handleBox.y + handleBox.height / 2;
  const toY = beforeBox.y + beforeBox.height * 0.25; // well above the row's center
  await a.mouse.move(handleBox.x, fromY);
  await a.mouse.down();
  for (let i = 1; i <= 12; i++) {
    await a.mouse.move(beforeBox.x + 40, fromY + ((toY - fromY) * i) / 12);
    await a.waitForTimeout(30);
  }
  await a.mouse.up();

  // One wire update: the move was one command. The divider precedes the
  // "before" row, and the other pane converges to the same flat order.
  await expect.poll(async () => outCount(a, "a"), SETTLE).toBe(outBefore + 1);
  const afterState = await rootState(a, "a");
  const dividerIndex = afterState.order.indexOf(seeded.divider);
  expect(afterState.order[dividerIndex + 1]).toBe(seeded.before);
  await expect.poll(async () => (await rootState(b, "b")).order, SETTLE).toEqual(afterState.order);

  // One undo step restores the pre-drag order in both panes. The undo
  // hotkey reaches the doc only from inside the editor root, so click
  // back in first (the drag left the focus on the gutter handle).
  await a
    .locator(`[data-block-id="${seeded.before}"]`)
    .first()
    .locator('[data-slot="docblocks/block-content"]')
    .click();
  await a.keyboard.press("Control+z");
  await expect.poll(async () => (await rootState(a, "a")).order, SETTLE).toEqual(beforeState.order);
  await expect.poll(async () => (await rootState(b, "b")).order, SETTLE).toEqual(beforeState.order);

  await close();
});

test("a drop over the dragged block's own subtree is a stale drop (no command, the order resyncs)", async ({
  browser,
}) => {
  const { a, close } = await twoPanes(browser, "flatdrag-stale");

  const seeded = await a.evaluate(() => {
    const d = window.__paneDocs?.a ?? null;
    if (d === null) return null;
    const head = d.insertBlock("paragraph");
    d.insertText(head, 0, "stale head");
    const child = d.insertBlock("paragraph", { indent: 1 });
    d.insertText(child, 0, "stale child");
    return { head, child };
  });
  if (seeded === null) throw new Error("the pane's doc is not mounted");
  await a.waitForTimeout(600); // the enter animations settle (the boxes move with them)

  const before = await rootState(a, "a");
  const outBefore = await outCount(a, "a");

  // Drag the segment head down onto its own child's row: framer's virtual
  // order reorders (the child ahead of the head), but the commit maps it
  // back to the segment standing in place — a stale drop issues no
  // command, and the local row order resyncs to the store.
  const childRow = rowOf(a, seeded.child);
  const childBox = await childRow.boundingBox();
  if (childBox === null) throw new Error("the child row has no box");
  const handle = a.locator(`[data-block-id="${seeded.head}"]`).first().locator('button[data-slot="docblocks/gutter"]');
  await handle.hover();
  const handleBox = await handle.boundingBox();
  if (handleBox === null) throw new Error("the head's gutter has no box");
  await a.mouse.move(handleBox.x, handleBox.y + handleBox.height / 2);
  await a.mouse.down();
  await a.mouse.move(childBox.x + 40, childBox.y + childBox.height / 2, { steps: 16 });
  await a.mouse.up();

  // No doc update left the pane (the release committed nothing), and the
  // order stands in both panes.
  await a.waitForTimeout(500);
  expect(await outCount(a, "a")).toBe(outBefore);
  const now = await rootState(a, "a");
  expect(now.order).toEqual(before.order);
  expect(now.indent(seeded.child)).toBe(1);
  await expect.poll(async () => (await rootState(a, "a")).order, SETTLE).toEqual(before.order);

  await close();
});
