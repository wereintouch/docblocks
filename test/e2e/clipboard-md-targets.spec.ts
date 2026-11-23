// The markdown paste's structured targets over the relay: the code
// target takes the markdown as raw text (no parsing, no new blocks —
// the both-payloads' html pipeline's flattening never runs on the code
// target) and the markdown table lands as a native table (the editable
// cell's paragraphs, both panes over the wire).
import { type Browser, type Page, expect, test } from "@playwright/test";

import {
  RELAY,
  SETTLE,
  editorContext,
  grantClipboardPermissions,
  pasteFromClipboard,
  seedClipboardPayload,
} from "./helpers";

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

/** Seed the page's paste payload with BOTH payloads (the code copied from an editor: the html + the plain). */
async function writeCodeClipboard(page: Page, plain: string, html: string): Promise<void> {
  await seedClipboardPayload(page, { plain, html });
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

test("the markdown table paste lands as a native table with editable cell paragraphs", async ({ browser }) => {
  const { a, b, close } = await openPanes(browser, "clip-md-table");
  try {
    await firstInner(a, "a").click();
    await writePlainClipboard(a, "| h1 | h2 |\n| --- | --- |\n| x | y |");
    await pasteFromClipboard(a);

    // The native table stands in A: two rows, the cell texts in the cells.
    const tableA = a.locator('[data-testid="doc-a"] table[data-block-type="table"]');
    await expect.poll(async () => tableA.count(), SETTLE).toBe(1);
    expect(await tableA.locator("tr").count()).toBe(2);
    expect(await tableA.locator("td").count()).toBe(4);
    await expect(tableA.locator("td").first()).toHaveText("h1");
    // The cell texts stand in child paragraphs — the cells are editable
    // (the inner editables stand), and the doc JSON carries the child
    // paragraph shape (the cell's own content stays empty).
    const cellShape = await a.evaluate(() => {
      const doc = window.__paneDocs?.a ?? null;
      if (doc === null) return null;
      const ids = doc.getChildren(doc.meta.id);
      const tableId = ids.find((id) => doc.getBlock(id)?.type === "table");
      if (tableId === undefined) return null;
      const rowIds = doc.getChildren(tableId);
      const cellIds = doc.getChildren(rowIds[0]!);
      const cell = doc.getBlock(cellIds[0]!)!;
      const paraId = doc.getChildren(cellIds[0]!)[0];
      return {
        cellType: cell.type,
        cellOwnText: ("content" in cell ? (cell as { content: { text: string }[] }).content : [])
          .map((r) => r.text)
          .join(""),
        paraText: paraId === undefined ? null : (doc.getText(paraId) ?? null),
        paraCount: cellIds.map((cid) => doc.getChildren(cid).length),
      };
    });
    expect(cellShape).toEqual({ cellType: "table-cell", cellOwnText: "", paraText: "h1", paraCount: [1, 1] });

    // B stands the same rendered table over the wire.
    const tableB = b.locator('[data-testid="doc-b"] table[data-block-type="table"]');
    await expect.poll(async () => tableB.locator("td").count(), SETTLE).toBe(4);
    await expect(tableB.locator("td").first()).toHaveText("h1");
  } finally {
    await close();
  }
});
