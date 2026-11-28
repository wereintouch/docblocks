// The drag's live / in-flight stands over the flat-model drag: the live
// preview (the moving row stands at the seam's candidate, the doc
// untouched until the release) and a peer deleting the dragged row
// mid-drag (the pane resyncs, no stuck drag session).
import { type Page, expect, test } from "@playwright/test";

import { SETTLE, expectStays, insertBlockType, outCount, twoPanes } from "./helpers";

// The two-pane's settle stands the default 30s budget at its edge (the 15s
// SETTLE's panes + the page loads): the raised budget keeps the timeout
// class out of the loaded machine's flake zone (a true stall stays visible).
test.setTimeout(45_000);

function pane(page: Page, client: "a" | "b") {
  return page.locator(`[data-testid="doc-${client}"]`);
}

/** The pane's block wrappers (the inner editables are not blocks). */
function wrappers(page: Page, client: "a" | "b") {
  return pane(page, client).locator('[data-slot="docblocks/row"]');
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

test("the drag's live preview stands the moving row at the seam's candidate (the doc is untouched until the release)", async ({
  browser,
}) => {
  const { a, close } = await twoPanes(browser, "seam-live-preview");
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
  await a.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await a.mouse.down();
  for (let i = 1; i <= 12; i += 1) {
    await a.mouse.move(
      from.x + from.width / 2 + (toX - (from.x + from.width / 2)) * (i / 12),
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
  // preview is a pure visual — the window's stand).
  expect(await paddingOf(p2!)).toBe(targetP1);
  expect(await paddingOf(p2!)).not.toBe(baseP2);
  await expectStays(async () => {
    expect(await outCount(a, "a")).toBe(outBefore);
  });

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
  const { a, b, close } = await twoPanes(browser, "drag-peer-delete-resync");
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
    const fromX = from.x + from.width / 2; // the handle's center (the edge pixel's hit-test stands engine-divergent)
    await a.mouse.move(fromX, fromY);
    await a.mouse.down();
    for (let i = 1; i <= 10; i += 1) {
      await a.mouse.move(fromX, fromY + ((toY - fromY) * i) / 10);
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
