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
  await expect(page.getByTestId(`status-${client}`)).toHaveText("connected");
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

/** The pane's root order + one block's indent attr (the command API's view; the absent indent stands as 0). */
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
    indent: (id: string) => (doc.blocks[id]?.attrs as { indent?: number } | undefined)?.indent ?? 0,
  };
}

/** The wire log's outbound doc-update count (awareness frames are not logged). */
async function outCount(page: Page, client: "a" | "b"): Promise<number> {
  const text = await page.getByTestId(`wire-${client}`).innerText();
  return text.match(/\] out \d+B/g)?.length ?? 0;
}

/** The table's cell children's shape (rows → cells → the children's ids). */
async function tableCells(page: Page, client: "a" | "b", tableId: string): Promise<string[][][] | null> {
  return page.evaluate(
    ({ client, tableId }) => {
      const docs = window.__paneDocs;
      const doc = (client === "a" ? docs?.a : docs?.b) ?? null;
      if (doc === null) return null;
      return doc.getChildren(tableId).map((rowId) => doc.getChildren(rowId).map((cellId) => doc.getChildren(cellId)));
    },
    { client, tableId }
  );
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
 * A real pointer drag from a point to a point (the press/move/release
 * mechanics): move in steps (framer's layout projection tracks the
 * pointer only across rendered frames — a single fast move is batched
 * and crosses nothing), then the dwell (the layout projection's slide
 * (0.18s) settles, so the release's seam measurement stands over the
 * settled boxes).
 */
async function pressDragTo(page: Page, fromX: number, fromY: number, toX: number, toY: number): Promise<void> {
  await page.mouse.move(fromX, fromY);
  await page.mouse.down();
  for (let i = 1; i <= 12; i += 1) {
    await page.mouse.move(fromX + (toX - fromX) * (i / 12), fromY + ((toY - fromY) * i) / 12);
    await page.waitForTimeout(30);
  }
  for (let i = 0; i < 3; i += 1) {
    await page.mouse.move(toX, toY);
    await page.waitForTimeout(30);
  }
  await page.mouse.up();
}

/**
 * A real pointer drag of a row's gutter handle to a point (the
 * `pressDragTo` mechanics over the handle's center).
 */
async function dragGutterTo(page: Page, client: "a" | "b", index: number, toX: number, toY: number): Promise<void> {
  const handle = gutter(page, client, index);
  await handle.hover();
  const from = await handle.boundingBox();
  if (from === null) throw new Error("the gutter has no box");
  await pressDragTo(page, from.x, from.y + from.height / 2, toX, toY);
}

test("a gutter drag reorders the block, syncs to the other pane, and undoes as one step", async ({ browser }) => {
  const { a, b, close } = await twoPanes(browser, "ui04b-reorder");

  // The room starts with pane "a"'s single starter (both panes see it).
  await expect(wrappers(a, "a")).toHaveCount(1);
  await expect(wrappers(b, "b")).toHaveCount(1);

  // Two more paragraphs via the pane's insert hook (the inserted block is
  // current, so it is labeled), with unique texts for the assertions.
  await insertBlockType(a, "a", "paragraph");
  await currentWrapper(a, "a").locator('[data-slot="docblocks/block-content"]').first().click();
  await a.keyboard.type("one");
  await insertBlockType(a, "a", "paragraph");
  await currentWrapper(a, "a").locator('[data-slot="docblocks/block-content"]').first().click();
  await a.keyboard.type("two");
  await expect(wrappers(a, "a")).toHaveCount(3);
  await expect(wrappers(b, "b")).toHaveCount(3);

  const lastId = await wrapperId(a, "a", 2);
  expect(lastId).not.toBe("");
  const firstBox = await wrappers(a, "a").nth(0).boundingBox();
  const lastBox = await wrappers(a, "a").nth(2).boundingBox();
  if (firstBox === null || lastBox === null) throw new Error("the wrappers have no boxes");

  // Drag the last block above the first one (the pointer lands inside the
  // viewport, so the drag does not trigger page auto-scroll).
  await dragGutterTo(a, "a", 2, lastBox.x + 20, firstBox.y + firstBox.height / 4);

  // The order changed in A and reached B over the wire (B shows the new
  // order as the update arrives).
  await expect(wrappers(a, "a").first()).toHaveAttribute("data-block-id", lastId);
  await expect(wrappers(b, "b").first()).toHaveAttribute("data-block-id", lastId);

  // The drag is A's local undo entry (one command, one undoable unit):
  // the order reverts in both panes.
  await a.keyboard.press("Control+z");
  await expect(wrappers(a, "a").first()).not.toHaveAttribute("data-block-id", lastId);
  await expect(wrappers(b, "b").first()).not.toHaveAttribute("data-block-id", lastId);

  await close();
});

test("a drag back to the same position issues no command", async ({ browser }) => {
  const { a, close } = await twoPanes(browser, "ui04b-noop");

  await expect(wrappers(a, "a")).toHaveCount(1);
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

// The seam's indent (the drop's two-variant rule): a drop at the seam between
// the row A (before) and the row B (after) stands the dragged block's head at
// one of the seam's indents — the row the pointer stands over (its upper or
// lower half is the same seam's side), in the gap between the rows the pointer's
// half decides (the upper stands the head before B — B's indent — the lower
// after A — A's indent). The head's own indent is not a variant for a real
// move; the derived segment shifts by the delta, the relative structure stands
// (one transact — one undo step, one wire update).

/**
 * The doc's seed for the seam pins: p0 (0), p1 (1 — p0's child via Tab),
 * p2 (0), p3 (0). Returns the wrappers' ids in order.
 */
async function seedSeamDoc(a: Page, client: "a" | "b"): Promise<string[]> {
  await insertBlockType(a, client, "paragraph");
  await insertBlockType(a, client, "paragraph");
  await insertBlockType(a, client, "paragraph");
  // p1 (the second block) indents one level (the Tab gesture) — the chain
  // p0 (0) / p1 (1) / p2 (0) / p3 (0).
  await wrappers(a, client).nth(1).locator('[data-slot="docblocks/block-content"]').click();
  await a.keyboard.press("Tab");
  const now = await rootState(a, client);
  expect(now.order).toHaveLength(4);
  expect(now.indent(now.order[1]!)).toBe(1);
  return now.order;
}

test("a drop over B's upper half stands the head at B's indent (the seam's deeper variant)", async ({ browser }) => {
  const { a, b, close } = await twoPanes(browser, "ui04e-seam-upper");
  await seedSeamDoc(a, "a");
  const orderNow = (await rootState(a, "a")).order;
  expect(orderNow).toHaveLength(4);
  const [p0, p1, p2, p3] = orderNow;

  // Drag p2 (indent 0) up over p1 (indent 1)'s upper half: the head lands
  // before p1 at p1's level — the seam's deeper variant (p2's own indent 0
  // is not a candidate).
  const outBefore = await outCount(a, "a");
  const p1Box = (await wrappers(a, "a").nth(1).boundingBox())!;
  await dragGutterTo(a, "a", 2, p1Box.x + 30, p1Box.y + 6);

  // The release's commit rides framer's rAF after the pointerup — poll the
  // a-pane's order to the drop before asserting the committed state.
  await expect.poll(async () => (await rootState(a, "a")).order, SETTLE).toEqual([p0, p2, p1, p3]);
  const after = await rootState(a, "a");
  expect(after.indent(p2!)).toBe(1); // the head stood at the seam's neighbor's level
  expect(after.indent(p1!)).toBe(1); // the neighbor stands
  // One wire update reached B; the order and the indent synced.
  expect(await outCount(a, "a")).toBe(outBefore + 1);
  await expect.poll(async () => (await rootState(b, "b")).order, SETTLE).toEqual([p0, p2, p1, p3]);
  await expect.poll(async () => (await rootState(b, "b")).indent(p2!), SETTLE).toBe(1);
  // One undo step restores the position and the indent at once.
  await a.keyboard.press("Control+z");
  await expect.poll(async () => (await rootState(a, "a")).order, SETTLE).toEqual([p0, p1, p2, p3]);
  await expect.poll(async () => (await rootState(a, "a")).indent(p2!), SETTLE).toBe(0);
  expect(await outCount(a, "a")).toBe(outBefore + 2);

  await close();
});

test("a drop over A's lower half stands the head at A's indent (the seam's shallower variant)", async ({ browser }) => {
  const { a, b, close } = await twoPanes(browser, "ui04e-seam-lower");
  await seedSeamDoc(a, "a");
  const orderNow = (await rootState(a, "a")).order;
  expect(orderNow).toHaveLength(4);
  const [p0, p1, p2, p3] = orderNow;

  // Drag p2 (indent 0) up into the gap below p0 (the gap's lower half —
  // the seam's "after A" side): the head lands after p0 at p0's level
  // (the seam's shallower variant — p2's own indent stands, because the
  // variant equals it).
  const outBefore = await outCount(a, "a");
  const p0Box = (await wrappers(a, "a").nth(0).boundingBox())!;
  await dragGutterTo(a, "a", 2, p0Box.x + 30, p0Box.y + p0Box.height + 6);

  await expect.poll(async () => (await rootState(a, "a")).order, SETTLE).toEqual([p0, p2, p1, p3]);
  const after = await rootState(a, "a");
  expect(after.indent(p2!)).toBe(0);
  expect(await outCount(a, "a")).toBe(outBefore + 1);
  await expect.poll(async () => (await rootState(b, "b")).order, SETTLE).toEqual([p0, p2, p1, p3]);
  await expect.poll(async () => (await rootState(b, "b")).indent(p2!), SETTLE).toBe(0);

  await close();
});

test("a root block dragged into a deep seam stands at the seam's level (the root variant is not offered)", async ({
  browser,
}) => {
  const { a, close } = await twoPanes(browser, "ui04e-seam-deep");
  await seedSeamDoc(a, "a");
  const orderNow = (await rootState(a, "a")).order;
  expect(orderNow).toHaveLength(4);
  const [p0, p1, p2, p3] = orderNow;
  // p2 indents to 2 (p1's child, two Tab steps): the chain p0 (0) / p1 (1) /
  // p2 (2) / p3 (0) — a seam of indents 1 and 2.
  await wrappers(a, "a").nth(2).locator('[data-slot="docblocks/block-content"]').click();
  await a.keyboard.press("Tab");
  await a.keyboard.press("Tab");
  const chain = await rootState(a, "a");
  expect(chain.indent(p2!)).toBe(2);

  // Drag p3 (indent 0) into the seam over p2 (indent 2)'s upper half: the
  // candidate is 2 (p2's indent) — p3's own root indent is not a variant.
  const p2Box = (await wrappers(a, "a").nth(2).boundingBox())!;
  await dragGutterTo(a, "a", 3, p2Box.x + 30, p2Box.y + 6);

  await expect.poll(async () => (await rootState(a, "a")).order, SETTLE).toEqual([p0, p1, p3, p2]);
  const after = await rootState(a, "a");
  expect(after.indent(p3!)).toBe(2);
  expect(after.indent(p2!)).toBe(2);

  await close();
});

test("a segment dragged to a shallower seam shifts the whole segment by the delta (one undo step, one wire update)", async ({
  browser,
}) => {
  const { a, b, close } = await twoPanes(browser, "ui04e-segment-delta");
  await seedSeamDoc(a, "a");
  const orderNow = (await rootState(a, "a")).order;
  expect(orderNow).toHaveLength(4);
  const [p0, p1, p2, p3] = orderNow;
  // p2 indents to 2 (p1's child, two Tab steps): p1's segment is [p1 (1),
  // p2 (2)].
  await wrappers(a, "a").nth(2).locator('[data-slot="docblocks/block-content"]').click();
  await a.keyboard.press("Tab");
  await a.keyboard.press("Tab");

  // Drag p1's segment to the end, below p3: the seam's only neighbor is p3
  // (indent 0) — the candidate 0, the delta -1: p1 stands at 0, p2 shifts
  // 2 -> 1 (the relative structure stands).
  const outBefore = await outCount(a, "a");
  const p3Box = (await wrappers(a, "a").nth(3).boundingBox())!;
  await dragGutterTo(a, "a", 1, p3Box.x + 30, p3Box.y + p3Box.height + 10);

  await expect.poll(async () => (await rootState(a, "a")).order, SETTLE).toEqual([p0, p3, p1, p2]);
  const after = await rootState(a, "a");
  expect(after.indent(p1!)).toBe(0);
  expect(after.indent(p2!)).toBe(1);
  // One wire update (the move and both indents ride the single transact);
  // B's JSON carries the shifted segment.
  expect(await outCount(a, "a")).toBe(outBefore + 1);
  await expect.poll(async () => (await rootState(b, "b")).order, SETTLE).toEqual([p0, p3, p1, p2]);
  await expect.poll(async () => (await rootState(b, "b")).indent(p2!), SETTLE).toBe(1);
  // One undo step restores the position and both indents.
  await a.keyboard.press("Control+z");
  const undone = await rootState(a, "a");
  expect(undone.order).toEqual([p0, p1, p2, p3]);
  expect(undone.indent(p1!)).toBe(1);
  expect(undone.indent(p2!)).toBe(2);
  expect(await outCount(a, "a")).toBe(outBefore + 2);

  await close();
});

test("a drop at the sequence's start stands the head at the first block's indent", async ({ browser }) => {
  const { a, close } = await twoPanes(browser, "ui04e-seam-start");
  await seedSeamDoc(a, "a");
  const orderNow = (await rootState(a, "a")).order;
  expect(orderNow).toHaveLength(4);
  const [p0, p1, p2, p3] = orderNow;

  // Drag p1 (indent 1) above the first row: the seam's only neighbor is the
  // first block (indent 0) — the "predecessor of the first" candidate.
  const p0Box = (await wrappers(a, "a").nth(0).boundingBox())!;
  await dragGutterTo(a, "a", 1, p0Box.x + 30, p0Box.y - 12);

  await expect.poll(async () => (await rootState(a, "a")).order, SETTLE).toEqual([p1, p0, p2, p3]);
  const after = await rootState(a, "a");
  expect(after.indent(p1!)).toBe(0);

  await close();
});

test("the drag's live preview stands the moving row at the seam's candidate (the doc is untouched until the release)", async ({
  browser,
}) => {
  const { a, close } = await twoPanes(browser, "ui04e-seam-preview");
  await seedSeamDoc(a, "a");
  const orderNow = (await rootState(a, "a")).order;
  expect(orderNow).toHaveLength(4);
  const [p0, p1, p2, p3] = orderNow;

  const rowOf = (id: string) => a.locator(`[data-slot="docblocks/row"]:has([data-block-id="${id}"])`);
  const paddingOf = (id: string) => rowOf(id).evaluate((el) => getComputedStyle(el).paddingLeft);

  const outBefore = await outCount(a, "a");
  const baseP2 = await paddingOf(p2!); // the row's own indent's padding
  const targetP1 = await paddingOf(p1!); // the seam's deeper neighbor's padding

  // A manual drag: press p2's handle, move over p1's upper half, hold.
  const handle = a.locator(`[data-block-id="${p2}"]`).first().locator('button[data-slot="docblocks/gutter"]');
  await handle.hover();
  const from = (await handle.boundingBox())!;
  const p1Box = (await rowOf(p1!).boundingBox())!;
  const toX = p1Box.x + 30;
  const toY = p1Box.y + 6;
  await a.mouse.move(from.x, from.y + from.height / 2);
  await a.mouse.down();
  for (let i = 1; i <= 12; i += 1) {
    await a.mouse.move(
      from.x + (toX - from.x) * (i / 12),
      from.y + from.height / 2 + (toY - (from.y + from.height / 2)) * (i / 12)
    );
    await a.waitForTimeout(30);
  }
  // The dwell at the target (the slide settles — the preview stands over
  // the settled boxes).
  for (let i = 0; i < 3; i += 1) {
    await a.mouse.move(toX, toY);
    await a.waitForTimeout(30);
  }
  // Mid-drag: the row's padding stands at the seam's candidate (the target
  // row's padding), not its own — and no doc update left the pane (the
  // preview is a pure visual).
  expect(await paddingOf(p2!)).toBe(targetP1);
  expect(await paddingOf(p2!)).not.toBe(baseP2);
  expect(await outCount(a, "a")).toBe(outBefore);

  // The release commits the same value the preview stood: p2 stands at p1's
  // indent (the commit rides framer's rAF after the pointerup — the order
  // polls to the drop).
  await a.mouse.up();
  await expect.poll(async () => (await rootState(a, "a")).order, SETTLE).toEqual([p0, p2, p1, p3]);
  const after = await rootState(a, "a");
  expect(after.indent(p2!)).toBe(1);
  expect(await paddingOf(p2!)).toBe(targetP1); // the preview stood where the drop landed

  await close();
});

test("a peer deleting the dragged row mid-drag leaves the pane resynced (no stuck drag session)", async ({
  browser,
}) => {
  const { a, b, close } = await twoPanes(browser, "ui04b-drag-stuck");
  try {
    // Three paragraphs (the starter + two inserts) with unique texts.
    await insertBlockType(a, "a", "paragraph");
    await currentWrapper(a, "a").locator('[data-slot="docblocks/block-content"]').first().click();
    await a.keyboard.type("one");
    await insertBlockType(a, "a", "paragraph");
    await currentWrapper(a, "a").locator('[data-slot="docblocks/block-content"]').first().click();
    await a.keyboard.type("two");
    await expect(wrappers(a, "a")).toHaveCount(3);

    const draggedId = await wrapperId(a, "a", 1);
    expect(draggedId).not.toBe("");
    const handle = gutter(a, "a", 1);
    await handle.hover();
    const from = await handle.boundingBox();
    const lastRow = await rowOf(a, await wrapperId(a, "a", 2)).boundingBox();
    if (from === null || lastRow === null) throw new Error("the rows have no boxes");
    const fromY = from.y + from.height / 2;
    const toY = lastRow.y + lastRow.height + 30;

    // The drag: press the handle, move the row below the last one...
    await a.mouse.move(from.x, fromY);
    await a.mouse.down();
    for (let i = 1; i <= 10; i += 1) {
      await a.mouse.move(from.x, fromY + ((toY - fromY) * i) / 10);
      await a.waitForTimeout(30);
    }
    // ...and the peer deletes the dragged row while the pointer is down.
    await b.evaluate((id) => {
      const doc = window.__paneDocs?.b;
      if (doc === null || doc === undefined) throw new Error("the pane's doc is not mounted");
      doc.removeBlock(id);
    }, draggedId);
    await a.waitForTimeout(400);
    await a.mouse.up();

    // The pane resyncs: the rendered rows stand the store's sequence
    // (the dragged row is gone, the survivors in the doc order).
    await expect
      .poll(async () => {
        const { order } = await rootState(a, "a");
        const rows = await a.evaluate((client) => {
          const root = document.querySelector(`[data-testid="doc-${client}"]`);
          if (root === null) return null;
          return Array.from(root.querySelectorAll('[data-slot="docblocks/row"]')).map((row) => {
            const el = row.querySelector<HTMLElement>("[data-block-id]");
            return el === null ? null : el.getAttribute("data-block-id");
          });
        }, "a");
        if (rows === null) return false;
        return rows.length === order.length && rows.every((id, i) => id === order[i]);
      }, SETTLE)
      .toBe(true);

    // The resync stays alive: a peer insert reaches the pane (a stuck
    // session would skip the render-phase resync and hide it).
    await b.evaluate(() => {
      const doc = window.__paneDocs?.b;
      if (doc === null || doc === undefined) throw new Error("the pane's doc is not mounted");
      const seq = doc.getChildren(doc.meta.id);
      const id = doc.insertBlock("paragraph", undefined, { parent: doc.meta.id, after: seq[0] });
      doc.insertText(id, 0, "fresh");
      return id;
    });
    const freshText = a.locator('[data-testid="doc-a"] [data-slot="docblocks/block-content"]', {
      hasText: "fresh",
    });
    await expect(freshText).toBeVisible();
  } finally {
    await close();
  }
});

test("a page drag over a table crosses the row in the root sequence; the cell's children stand invariant", async ({
  browser,
}) => {
  const { a, b, close } = await twoPanes(browser, "ui03c-table-drag");
  try {
    // The scene: the starter paragraph, the table, the "after" paragraph
    // (the insert hook's tail order). The tail guarantee (the
    // EditorProvider's contract) may stand its empty paragraph behind the
    // non-text table — drag by ids, not by position. The pane-scoped rows
    // — not `rowOf` (unscoped — the two panes render the same ids) and not
    // the wrappers' count (the table's rows / cells stand nested
    // `data-block-id` elements of their own).
    const paneRow = (id: string) =>
      a.locator(`[data-testid="doc-a"] [data-slot="docblocks/row"]:has([data-block-id="${id}"])`).first();
    const tableId = await insertBlockType(a, "a", "table");
    const afterId = await insertBlockType(a, "a", "paragraph");
    await currentWrapper(a, "a").locator('[data-slot="docblocks/block-content"]').first().click();
    await a.keyboard.type("after");
    await expect.poll(async () => paneRow(afterId).count(), SETTLE).toBe(1);
    const order = (await rootState(a, "a")).order;
    expect(order).toContain(tableId);
    expect(order).toContain(afterId);
    const starterId = order[0] as string;
    expect(starterId).not.toBe("");

    // The cell's children's shape before the drag (the harness's cell
    // paragraphs — the invariant is the shape, not emptiness).
    const cellsBefore = await tableCells(a, "a", tableId);
    expect(cellsBefore).not.toBeNull();

    // Drag the "after" paragraph above the table: the drop crosses the
    // table's row — the landing stands in the ROOT sequence (the table's
    // children stand no seam: the flat view carries no nesting), so no
    // block lands in a cell's children over the page drag (the
    // registry-legal cell move stands the public core API, not the drag).
    const tableRow = paneRow(tableId);
    const tableBox = await tableRow.boundingBox();
    if (tableBox === null) throw new Error("the table row has no box");
    const afterRow = paneRow(afterId);
    const afterBox = await afterRow.boundingBox();
    if (afterBox === null) throw new Error("the after row has no box");
    const handle = afterRow.locator('button[data-slot="docblocks/gutter"]');
    await handle.hover();
    const from = await handle.boundingBox();
    if (from === null) throw new Error("the gutter has no box");
    await pressDragTo(a, from.x, from.y + from.height / 2, afterBox.x + 20, tableBox.y + tableBox.height / 4);

    // The order stands: "after" at the front, the rest (the table + the
    // tail paragraph, if it stood) in their relative order — in both
    // panes (the wire).
    const expected = [starterId, afterId, ...order.filter((id) => id !== starterId && id !== afterId)];
    await expect.poll(async () => (await rootState(a, "a")).order, SETTLE).toEqual(expected);
    await expect.poll(async () => (await rootState(b, "b")).order, SETTLE).toEqual(expected);

    // The cell's children stand invariant (nothing moved into / out of a
    // cell's children over the drag) — wait for the stand to settle (a
    // one-shot read can catch the doc mid-move-commit under full-suite load).
    await expect.poll(async () => tableCells(a, "a", tableId), SETTLE).toEqual(cellsBefore);
  } finally {
    await close();
  }
});
