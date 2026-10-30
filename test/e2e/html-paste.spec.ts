import { type Browser, type Page, expect, test } from "@playwright/test";

import { RELAY, SETTLE, pasteFromClipboard } from "./helpers";

/**
 * The inline html tags in the `text/plain` paste (the unified pass with the
 * markdown delimiters): the real-clipboard pipeline over the relay. The
 * pins: the inline tags landing as the v1 marks (both panes over the wire),
 * the `<br>` soft break, the structural tag line staying literal, the md
 * table cells parsing the tags, and the code target taking the tags raw.
 *
 * Idempotency: a unique room per test (the relay keeps rooms for the dev
 * server's lifetime) and the assertions scoped to the seeded ids.
 */

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

/** The runs of the given block (the text + the mark names per run). */
function runsOf(page: Page, client: "a" | "b", blockId: string) {
  return page.evaluate(
    ({ client, blockId }: { client: "a" | "b"; blockId: string }) => {
      const doc = window.__paneDocs?.[client];
      if (doc === undefined || doc === null) return null;
      return (doc.getRuns(blockId) ?? []).map((run) => ({
        text: run.text,
        marks: Object.fromEntries(
          Object.entries(run.marks).map(([key, value]) => [
            key,
            value === true ? true : Object.keys(value as object).sort(),
          ])
        ),
      }));
    },
    { client, blockId }
  );
}

/** Seed the clipboard with the plain text only (no html payload). */
async function writePlainClipboard(page: Page, text: string): Promise<void> {
  await page.evaluate(async (text) => {
    await navigator.clipboard.write([new ClipboardItem({ "text/plain": new Blob([text], { type: "text/plain" }) })]);
  }, text);
}

/** Paste the OS clipboard into the focused element (headless Chromium does not synthesize the paste event). */

/** The first contenteditable of the pane (the starter paragraph's inner). */
function firstInner(page: Page, client: "a" | "b") {
  return page.locator(`[data-testid="doc-${client}"] [data-slot="docblocks/block-content"]`).first();
}

test("the inline tags land as the v1 marks (both panes over the wire)", async ({ browser }) => {
  const { a, b, close } = await openPanes(browser, "htmlp-marks");
  try {
    await firstInner(a, "a").click();
    await writePlainClipboard(a, "Привет <b>мир</b> и <i>курсив</i>!");
    await pasteFromClipboard(a);

    await expect
      .poll(async () => rootBlocks(a, "a"), SETTLE)
      .toEqual([{ id: expect.any(String), type: "paragraph", text: "Привет мир и курсив!" }]);
    const id = (await rootBlocks(a, "a"))![0]!.id;
    expect(await runsOf(a, "a", id)).toEqual([
      { text: "Привет ", marks: {} },
      { text: "мир", marks: { bold: true } },
      { text: " и ", marks: {} },
      { text: "курсив", marks: { italic: true } },
      { text: "!", marks: {} },
    ]);

    // the bold mark renders (the computed weight of the span)
    const weight = await a
      .locator('[data-testid="doc-a"]')
      .getByText("мир")
      .first()
      .evaluate((el) => getComputedStyle(el).fontWeight);
    expect(weight).not.toBe("400");

    // the other pane sees the same runs over the wire
    await expect.poll(async () => (await runsOf(b, "b", id)) ?? [], SETTLE).toEqual(await runsOf(a, "a", id));
  } finally {
    await close();
  }
});

test("the <br> tag is the soft line break (one block, the \\n in the run)", async ({ browser }) => {
  const { a, close } = await openPanes(browser, "htmlp-br");
  try {
    await firstInner(a, "a").click();
    await writePlainClipboard(a, "строка1<br>строка2 <b>жирная</b>");
    await pasteFromClipboard(a);

    await expect
      .poll(async () => rootBlocks(a, "a"), SETTLE)
      .toEqual([{ id: expect.any(String), type: "paragraph", text: "строка1\nстрока2 жирная" }]);
    const id = (await rootBlocks(a, "a"))![0]!.id;
    expect(await runsOf(a, "a", id)).toEqual([
      { text: "строка1\nстрока2 ", marks: {} },
      { text: "жирная", marks: { bold: true } },
    ]);
  } finally {
    await close();
  }
});

test("the structural tag line stays literal (no heading, no structure)", async ({ browser }) => {
  const { a, close } = await openPanes(browser, "htmlp-struct");
  try {
    await firstInner(a, "a").click();
    await writePlainClipboard(a, "<h1>Заголовок 1</h1> текст <ul><li>пункт</li></ul>");
    await pasteFromClipboard(a);

    await expect
      .poll(async () => rootBlocks(a, "a"), SETTLE)
      .toEqual([
        { id: expect.any(String), type: "paragraph", text: "<h1>Заголовок 1</h1> текст <ul><li>пункт</li></ul>" },
      ]);
  } finally {
    await close();
  }
});

test("the md table cells parse the inline tags (the marks in the cells)", async ({ browser }) => {
  const { a, close } = await openPanes(browser, "htmlp-table");
  try {
    await firstInner(a, "a").click();
    await writePlainClipboard(a, "| a | b |\n| --- | --- |\n| <b>жирная</b> | <code>код</code> |");
    await pasteFromClipboard(a);

    // the paste lands the table; the trailing empty paragraph stands as the caret seat
    await expect
      .poll(async () => rootBlocks(a, "a"), SETTLE)
      .toEqual([
        { id: expect.any(String), type: "table", text: "" },
        { id: expect.any(String), type: "paragraph", text: "" },
      ]);
    const tableId = (await rootBlocks(a, "a"))![0]!.id;
    const cells = await a.evaluate(
      ({ client, tableId }) => {
        const doc = window.__paneDocs?.[client];
        if (doc === undefined || doc === null) return null;
        const rows = doc.getChildren(tableId);
        const row = rows[1];
        if (row === undefined) return null;
        const cellIds = doc.getChildren(row);
        return cellIds.map((cellId) => {
          const children = doc.getChildren(cellId);
          const para = children[0];
          return para === undefined
            ? []
            : (doc.getRuns(para) ?? []).map((run) => ({
                text: run.text,
                bold: run.marks.bold ?? false,
                code: run.marks.code ?? false,
              }));
        });
      },
      { client: "a" as const, tableId }
    );
    expect(cells).toEqual([[{ text: "жирная", bold: true, code: false }], [{ text: "код", bold: false, code: true }]]);
  } finally {
    await close();
  }
});

test("the code target takes the tags raw (no parsing, the text verbatim)", async ({ browser }) => {
  const { a, close } = await openPanes(browser, "htmlp-code");
  try {
    const codeId = await a.evaluate(
      ({ client }) => {
        const doc = window.__paneDocs?.[client];
        if (doc === undefined || doc === null) throw new Error("the pane doc should exist");
        return doc.insertBlock("code", { language: "html" });
      },
      { client: "a" as const }
    );
    await expect.poll(async () => (await rootBlocks(a, "a"))?.length, SETTLE).toBe(2); // the starter + the code

    const inner = a
      .locator(`[data-testid="doc-a"] [data-slot="docblocks/block"][data-block-id="${codeId}"]`)
      .locator('[data-slot="docblocks/block-content"]');
    await inner.click();
    const raw = "<b>не жирный</b>\n<p>не абзац</p>";
    await writePlainClipboard(a, raw);
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
      .toBe(raw);
  } finally {
    await close();
  }
});
