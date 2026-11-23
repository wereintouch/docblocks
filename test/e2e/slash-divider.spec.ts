// The divider over the slash command: the trailing empty paragraph at the document's end
// (the caret's stand), the middle's no-paragraph stand, and the trailing divider's delete
// through the row's gutter.
import { type Browser, type Page, expect, test } from "@playwright/test";

import { RELAY, SETTLE, caretIn, editorContext } from "./helpers";

/**
 * A unique room per test: the relay keeps rooms for the dev server's
 * lifetime, so a fixed name would accumulate the content of failed attempts
 * across runs.
 */
async function openPanes(browser: Browser, seed: string): Promise<{ a: Page; b: Page; close: () => Promise<void> }> {
  const room = `${seed}-${Math.random().toString(36).slice(2, 8)}`;
  const contextA = await editorContext(browser);
  const contextB = await editorContext(browser);
  const a = await contextA.newPage();
  const b = await contextB.newPage();
  await a.goto(`/?client=a&syncUrl=${RELAY}/${room}`);
  await expect(a.getByTestId("status-a")).toHaveText("connected");
  await b.goto(`/?client=b&syncUrl=${RELAY}/${room}`);
  await expect(b.getByTestId("status-b")).toHaveText("connected");
  return {
    a,
    b,
    close: async () => {
      await contextA.close();
      await contextB.close();
    },
  };
}

function inner(page: Page, client: "a" | "b") {
  return page.locator(`[data-testid="doc-${client}"] [data-slot="docblocks/block-content"]`).first();
}

function menu(page: Page) {
  return page.locator('[data-slot="docblocks/slash-menu"]');
}

test("a divider landing at the document end gets a trailing empty paragraph (the caret stands there)", async ({
  browser,
}) => {
  const { a, close } = await openPanes(browser, "slash-divider-end");
  const target = inner(a, "a");
  await target.click();

  // The starter paragraph is phrase-only: the Divider command replaces
  // it — the divider lands at the sequence's end.
  await a.keyboard.type("/divider");
  await expect(menu(a)).toBeVisible();
  await a.keyboard.press("Enter");

  // A trailing empty paragraph stands after the divider (the divider is
  // not editable — without it there is no way to keep typing). The room
  // may carry re-run leftovers before the suffix (the relay keeps rooms
  // for its lifetime) — the suffix is the contract.
  const suffix = await a.evaluate(() => {
    const doc = window.__paneDocs?.a ?? null;
    if (doc === null) return null;
    const ids = doc.getChildren(doc.meta.id);
    return ids.slice(-2).map((id) => ({ id, type: doc.getBlock(id)?.type ?? null }));
  });
  expect(suffix).toEqual([
    { id: expect.any(String), type: "divider" },
    { id: expect.any(String), type: "paragraph" },
  ]);
  // The caret seats in the trailing paragraph in the next frame (the
  // post-apply focus move) — wait for it before typing. The shared page
  // container is the focused element; the caret's seat is the live
  // selection's.
  const trailingId = suffix?.[1]?.id ?? "";
  expect(trailingId).toEqual(expect.any(String));
  const trailingInner = a.locator(`[data-block-id="${trailingId}"] [data-slot="docblocks/block-content"]`);
  await expect
    .poll(() => caretIn(a, `[data-block-id="${trailingId}"] [data-slot="docblocks/block-content"]`), SETTLE)
    .toBe(true);
  await trailingInner.click();
  await a.keyboard.type("hello");
  const text = await a.evaluate((id) => {
    const doc = window.__paneDocs?.a ?? null;
    return doc === null || id === "" ? null : doc.getText(id);
  }, trailingId ?? "");
  expect(text).toBe("hello");
  await close();
});

