// The multi-block rich `text/html` paste (the v1.1 upgrade of the rich
// branch): the block structure materializes through the shared pipeline
// (the caret block split, the merge, the one transact), the table stands
// the native table block, and the code target takes the raw text with the
// line structure. Headless Chromium does not write the system clipboard
// from a keyboard copy and does not synthesize a paste event from
// Control+v, so the clipboard payload is seeded via `navigator.clipboard`
// and the paste event is dispatched with it (the paste side is the real
// pipeline).
import { type Page, expect, test } from "@playwright/test";

import { SETTLE, insertBlockType, pasteFromClipboard, twoPanes } from "./helpers";

/** The inner contenteditables of the pane's text blocks, in order. */
function inners(page: Page, client: "a" | "b") {
  return page.locator(`[data-testid="doc-${client}"] [data-slot="docblocks/block-content"]`);
}

/** Seeds the OS clipboard with the given formats (the real clipboard API). */
async function seedClipboard(page: Page, formats: Record<string, string>): Promise<void> {
  await page.evaluate(async (fmts) => {
    const blob = Object.fromEntries(
      Object.entries(fmts).map(([type, value]) => [type, new Blob([value], { type })] as [string, Blob])
    );
    await navigator.clipboard.write([new ClipboardItem(blob)]);
  }, formats);
}

/** Pastes the OS clipboard into the focused element (the real paste event). */

/** The pane's block types in the sequence, comma-joined. */
function typesOf(page: Page, client: "a" | "b") {
  return page.evaluate((c) => {
    const doc = window.__paneDocs?.[c];
    if (doc === undefined || doc === null) return "";
    return doc
      .getChildren(doc.meta.id)
      .map((id) => doc.getBlock(id)?.type ?? "?")
      .join(",");
  }, client);
}

/** The pane's root children ids (the harness exposes the live docs). */
function rootIds(page: Page, client: "a" | "b"): Promise<string[]> {
  return page.evaluate((c) => {
    const doc = window.__paneDocs?.[c];
    if (doc === undefined || doc === null) return [];
    return doc.getChildren(doc.meta.id);
  }, client);
}

/** The block's text in the pane's realm. */
function textOf(page: Page, client: "a" | "b", id: string) {
  return page.evaluate(
    ([c, id]) => {
      const doc = window.__paneDocs?.[c];
      if (doc === undefined || doc === null) return "";
      return doc.getText(id as string);
    },
    [client, id] as const
  );
}

/** The block's attrs (level / list / ...) in the pane's realm. */
function attrOf(page: Page, client: "a" | "b", id: string, attr: string) {
  return page.evaluate(
    ([c, id, attr]) => {
      const doc = window.__paneDocs?.[c];
      if (doc === undefined || doc === null) return null;
      const block = doc.getBlock(id as string);
      return block === null ? null : ((block as { attrs?: Record<string, unknown> }).attrs?.[attr as string] ?? null);
    },
    [client, id, attr] as const
  );
}

test("a multi-block rich paste materializes the blocks (the caret lands; one undo step reverts)", async ({
  browser,
}) => {
  const { a, b, close } = await twoPanes(browser, "richpaste-multi", {
    permissions: ["clipboard-read", "clipboard-write"],
  });
  const firstA = inners(a, "a").first();
  await firstA.click();
  await a.keyboard.type("before");

  // The rich payload: a heading, a paragraph with a bold run, a list, and
  // the divider.
  await seedClipboard(a, {
    "text/html": "<h2>H</h2><p>P <b>B</b></p><ul><li>L1</li><li>L2</li></ul><hr>",
    "text/plain": "H P B L1 L2",
  });
  await pasteFromClipboard(a);

  // The material: the seat keeps the "before" prefix, then the heading,
  // the paragraph (the bold run), the list items, the divider, and the
  // trailing paragraph (the caret seat).
  await expect
    .poll(async () => typesOf(a, "a"), SETTLE)
    .toBe("paragraph,heading,paragraph,list-item,list-item,divider,paragraph");

  const ids = await rootIds(a, "a");
  const [seatId, headingId, paraId, l1Id, l2Id] = ids as [string, string, string, string, string];
  // The sequence is [seat, heading, para, l1, l2, divider, trailing] (the
  // types stand above) — the trailing paragraph is the last.
  const tailId = ids[6]!;
  await expect(textOf(a, "a", seatId)).resolves.toBe("before");
  await expect(textOf(a, "a", headingId)).resolves.toBe("H");
  await expect(textOf(a, "a", paraId)).resolves.toBe("P B");
  await expect(textOf(a, "a", l1Id)).resolves.toBe("L1");
  await expect(textOf(a, "a", l2Id)).resolves.toBe("L2");
  await expect(textOf(a, "a", tailId)).resolves.toBe("");

  // The heading stands the level-2 heading (the h2 mapping); the list
  // items stand the bullet list.
  await expect.poll(async () => attrOf(a, "a", headingId, "level"), SETTLE).toBe(2);
  await expect.poll(async () => attrOf(a, "a", l1Id, "list"), SETTLE).toBe("bullet");

  // The caret lands in the trailing paragraph (the non-text landing).
  await expect
    .poll(
      async () =>
        a.evaluate((id) => {
          const inner = document.querySelector<HTMLElement>(
            `[data-testid="doc-a"] [data-block-id="${id}"] [data-slot="docblocks/block-content"]`
          );
          if (inner === null) return false;
          const sel = window.getSelection();
          return sel !== null && sel.rangeCount > 0 && inner.contains(sel.anchorNode);
        }, tailId),
      SETTLE
    )
    .toBe(true);

  // The other pane converges (the heading + the bold run over the wire).
  const boldInB = b.locator('[data-testid="doc-b"] [data-block-type="paragraph"] strong');
  await expect.poll(async () => boldInB.count(), SETTLE).toBe(1);
  await expect(boldInB.first()).toHaveText("B");

  // One undo step reverts the whole paste (the single transact).
  await a.keyboard.press("Control+z");
  await expect.poll(async () => typesOf(a, "a"), SETTLE).toBe("paragraph");
  await expect.poll(async () => textOf(a, "a", seatId), SETTLE).toBe("before");

  await close();
});

