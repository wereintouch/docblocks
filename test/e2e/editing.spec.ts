import { type Page, expect, test } from "@playwright/test";

import { SETTLE, twoPanes } from "./helpers";

async function docText(page: Page, client: "a" | "b"): Promise<string> {
  return page.getByTestId(`doc-${client}`).innerText();
}

async function expectDocContains(page: Page, client: "a" | "b", text: string): Promise<void> {
  await expect.poll(async () => (await docText(page, client)).includes(text), SETTLE).toBe(true);
}

/** The first editable paragraph of the pane's real editor. */
function paragraph(page: Page, client: "a" | "b") {
  return page.locator(`[data-testid="doc-${client}"] [data-block-type="paragraph"]`).first();
}

/** The DOM caret offset in the pane (null when there is no caret in a text node). */
function caretOffset(page: Page): Promise<number | null> {
  return page.evaluate(() => {
    const selection = window.getSelection();
    if (selection === null || selection.rangeCount === 0) return null;
    const node = selection.anchorNode;
    return node !== null && node.nodeType === Node.TEXT_NODE ? selection.anchorOffset : null;
  });
}

test("typing into the editable block syncs both directions", async ({ browser }) => {
  const { a, b, close } = await twoPanes(browser, "ui02a-text");

  await paragraph(a, "a").click();
  await a.keyboard.type("hello");
  await expectDocContains(b, "b", "hello");
  await expect(paragraph(a, "a")).toHaveText("hello");

  await paragraph(b, "b").click();
  await b.keyboard.press("End");
  await b.keyboard.type("world");
  await expectDocContains(a, "a", "helloworld");
  await expect(paragraph(a, "a")).toHaveText("helloworld");

  await close();
});

test("undo and redo of a local edit reach the other pane", async ({ browser }) => {
  const { a, b, close } = await twoPanes(browser, "ui02a-undo");

  await paragraph(a, "a").click();
  await a.keyboard.type("ab");
  await expectDocContains(b, "b", "ab");

  // Control (not Meta) for a platform-stable hotkey: A's undo is a local
  // transaction that travels the wire like any other update.
  await a.keyboard.press("Control+z");
  await expect(paragraph(a, "a")).toHaveText("a");
  await expect(paragraph(b, "b")).toHaveText("a");

  await a.keyboard.press("Control+Shift+z");
  await expect(paragraph(a, "a")).toHaveText("ab");
  await expect(paragraph(b, "b")).toHaveText("ab");

  await close();
});

test("a remote edit rebases the local caret (core point rule)", async ({ browser }) => {
  const { a, b, close } = await twoPanes(browser, "ui02a-caret");

  await paragraph(a, "a").click();
  await a.keyboard.type("hello");
  await expectDocContains(b, "b", "hello");
  // A's caret sits at the end of "hello" (offset 5).
  await expect.poll(async () => caretOffset(a), SETTLE).toBe(5);

  // A remote insertion exactly at A's caret does not move it.
  await paragraph(b, "b").click();
  await b.keyboard.press("End");
  await b.keyboard.type("!!");
  await expectDocContains(a, "a", "hello!!");
  await expect.poll(async () => caretOffset(a), SETTLE).toBe(5);

  // An insertion before the caret shifts it.
  await b.keyboard.press("Home");
  await b.keyboard.type("!");
  await expectDocContains(a, "a", "!hello!!");
  await expect.poll(async () => caretOffset(a), SETTLE).toBe(6);

  // A remote deletion before the caret shrinks it; a deletion covering it
  // keeps it at the deletion start.
  await b.keyboard.press("Home");
  await b.keyboard.press("Delete");
  await expectDocContains(a, "a", "hello!!");
  await expect.poll(async () => caretOffset(a), SETTLE).toBe(5);

  await close();
});

test("undo of a range delete restores the caret to the deletion start", async ({ browser }) => {
  const { a, b, close } = await twoPanes(browser, "ui02a-undo-caret");

  await paragraph(a, "a").click();
  await a.keyboard.type("abc");
  await expectDocContains(b, "b", "abc");

  // Select "bc" (backward) and delete: the text collapses to "a", caret 1.
  await a.keyboard.press("Shift+ArrowLeft");
  await a.keyboard.press("Shift+ArrowLeft");
  await a.keyboard.press("Backspace");
  await expect(paragraph(a, "a")).toHaveText("a");
  await expect(paragraph(b, "b")).toHaveText("a");
  await expect.poll(async () => caretOffset(a), SETTLE).toBe(1);

  // Undo restores the text; the caret stays at the deletion start (the
  // undo inserts exactly at the caret position, which does not move it).
  await a.keyboard.press("Control+z");
  await expect(paragraph(a, "a")).toHaveText("abc");
  await expect(paragraph(b, "b")).toHaveText("abc");
  await expect.poll(async () => caretOffset(a), SETTLE).toBe(1);

  await close();
});

