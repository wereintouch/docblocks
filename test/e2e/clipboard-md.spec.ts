/**
 * The multi-block markdown paste (the `text/plain` branch, always-parsed):
 * the real-clipboard pipeline over the relay. The pins: the document
 * decomposition into the native blocks (both panes over the wire), the
 * one-undo-step contract, the caret landing at the end of the pasted
 * content, the caret-block split (the prefix stands, the block's own tail
 * lands in the last pasted paragraph), and the nested-list seat's paste
 * (the tail lands after the seat's segment — the displaced follower is
 * not dangled).
 *
 * Idempotency: a unique room per test (the relay keeps rooms for the dev
 * server's lifetime) and the assertions scoped to the seeded ids.
 */
import { type Browser, type Page, expect, test } from "@playwright/test";

import {
  RELAY,
  SETTLE,
  caretIn,
  editorContext,
  grantClipboardPermissions,
  pasteFromClipboard,
  seedClipboardPayload,
} from "./helpers";

/** The paste markdown (the mapping subset under test: the heading, the bold, the lists, the task, the quote). */
const PASTE_MD = ["## Title", "", "text **bold** tail", "", "- one", "- [x] done", "", "> quoted"].join("\n");

async function openPanes(browser: Browser, seed: string): Promise<{ a: Page; b: Page; close: () => Promise<void> }> {
  const room = `${seed}-${Math.random().toString(36).slice(2, 8)}`;
  const contextA = await editorContext(browser);
  const contextB = await editorContext(browser);
  await grantClipboardPermissions(contextA);
  await grantClipboardPermissions(contextB);
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

/** The pane's root children as (type, text) pairs. */
function rootBlocks(page: Page, client: "a" | "b") {
  return page.evaluate(
    ({ client }: { client: "a" | "b" }) => {
      const doc = window.__paneDocs?.[client];
      if (doc === undefined || doc === null) return null;
      const root = doc.meta.id;
      return doc.getChildren(root).map((id) => {
        const block = doc.getBlock(id);
        const text = block !== null && "content" in block ? (block.content ?? []).map((r) => r.text).join("") : "";
        return { id, type: block?.type ?? null, text };
      });
    },
    { client }
  );
}

/** Seed the page's paste payload with the plain text only (no html: the markdown branch is the one under test). */
async function writePlainClipboard(page: Page, text: string): Promise<void> {
  await seedClipboardPayload(page, { plain: text });
}

/** Paste the OS clipboard into the focused element (headless Chromium does not synthesize the paste event). */

/** The first contenteditable of the pane (the starter paragraph's inner). */
function firstInner(page: Page, client: "a" | "b") {
  return page.locator(`[data-testid="doc-${client}"] [data-slot="docblocks/block-content"]`).first();
}

test("the markdown document pastes as the native blocks (both panes over the wire)", async ({ browser }) => {
  const { a, b, close } = await openPanes(browser, "clip-md-doc");
  try {
    await firstInner(a, "a").click();
    await writePlainClipboard(a, PASTE_MD);
    await pasteFromClipboard(a);

    await expect
      .poll(async () => rootBlocks(a, "a"), SETTLE)
      .toEqual([
        { id: expect.any(String), type: "heading", text: "Title" },
        { id: expect.any(String), type: "paragraph", text: "text bold tail" },
        { id: expect.any(String), type: "list-item", text: "one" },
        { id: expect.any(String), type: "list-item", text: "done" },
        { id: expect.any(String), type: "quote", text: "quoted" },
      ]);

    // the attrs and the marks ride the runs
    const attrs = await a.evaluate(
      ({ client }) => {
        const doc = window.__paneDocs?.[client];
        const ids = doc?.getChildren(doc.meta.id) ?? [];
        const of = (id: string, key: string) =>
          (doc?.getBlock(id)?.attrs as Record<string, unknown> | undefined)?.[key];
        return {
          level: of(ids[0] ?? "", "level"),
          list: of(ids[2] ?? "", "list"),
          checked: of(ids[3] ?? "", "checked"),
          boldRun: (doc?.getRuns(ids[1] ?? "") ?? []).find((r) => r.text === "bold")?.marks.bold ?? null,
        };
      },
      { client: "a" as const }
    );
    expect(attrs).toEqual({ level: 2, list: "bullet", checked: true, boldRun: true });

    // the other pane sees the same decomposition over the wire
    await expect
      .poll(async () => (await rootBlocks(b, "b"))?.map((blk) => blk.type), SETTLE)
      .toEqual(["heading", "paragraph", "list-item", "list-item", "quote"]);
  } finally {
    await close();
  }
});

test("the whole multi-block paste is one undo step", async ({ browser }) => {
  const { a, close } = await openPanes(browser, "clip-md-undo");
  try {
    // The starter has settled (the non-polled `before` capture must not race
    // the pane's starter seeding).
    await expect.poll(async () => (await rootBlocks(a, "a"))?.length, SETTLE).toBe(1);
    const before = await rootBlocks(a, "a");
    await firstInner(a, "a").click();
    await writePlainClipboard(a, PASTE_MD);
    await pasteFromClipboard(a);
    await expect.poll(async () => (await rootBlocks(a, "a"))?.length, SETTLE).toBe(5);

    await a.keyboard.press("Control+z");
    await expect
      .poll(async () => (await rootBlocks(a, "a"))?.map((blk) => blk.type), SETTLE)
      .toEqual(before?.map((blk) => blk.type) ?? []);
  } finally {
    await close();
  }
});

test("the caret lands at the end of the pasted content", async ({ browser }) => {
  const { a, close } = await openPanes(browser, "clip-md-caret");
  try {
    await firstInner(a, "a").click();
    await writePlainClipboard(a, PASTE_MD);
    await pasteFromClipboard(a);
    await expect.poll(async () => (await rootBlocks(a, "a"))?.length, SETTLE).toBe(5);

    // the caret stands in the last pasted block's inner (the quote — the
    // shared page container is the focused element, the caret's seat is
    // the live selection's)
    await expect
      .poll(async () => {
        const last = await a.evaluate(() => {
          const doc = window.__paneDocs?.a;
          if (doc === undefined || doc === null) return null;
          const root = doc.getChildren(doc.meta.id);
          return root.length === 0 ? null : (root[root.length - 1] ?? null);
        });
        if (last === null) return false;
        return caretIn(a, `[data-block-id="${last}"][data-slot="docblocks/block-content"]`);
      }, SETTLE)
      .toBe(true);

    // typing lands in the last block
    await a.keyboard.type("X");
    await expect
      .poll(async () => (await rootBlocks(a, "a"))?.[4], SETTLE)
      .toMatchObject({ type: "quote", text: "quotedX" });
  } finally {
    await close();
  }
});

test("the paste splits the caret block (the prefix stands, the tail lands in the last paragraph)", async ({
  browser,
}) => {
  const { a, close } = await openPanes(browser, "clip-md-split");
  try {
    const inner = firstInner(a, "a");
    await inner.click();
    await a.keyboard.type("Привет мир");
    await a.keyboard.press("End");
    for (let i = 0; i < 3; i += 1) await a.keyboard.press("ArrowLeft"); // the caret before "мир"

    await writePlainClipboard(a, "# H\ntext");
    await pasteFromClipboard(a);

    await expect
      .poll(async () => (await rootBlocks(a, "a"))?.map((blk) => [blk.type, blk.text]), SETTLE)
      .toEqual([
        ["paragraph", "Привет "],
        ["heading", "H"],
        ["paragraph", "textмир"],
      ]);
  } finally {
    await close();
  }
});

test("a paste into a nested-list seat lands the shallower tail after the seat's segment (the displaced follower is not dangled)", async ({
  browser,
}) => {
  const { a, b, close } = await openPanes(browser, "clip-md-toside");
  try {
    // The seat: a nested list item with a deeper follower (its derived
    // segment). The paste's tail (a top-level paragraph) must not dangle
    // the follower — it lands after the segment.
    const seatId = await a.evaluate(() => {
      const doc = window.__paneDocs?.a;
      if (doc === null || doc === undefined) throw new Error("the pane's doc is not mounted");
      const top = doc.insertBlock("list-item", { list: "bullet" });
      doc.insertText(top, 0, "top");
      const seat = doc.insertBlock("list-item", { list: "bullet", indent: 1 }, { parent: doc.meta.id, after: top });
      doc.insertBlock("list-item", { list: "bullet", indent: 2 }, { parent: doc.meta.id, after: seat });
      return seat;
    });
    const inner = a.locator(`div[data-block-id="${seatId}"][data-slot="docblocks/block-content"]`);
    await inner.waitFor({ state: "visible", timeout: SETTLE.timeout });
    await inner.click();
    await writePlainClipboard(a, "  - x\ny");
    await pasteFromClipboard(a);

    // The pane stands a starter paragraph ahead of the seeded list — the
    // paste's shape is the tail of the sequence.
    const shape = (blocks: { id: string; type: string | null; text: string }[] | null) =>
      blocks === null ? null : blocks.map((blk) => `${blk.type}:${blk.text}`).slice(1);
    await expect
      .poll(async () => shape(await rootBlocks(a, "a")), SETTLE)
      .toEqual(["list-item:top", "list-item:x", "list-item:", "paragraph:y"]);
    // The doc stands the jump rule (no dangled follower) and the other
    // pane converges over the wire.
    await expect
      .poll(async () => shape(await rootBlocks(b, "b")), SETTLE)
      .toEqual(["list-item:top", "list-item:x", "list-item:", "paragraph:y"]);
  } finally {
    await close();
  }
});