test("the rich table paste stands the native table (the cells' marks; the trailing paragraph)", async ({ browser }) => {
  const { a, b, close } = await twoPanes(browser, "richpaste-table", {
    permissions: ["clipboard-read", "clipboard-write"],
  });
  const firstA = inners(a, "a").first();
  await firstA.click();

  await seedClipboard(a, {
    "text/html": "<table><tr><td>a1 <b>ab</b></td><td>a2</td></tr><tr><td>b1</td><td>b2</td></tr></table><p>after</p>",
    "text/plain": "a1 ab a2 b1 b2 after",
  });
  await pasteFromClipboard(a);

  // The material: the empty seat (the selection empties it from offset 0 —
  // it is removed), the table, and the "after" paragraph.
  await expect.poll(async () => typesOf(a, "a"), SETTLE).toBe("table,paragraph");

  const [tableId, afterId] = (await rootIds(a, "a")) as [string, string];
  const cols = await a.evaluate((id) => {
    const doc = window.__paneDocs?.a;
    if (doc === undefined || doc === null) return null;
    const block = doc.getBlock(id);
    return block === null ? null : ((block as { columnOrder?: string[] }).columnOrder?.length ?? null);
  }, tableId);
  expect(cols).toBe(2);
  const rows = (await a.evaluate((id) => {
    const doc = window.__paneDocs?.a;
    if (doc === undefined || doc === null) return [];
    return doc.getChildren(id);
  }, tableId)) as string[];
  expect(rows).toHaveLength(2);
  // The cell's mini-doc paragraph carries the runs (the bold run stands).
  const firstCell = (await a.evaluate((id) => {
    const doc = window.__paneDocs?.a;
    if (doc === undefined || doc === null) return [];
    return doc.getChildren(id);
  }, rows[0]!)) as string[];
  const cellPara = (await a.evaluate((id) => {
    const doc = window.__paneDocs?.a;
    if (doc === undefined || doc === null) return [];
    return doc.getChildren(id);
  }, firstCell[0]!)) as string[];
  const runs = await a.evaluate((id) => {
    const doc = window.__paneDocs?.a;
    if (doc === undefined || doc === null) return [];
    return doc.getRuns(id);
  }, cellPara[0]!);
  expect(runs.map((r) => r.text).join("")).toBe("a1 ab");
  expect(runs.some((r) => r.text === "ab" && r.marks.bold === true)).toBe(true);

  // The caret lands in the "after" paragraph (the table's non-text landing).
  await expect
    .poll(
      async () =>
        a.evaluate((id) => {
          const inner = document.querySelector<HTMLElement>(
            `[data-testid="doc-a"] [data-block-id="${id}"] [data-slot="docblocks/block-content"]`
          );
          if (inner === null) return false;
          const sel = window.getSelection();
          return sel !== null && sel.rangeCount > 0 && inner.contains(sel.anchorNode);
        }, afterId),
      SETTLE
    )
    .toBe(true);

  // The other pane converges (the table over the wire).
  const tableInB = b.locator('[data-testid="doc-b"] [data-block-type="table"]');
  await expect.poll(async () => tableInB.count(), SETTLE).toBe(1);

  await close();
});

test("the code target takes the raw text with the line structure (no marks, no flattening)", async ({ browser }) => {
  const { a, b, close } = await twoPanes(browser, "richpaste-code", {
    permissions: ["clipboard-read", "clipboard-write"],
  });
  // The code block as the seat.
  const firstA = inners(a, "a").first();
  await firstA.click();
  await insertBlockType(a, "a", "code");
  const codeInners = a.locator('[data-testid="doc-a"] [data-block-type="code"] [data-slot="docblocks/block-content"]');
  await expect(codeInners).toHaveCount(1);
  await codeInners.first().click();

  await seedClipboard(a, {
    "text/html": "<pre>line1<br>line2</pre>",
    "text/plain": "line1\nline2",
  });
  await pasteFromClipboard(a);

  // The code data is the raw text with the line structure (the br is the
  // newline; the marks are dropped, no flattening to a space).
  const codeId = (await a.evaluate(() => {
    const doc = window.__paneDocs?.a;
    if (doc === undefined || doc === null) return "";
    return doc.getChildren(doc.meta.id).find((id) => doc.getBlock(id)?.type === "code") ?? "";
  })) as string;
  await expect.poll(async () => textOf(a, "a", codeId), SETTLE).toBe("line1\nline2");
  const runs = await a.evaluate((id) => {
    const doc = window.__paneDocs?.a;
    if (doc === undefined || doc === null) return [];
    return doc.getRuns(id);
  }, codeId);
  expect(runs.every((r) => Object.keys(r.marks).length === 0)).toBe(true);

  // The other pane converges.
  await expect
    .poll(
      async () =>
        b.evaluate(() => {
          const doc = window.__paneDocs?.b;
          if (doc === undefined || doc === null) return null;
          const code = doc.getChildren(doc.meta.id).find((id) => doc.getBlock(id)?.type === "code");
          return code === undefined ? null : doc.getText(code);
        }),
      SETTLE
    )
    .toBe("line1\nline2");

  await close();
});
