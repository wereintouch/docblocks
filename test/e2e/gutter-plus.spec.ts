// The gutter's quick insert (the plus under the item): one transact over
// the wire, the caret seated in the new block.
import { expect, test } from "@playwright/test";

import { SETTLE, insertBlockType, twoPanes } from "./helpers";

test("the gutter plus inserts an empty paragraph under the item", async ({ browser }) => {
  const { a, b, close } = await twoPanes(browser, "gutter-plus-text");
  const para = a.locator('[data-testid="doc-a"] [data-block-type="paragraph"]').first();
  await para.click();
  await a.keyboard.type("hello");

  // The plus stands in the gutter band (revealed on the row's hover); the
  // press inserts the empty paragraph right under the item.
  await para.hover();
  await a.locator('[data-testid="doc-a"] [data-slot="docblocks/gutter-plus"]').first().click();

  // The caret seat is frame-scheduled (the new inner renders after the
  // click): wait for the stand before the typing (the seat is the pin).
  const secondId: string | null = await a.evaluate(() => {
    const doc = window.__paneDocs?.a;
    if (doc === undefined || doc === null) return null;
    return doc.getChildren(doc.meta.id)[1] ?? null;
  });
  await a.waitForFunction(
    ({ id }) => {
      const inner = document.querySelector<HTMLElement>(
        `[data-testid="doc-a"] [data-block-id="${id}"][data-slot="docblocks/block-content"]`
      );
      const selection = window.getSelection();
      return (
        inner !== null && selection !== null && selection.anchorNode !== null && inner.contains(selection.anchorNode)
      );
    },
    { id: secondId! },
    { timeout: 15_000 }
  );
  // The typing lands in the new block, and the other pane sees the block
  // (and the text) over the wire.
  await a.keyboard.type("two");
  await expect
    .poll(async () => a.locator('[data-testid="doc-a"] [data-block-type="paragraph"]').count(), SETTLE)
    .toBe(2);
  const second = a.locator('[data-testid="doc-a"] [data-block-type="paragraph"]').nth(1);
  await expect.poll(async () => second.innerText(), SETTLE).toBe("two");
  await expect
    .poll(async () => b.locator('[data-testid="doc-b"] [data-block-type="paragraph"]').count(), SETTLE)
    .toBe(2);
  await expect
    .poll(async () => b.locator('[data-testid="doc-b"] [data-block-type="paragraph"]').nth(1).innerText(), SETTLE)
    .toBe("two");

  // Each keystroke is its own undo step (the single-region input commit):
  // three undos revert the typing, the fourth removes the inserted
  // paragraph — the document stands as before.
  await a.keyboard.press("Control+z");
  await a.keyboard.press("Control+z");
  await a.keyboard.press("Control+z");
  await expect.poll(async () => second.innerText(), SETTLE).toBe("");
  await a.keyboard.press("Control+z");
  await expect
    .poll(async () => a.locator('[data-testid="doc-a"] [data-block-type="paragraph"]').count(), SETTLE)
    .toBe(1);
  await expect.poll(async () => para.innerText(), SETTLE).toBe("hello");

  await close();
});

test("the row-level plus stands over a non-text row (the motion row)", async ({ browser }) => {
  const { a, close } = await twoPanes(browser, "gutter-plus-row");
  await insertBlockType(a, "a", "divider");

  // The provider's tail stand (the deterministic trailing paragraph after
  // the non-text block) settles after the harness insert — wait for it
  // before capturing the tail's id (the insert lands before the tail).
  await expect
    .poll(
      async () =>
        a.evaluate(() => {
          const doc = window.__paneDocs?.a;
          if (doc === undefined || doc === null) return 0;
          return doc.getChildren(doc.meta.id).length;
        }),
      SETTLE
    )
    .toBe(3);
  const tailId: string | null = await a.evaluate(() => {
    const doc = window.__paneDocs?.a;
    if (doc === undefined || doc === null) return null;
    const ids = doc.getChildren(doc.meta.id);
    return ids[ids.length - 1] ?? null;
  });
  expect(tailId).not.toBeNull();

  // The divider's row carries the row-level gutter affordance: the grip
  // and the plus.
  const row = a.locator('[data-testid="doc-a"] [data-slot="docblocks/row"]:has([data-block-type="divider"])').first();
  await row.hover();
  const plus = row.locator('[data-slot="docblocks/gutter-plus"]');
  await expect(plus).toHaveCount(1);
  await plus.click();

  // The root order stands [starter, divider, the inserted paragraph,
  // tail] — the inserted id is the new one, the tail stands in place.
  const after = await a.evaluate(() => {
    const doc = window.__paneDocs?.a;
    if (doc === undefined || doc === null) return null;
    return doc.getChildren(doc.meta.id);
  });
  await expect.poll(async () => after, SETTLE).not.toBeNull();
  const ids = after as string[];
  expect(ids).toHaveLength(4);
  expect(ids[2]).not.toBe(tailId);
  expect(ids[3]).toBe(tailId);

  await close();
});
