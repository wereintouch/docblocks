// The document's tail contract (a non-text last block stands no caret
// home): the editor keeps an editable empty paragraph over any non-text
// tail — the local gestures (the removal, the slash's insert, the drag's
// commit) stand it inside their one transact, and a peer's write that
// leaves the tail non-text stands it over the wire (the provider's remote
// feed). The standing paragraph is the tail's delete affordance: the
// database card renders no gutter (its own contract), so the Backspace
// over the trailing empty paragraph is what removes the block.
//
import { type Page, expect, test } from "@playwright/test";

import { SETTLE, insertBlockType, twoPanes } from "./helpers";

/** The pane A's root children as `type[]` from the live doc. */
function rootTypes(page: Page) {
  return page.evaluate(() => {
    const doc = window.__paneDocs?.a;
    if (!doc) return null;
    return doc.getChildren(doc.meta.id).map((id) => doc.getBlock(id)?.type ?? null);
  });
}

/** The pane A's trailing paragraph's inner (the caret's home). */
function tailInner(page: Page) {
  return page
    .locator('[data-testid="doc-a"]')
    .locator('[data-block-type="paragraph"]')
    .last()
    .locator('[data-slot="docblocks/block-content"]');
}

test("a non-text tail stands the editable trailing paragraph; the tail is deletable from it", async ({ browser }) => {
  const { a, b, close } = await twoPanes(browser, "tail-stand");
  const docA = a.locator('[data-testid="doc-a"]');

  // The room's starter line plus the database at the sequence's end: the
  // non-text tail stands its editable paragraph (the change feed's guard).
  await expect(docA.locator('[data-block-type="paragraph"]').first()).toBeVisible();
  await insertBlockType(a, "a", "database");
  await expect.poll(async () => (await rootTypes(a)) ?? [], SETTLE).toEqual(["paragraph", "database", "paragraph"]);

  // The trailing paragraph is the caret's home: it stands empty and takes
  // the focus (the scenario — the tail was undeletable without a
  // following empty block; the database card renders no gutter, so the
  // Backspace over the trailing line is the delete affordance).
  const inner = tailInner(a);
  await inner.click();
  await expect(inner).toBeFocused();
  await a.keyboard.press("Backspace");
  await expect(docA.locator('[data-block-type="database"]')).toHaveCount(0);
  await expect(b.locator('[data-block-type="database"]')).toHaveCount(0);
  // The database is gone; the caret's paragraph stands the tail (the
  // starter line keeps its seat).
  await expect.poll(async () => (await rootTypes(a)) ?? [], SETTLE).toEqual(["paragraph", "paragraph"]);
  // The undo restores the database and its trailing paragraph together.
  await a.keyboard.press("Control+z");
  await expect.poll(async () => (await rootTypes(a)) ?? [], SETTLE).toEqual(["paragraph", "database", "paragraph"]);

  await close();
});

test("a removal that leaves a non-text tail stands the trailing paragraph", async ({ browser }) => {
  const { a, b, close } = await twoPanes(browser, "tail-delete");
  const docA = a.locator('[data-testid="doc-a"]');

  // The room's starter line, then an image and the database at the end in
  // one write (one remote update over the wire — one guard stand): the
  // non-text tail stands its paragraph.
  await expect(docA.locator('[data-block-type="paragraph"]').first()).toBeVisible();
  await a.evaluate(() => {
    const doc = window.__paneDocs!.a!;
    doc.transact(() => {
      doc.insertBlock("image", { src: "tail-blob" });
      doc.insertBlock("database", { columns: [{ id: "name", name: "Name", type: "text" }] });
    });
  });
  await expect
    .poll(async () => (await rootTypes(a)) ?? [], SETTLE)
    .toEqual(["paragraph", "image", "database", "paragraph"]);

  // The Backspace over the trailing line removes the database: the image
  // stands the tail behind the caret's own paragraph (the tail stays text —
  // the guard stays idle).
  const inner = tailInner(a);
  await inner.click();
  await a.keyboard.press("Backspace");
  await expect(docA.locator('[data-block-type="database"]')).toHaveCount(0);
  await expect.poll(async () => (await rootTypes(a)) ?? [], SETTLE).toEqual(["paragraph", "image", "paragraph"]);
  // Pane B's view matches over the wire (three blocks stand: the image's
  // unresolvable blob renders the placeholder card, the paragraphs their
  // lines).
  await expect.poll(async () => b.locator("[data-block-type]").count(), SETTLE).toBe(3);

  await close();
});

test("a drag that would land a non-text segment at the sequence's end stands the trailing paragraph (the preview's seat)", async ({
  browser,
}) => {
  const { a, close } = await twoPanes(browser, "tail-drag-seat");

  // [P, DB, P, P, P]: the starter line, the database after it, and three
  // more paragraphs (the last one stands the tail).
  await a.evaluate(() => {
    const doc = window.__paneDocs!.a!;
    doc.transact(() => {
      const first = doc.getChildren(doc.meta.id)[0]!;
      const db = doc.insertBlock("database", { tableId: "table-1" }, { after: first });
      doc.insertBlock("paragraph", undefined, { parent: doc.meta.id, after: db });
      doc.insertBlock("paragraph", undefined, { parent: doc.meta.id, after: db });
      doc.insertBlock("paragraph", undefined, { parent: doc.meta.id, after: db });
    });
  });
  await expect
    .poll(async () => (await rootTypes(a)) ?? [], SETTLE)
    .toEqual(["paragraph", "database", "paragraph", "paragraph", "paragraph"]);

  // Drag the database's gutter handle down to the sequence's bottom: the
  // preview's seat is clamped to just above the trailing paragraph (the
  // segment's non-text tail may not stand the doc's tail), and the commit
  // stands that same seat — no new paragraph, the trailing one stays last.
  const rows = a.locator('[data-testid="doc-a"] [data-slot="docblocks/block"]');
  const dbRow = a.locator('[data-testid="doc-a"] [data-slot="docblocks/block"][data-block-type="database"]');
  const handle = dbRow.locator("xpath=..").locator('button[data-slot="docblocks/gutter"]').first();
  await handle.hover();
  const hBox = (await handle.boundingBox())!;
  const lastBox = (await rows.last().boundingBox())!;
  await a.mouse.move(hBox.x + hBox.width / 2, hBox.y + hBox.height / 2);
  await a.mouse.down();
  for (let i = 1; i <= 12; i += 1) {
    await a.mouse.move(hBox.x + hBox.width / 2, hBox.y + ((lastBox.y + lastBox.height - 4 - hBox.y) * i) / 12);
  }
  await a.mouse.up();
  await expect
    .poll(async () => (await rootTypes(a)) ?? [], SETTLE)
    .toEqual(["paragraph", "paragraph", "paragraph", "database", "paragraph"]);
  // One undo step reverts the seat (the database stands back, the tail
  // stands as it was — no inserted paragraph to undo): the release parks
  // the focus on the editor root, so the hotkey reaches the doc's undo.
  await a.keyboard.press("Control+z");
  await expect
    .poll(async () => (await rootTypes(a)) ?? [], SETTLE)
    .toEqual(["paragraph", "database", "paragraph", "paragraph", "paragraph"]);

  await close();
});
