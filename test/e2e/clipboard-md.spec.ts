/**
 * The multi-block markdown paste (the `text/plain` branch, always-parsed):
 * the real-clipboard pipeline over the relay. The pins: the document
 * decomposition into the native blocks (both panes over the wire), the
 * one-undo-step contract, the code target (the raw fence text — no
 * parsing), the caret landing at the end of the pasted content, and the
 * caret-block split (the prefix stands, the block's own tail lands in the
 * last pasted paragraph).
 *
 * Idempotency: a unique room per test (the relay keeps rooms for the dev
 * server's lifetime) and the assertions scoped to the seeded ids.
 */
import { type Browser, type Page, expect, test } from "@playwright/test";

const RELAY = "ws://localhost:5199";
const SETTLE = { timeout: 15_000 };

/** The paste markdown (the mapping subset under test: the heading, the bold, the lists, the task, the quote). */
const PASTE_MD = ["## Title", "", "text **bold** tail", "", "- one", "- [x] done", "", "> quoted"].join("\n");

async function openPanes(browser: Browser, seed: string): Promise<{ a: Page; b: Page; close: () => Promise<void> }> {
  const room = `${seed}-${Math.random().toString(36).slice(2, 8)}`;
  const contextA = await browser.newContext();
  const contextB = await browser.newContext();
  await contextA.grantPermissions(["clipboard-read", "clipboard-write"]);
  await contextB.grantPermissions(["clipboard-read", "clipboard-write"]);
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

/** Seed the clipboard with the plain text only (no html: the markdown branch is the one under test). */
async function writePlainClipboard(page: Page, text: string): Promise<void> {
  await page.evaluate(async (text) => {
    await navigator.clipboard.write([new ClipboardItem({ "text/plain": new Blob([text], { type: "text/plain" }) })]);
  }, text);
}

/** Seed the clipboard with BOTH payloads (the code copied from an editor: the html + the plain). */
async function writeCodeClipboard(page: Page, plain: string, html: string): Promise<void> {
  await page.evaluate(
    async (arg) => {
      await navigator.clipboard.write([
        new ClipboardItem({
          "text/html": new Blob([arg.html], { type: "text/html" }),
          "text/plain": new Blob([arg.plain], { type: "text/plain" }),
        }),
      ]);
    },
    { plain, html }
  );
}

/** Paste the OS clipboard into the focused element (headless Chromium does not synthesize the paste event). */
async function pasteFromClipboard(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const items = await navigator.clipboard.read();
    const item = items.find((i) => i.types.includes("text/plain"));
    const text = item === undefined ? "" : ((await item.getType("text/plain").then((blob) => blob.text())) ?? "");
    const target = document.activeElement;
    if (!(target instanceof HTMLElement)) throw new Error("the paste target should be focused");
    const transfer = new DataTransfer();
    transfer.setData("text/plain", text);
    const event = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "clipboardData", { value: transfer });
    target.dispatchEvent(event);
  });
}

/** The first contenteditable of the pane (the starter paragraph's inner). */
function firstInner(page: Page, client: "a" | "b") {
  return page.locator(`[data-testid="doc-${client}"] [data-slot="docblocks/block-content"]`).first();
}

/** The inner contenteditable of the given block (the pane-scoped query). */
function innerOf(page: Page, client: "a" | "b", blockId: string) {
  return page
    .locator(`[data-testid="doc-${client}"] [data-slot="docblocks/block"][data-block-id="${blockId}"]`)
    .locator('[data-slot="docblocks/block-content"]');
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

test("the code target takes the markdown as raw text (no parsing, no new blocks)", async ({ browser }) => {
  const { a, b, close } = await openPanes(browser, "clip-md-code");
  try {
    const codeId = await a.evaluate(
      ({ client }) => {
        const doc = window.__paneDocs?.[client];
        if (doc === undefined || doc === null) throw new Error("the pane doc should exist");
        return doc.insertBlock("code", { language: "md" });
      },
      { client: "a" as const }
    );
    await expect.poll(async () => (await rootBlocks(a, "a"))?.length, SETTLE).toBe(2); // the starter paragraph + the code block

    await innerOf(a, "a", codeId).click();
    // both payloads (a copy from an editor): the plain stands verbatim
    // (the indentation and the lines — the html pipeline's flattening
    // never runs on the code target)
    const code = "def main():\n\treturn [1, 2]\n\n\tif True:\n\t\tx = 1\n";
    await writeCodeClipboard(a, code, "<pre>def main():\n\treturn [1, 2]</pre>");
    await pasteFromClipboard(a);

    await expect
      .poll(
        async () =>
          a.evaluate(({ client, id }) => window.__paneDocs?.[client]?.getText(id) ?? "", {
            client: "a" as const,
            id: codeId,
          }),
        SETTLE
      )
      .toBe(code);
    // the block count stands (the fence never parsed into blocks)
    expect((await rootBlocks(a, "a"))?.length).toBe(2);
    // the other pane sees the same raw text over the wire
    await expect
      .poll(
        async () =>
          b.evaluate(({ client, id }) => window.__paneDocs?.[client]?.getText(id) ?? "", {
            client: "b" as const,
            id: codeId,
          }),
        SETTLE
      )
      .toBe(code);
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

    // the active element is the last pasted block's inner (the quote)
    await expect
      .poll(
        async () =>
          a.evaluate(
            ({ client }) => {
              const doc = window.__paneDocs?.[client];
              const root = doc?.getChildren(doc?.meta.id ?? "");
              const last = root?.[root.length - 1];
              const el = document.activeElement;
              return last !== null && el?.getAttribute("data-block-id") === last;
            },
            { client: "a" as const }
          ),
        SETTLE
      )
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