test("a divider in the middle of the document gets no trailing paragraph", async ({ browser }) => {
  const { a, close } = await openPanes(browser, "slash-divider-middle");

  // Two seeded paragraphs after the starter: the trigger stands in the
  // middle (the replacement lands between two live blocks). The room may
  // carry re-run leftovers — the assertion scopes to the seeded tail.
  const seeded = await a.evaluate(() => {
    const doc = window.__paneDocs?.a ?? null;
    if (doc === null) return null;
    let mid = "";
    let tail = "";
    doc.transact(() => {
      mid = doc.insertBlock("paragraph");
      tail = doc.insertBlock("paragraph");
      doc.insertText(tail, 0, "middle");
    });
    return { mid, tail };
  });
  expect(seeded?.mid).toEqual(expect.any(String));
  const midInner = a.locator(`[data-block-id="${seeded?.mid}"] [data-slot="docblocks/block-content"]`);
  await midInner.click();
  await a.keyboard.type("/divider");
  await expect(menu(a)).toBeVisible();
  await a.keyboard.press("Enter");

  // The divider lands in the middle: a paragraph stands before it, and
  // the sequence continues with the seeded tail (no trailing paragraph
  // is synthesized — the tail is the seeded block, not a new empty one).
  const shape = await a.evaluate((tail) => {
    const doc = window.__paneDocs?.a ?? null;
    if (doc === null || tail === "") return null;
    const ids = doc.getChildren(doc.meta.id);
    const at = ids.indexOf(tail);
    if (at < 2) return null;
    const before2 = doc.getBlock(ids[at - 2]!);
    const before1 = doc.getBlock(ids[at - 1]!);
    return {
      before2: before2 === null || before2 === undefined ? null : before2.type,
      before1: before1 === null || before1 === undefined ? null : before1.type,
      tailText: doc.getText(tail),
    };
  }, seeded?.tail ?? "");
  expect(shape).toEqual({ before2: "paragraph", before1: "divider", tailText: "middle" });
  await close();
});

test("a trailing divider deletes through its row's gutter (the blocks selection's Delete)", async ({ browser }) => {
  const { a, close } = await openPanes(browser, "slash-divider-delete");
  const target = inner(a, "a");
  await target.click();
  await a.keyboard.type("/divider");
  await expect(menu(a)).toBeVisible();
  await a.keyboard.press("Enter");

  // The LAST divider of the sequence (the room may carry re-run
  // leftovers — the freshly inserted one stands at the end, before its
  // trailing paragraph).
  const divId = await a.evaluate(() => {
    const doc = window.__paneDocs?.a ?? null;
    if (doc === null) return null;
    let hit: string | null = null;
    for (const id of doc.getChildren(doc.meta.id)) {
      if (doc.getBlock(id)?.type === "divider") hit = id;
    }
    return hit;
  });
  expect(divId).not.toBeNull();
  const dividerCountBefore = await a.locator('[data-slot="docblocks/divider"]').count();

  // The motion view's row-level gutter stands for the non-text rows: the
  // gutter click selects the block (the row takes the focus — the editor
  // root owns the selection keys). Scoped to the fresh divider's row
  // (re-run leftovers stand as their own rows).
  const row = a.locator('[data-slot="docblocks/row"]').filter({ has: a.locator(`[data-block-id="${divId}"]`) });
  await row.locator('[data-slot="docblocks/gutter"]').click();
  await expect(row).toHaveAttribute("data-selected", "true");
  // Escape clears the selection (the row stands, the divider survives).
  await a.keyboard.press("Escape");
  await expect(row).not.toHaveAttribute("data-selected");
  await expect(a.locator(`[data-block-id="${divId}"]`)).toHaveCount(1);
  await row.locator('[data-slot="docblocks/gutter"]').click();
  await a.keyboard.press("Delete");

  // The divider is gone (the count dropped by one); its trailing
  // paragraph stands as the sequence's last block.
  await expect(a.locator(`[data-block-id="${divId}"]`)).toHaveCount(0);
  expect(await a.locator('[data-slot="docblocks/divider"]').count()).toBe(dividerCountBefore - 1);
  const lastType = await a.evaluate(() => {
    const doc = window.__paneDocs?.a ?? null;
    if (doc === null) return null;
    const ids = doc.getChildren(doc.meta.id);
    const last = ids[ids.length - 1];
    return last === undefined ? null : (doc.getBlock(last)?.type ?? null);
  });
  expect(lastType).toBe("paragraph");
  await close();
});