test("mod+z outside the editor does not undo the document", async ({ browser }) => {
  const { a, b, close } = await twoPanes(browser, "ui02a-hotkey-scope");

  await paragraph(a, "a").click();
  await a.keyboard.type("ab");
  await expectDocContains(b, "b", "ab");

  // Control+z typed on a non-editable pane element (focus lands on the
  // document body, outside the editor root's keyboard scope) must not undo.
  await a.getByTestId("status-a").click();
  await a.keyboard.press("Control+z");
  await a.waitForTimeout(500);
  await expect(paragraph(a, "a")).toHaveText("ab");
  await expect(paragraph(b, "b")).toHaveText("ab");

  await close();
});

/** The DOM caret offset inside the given block's inner (negative = no seat). */
function caretInBlock(page: Page, id: string, client: "a" | "b"): Promise<number> {
  return page.evaluate(
    ({ id, client }) => {
      const inner = document.querySelector<HTMLElement>(
        `[data-testid="doc-${client}"] [data-block-id="${id}"][data-slot="docblocks/block-content"]`
      );
      const selection = window.getSelection();
      if (inner === null || selection === null || selection.rangeCount === 0) return -1;
      if (selection.anchorNode === null || !inner.contains(selection.anchorNode)) return -2;
      return selection.anchorOffset;
    },
    { id, client }
  );
}

test("undo of a type change re-seats the caret in the remounted block", async ({ browser }) => {
  const { a, close } = await twoPanes(browser, "ui02a-undo-reseat");
  const para = paragraph(a, "a");
  await para.click();
  await a.keyboard.type("hello");
  // The selectionchange mapping (the view's caret snapshot) settles
  // after the last keystroke's event — the type change's snapshot reads
  // the view at commit time.
  await a.waitForTimeout(100);

  const id: string | null = await a.evaluate(() => {
    const doc = window.__paneDocs?.a;
    if (doc === undefined || doc === null) return null;
    return doc.getChildren(doc.meta.id)[0] ?? null;
  });
  expect(id).not.toBeNull();

  // The type change remounts the block (the div -> li swap): the forward
  // remount is driven by the doc command directly (the undo's inverse
  // remount is what the re-seat pins).
  await a.evaluate((blockId) => {
    const doc = window.__paneDocs?.a;
    if (doc === undefined || doc === null) throw new Error("no pane doc");
    doc.changeBlockType(blockId, "list-item", { list: "bullet" });
  }, id!);
  await expect
    .poll(
      async () => a.locator(`[data-testid="doc-a"] [data-block-type="list-item"][data-block-id="${id}"]`).count(),
      SETTLE
    )
    .toBe(1);

  // The remount drops the focus to the document: park it on the editor
  // root (the hotkey's reach) and undo.
  await a.locator('[data-testid="doc-a"] [data-slot="docblocks/editor"]').first().focus();
  await a.keyboard.press("Control+z");

  // The undo restored the paragraph and the caret stands in the remounted
  // inner at the pre-gesture seat (the end of "hello"), not stranded on
  // the document.
  await expect
    .poll(
      async () => a.locator(`[data-testid="doc-a"] [data-block-type="paragraph"][data-block-id="${id}"]`).count(),
      SETTLE
    )
    .toBe(1);
  await expect.poll(async () => caretInBlock(a, id!, "a"), SETTLE).toBe(5);

  // The redo takes the type change (and the remount) again: the same
  // re-seat stands over it.
  await a.keyboard.press("Control+Shift+z");
  await expect
    .poll(
      async () => a.locator(`[data-testid="doc-a"] [data-block-type="list-item"][data-block-id="${id}"]`).count(),
      SETTLE
    )
    .toBe(1);
  await expect.poll(async () => caretInBlock(a, id!, "a"), SETTLE).toBe(5);

  await close();
});
