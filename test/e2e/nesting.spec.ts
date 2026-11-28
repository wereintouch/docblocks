// Tab / Shift+Tab over the FLAT page model: the nesting is
// the block's `indent` attr relative to its PRECEDING block, so the
// gestures are one `updateBlock({ indent })` each (one undo step, one wire
// update) — the sequence order stands (a move is never part of the
// gesture). Boundary rules: Tab on the first block is a no-op (nothing to
// nest under), a jump of more than one level over the preceding block is a
// no-op, Shift+Tab at the top level is a no-op. The code block keeps the
// typewriter Tab (a `\t` at the caret).
import { type Page, expect, test } from "@playwright/test";

import { SETTLE, expectStays, insertBlockType, outCount, twoPanes } from "./helpers";

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

/** The inner editable of a block (a descendant of the wrapper — the code block wraps it in the code body). */
function innerOf(page: Page, client: "a" | "b", id: string) {
  return pane(page, client).locator(
    `[data-slot="docblocks/block"][data-block-id="${id}"] [data-slot="docblocks/block-content"], [data-slot="docblocks/list-item"][data-block-id="${id}"] [data-slot="docblocks/block-content"]`
  );
}

/** The row's left step (the per-level indent): the computed paddingLeft of the block's flat row. */
async function rowPadding(page: Page, client: "a" | "b", id: string): Promise<string> {
  return pane(page, client)
    .locator(`[data-block-id="${id}"]` + `:not([data-slot="docblocks/row"])`)
    .first()
    .evaluate((el) => {
      const row = el.parentElement;
      if (row === null) throw new Error("the wrapper has no row");
      return getComputedStyle(row).paddingLeft;
    });
}

test("Tab indents the second paragraph (an indent attr update); one mod+z reverts it", async ({ browser }) => {
  const { a, b, close } = await twoPanes(browser, "tab-indent");

  // The room starts with pane "a"'s single starter; the second paragraph
  // is inserted explicitly (the harness insert).
  await expect.poll(async () => rootIds(a, "a"), SETTLE).toHaveLength(1);
  const firstId = (await rootIds(a, "a"))[0]!;
  const secondId = await insertBlockType(a, "a", "paragraph");
  await expect.poll(async () => rootIds(a, "a"), SETTLE).toHaveLength(2);

  const outBefore = await outCount(a, "a");
  await innerOf(a, "a", secondId).click();
  await a.keyboard.press("Tab");

  // The flat model: the indent attr is set (one updateBlock in one
  // transact — one wire update), the sequence order stands, and no
  // children field is written anywhere.
  await expect.poll(async () => outCount(a, "a"), SETTLE).toBe(outBefore + 1);
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
  const { a, b, close } = await twoPanes(browser, "tab-boundary-rules");

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
  const outBefore = await outCount(a, "a");

  // Tab on the first block: no preceding block, nothing to nest under.
  const firstId = (await rootIds(a, "a"))[0]!;
  await innerOf(a, "a", firstId).click();
  await a.keyboard.press("Tab");
  await expectStays(async () => {
    expect(await outCount(a, "a")).toBe(outBefore);
  });
  expect(await indentOf(a, "a", firstId)).toBeUndefined();

  // Tab on Z: the jump would exceed the preceding block's indent by more
  // than one (the markdown jump rule) — a no-op.
  await innerOf(a, "a", seeded.z).click();
  await a.keyboard.press("Tab");
  await expectStays(async () => {
    expect(await outCount(a, "a")).toBe(outBefore);
  });
  expect(await indentOf(a, "a", seeded.z)).toBe(1);
  // The doc stands: the other pane is unchanged too.
  expect(await rootIds(b, "b")).toEqual(await rootIds(a, "a"));
  await expect.poll(async () => indentOf(b, "b", seeded.z), SETTLE).toBe(1);

  await close();
});

test("Shift+Tab at the top level is a no-op", async ({ browser }) => {
  const { a, close } = await twoPanes(browser, "shift-tab-top-level");

  await expect.poll(async () => rootIds(a, "a"), SETTLE).toHaveLength(1);
  const firstId = (await rootIds(a, "a"))[0]!;
  const outBefore = await outCount(a, "a");

  await innerOf(a, "a", firstId).click();
  await a.keyboard.press("Shift+Tab");

  // The top level has no outdent target: no attr, no wire update (the
  // window's stand — the late commit's false green's guard).
  await expectStays(async () => {
    expect(await outCount(a, "a")).toBe(outBefore);
  });
  expect(await indentOf(a, "a", firstId)).toBeUndefined();
  await expect.poll(async () => rootIds(a, "a"), SETTLE).toEqual([firstId]);

  await close();
});

test("Tab in a code block inserts a tab character (no indent change)", async ({ browser }) => {
  const { a, b, close } = await twoPanes(browser, "code-block-tab");

  await expect.poll(async () => rootIds(a, "a"), SETTLE).toHaveLength(1);
  await insertBlockType(a, "a", "code");
  const after = await rootIds(a, "a");
  expect(after).toHaveLength(2);
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
