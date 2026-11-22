// Backspace at the start of a non-empty quote never merges into the previous
// block (the characters, line breaks included, delete in place until the
// quote is empty, then it resets to a paragraph).
import { type Browser, type Page, expect, test } from "@playwright/test";

import { RELAY, SETTLE, editorContext, rowsSettled } from "./helpers";

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

/** The pane's root entry-list ids (plain values across the evaluate bridge). */
async function rootIds(page: Page, client: "a" | "b"): Promise<string[]> {
  return page.evaluate((c) => {
    const d = window.__paneDocs?.[c];
    if (d === null || d === undefined) throw new Error(`the ${c} pane's doc is not mounted`);
    return d.getChildren(d.toJSON().id);
  }, client);
}

/** A block's plain snapshot (the doc object itself never crosses the bridge). */
async function blockOf(
  page: Page,
  client: "a" | "b",
  id: string
): Promise<{ type: string; attrs?: Record<string, unknown> } | null> {
  return page.evaluate(
    ({ c, id }) => {
      const d = window.__paneDocs?.[c];
      if (d === null || d === undefined) throw new Error(`the ${c} pane's doc is not mounted`);
      return d.getBlock(id);
    },
    { c: client, id }
  );
}

test("Backspace at the start of a non-empty quote never merges; the empty quote resets to a paragraph", async ({
  browser,
}) => {
  const { a, b, close } = await openPanes(browser, "quote-backspace");
  const ids = await a.evaluate(() => {
    const doc = window.__paneDocs?.a ?? null;
    if (doc === null) throw new Error("the pane's doc is not mounted");
    const prev = doc.insertBlock("paragraph");
    doc.insertText(prev, 0, "prev");
    const q = doc.insertBlock("quote");
    doc.insertText(q, 0, "abc");
    return { prev, q };
  });
  await rowsSettled(a);

  const quoteInner = a.locator(`[data-block-id="${ids.q}"] [data-slot="docblocks/block-content"]`);
  await quoteInner.click();
  await a.keyboard.press("Home");

  // Backspace at offset 0: no merge — the quote stands with its text, the
  // previous block is untouched (nothing deletes backwards past the start).
  await a.keyboard.press("Backspace");
  expect(await rootIds(a, "a")).toHaveLength(3); // the pane's starter + prev + the quote
  expect(await a.evaluate((q) => window.__paneDocs?.a?.getText(q) ?? null, ids.q)).toBe("abc");
  expect(await a.evaluate((p) => window.__paneDocs?.a?.getText(p) ?? null, ids.prev)).toBe("prev");

  // From the end the characters delete in place (the browser's in-block
  // default, committed by the input diff) until the quote is empty; the
  // next Backspace then resets it to a paragraph.
  await a.keyboard.press("End");
  await a.keyboard.press("Backspace");
  await a.keyboard.press("Backspace");
  await a.keyboard.press("Backspace");
  expect(await a.evaluate((q) => window.__paneDocs?.a?.getText(q) ?? null, ids.q)).toBe("");
  await a.keyboard.press("Backspace");
  expect((await blockOf(a, "a", ids.q))?.type).toBe("paragraph");
  expect(await rootIds(a, "a")).toHaveLength(3); // the starter + prev + the converted paragraph
  // The reset traveled the wire — wait for B to stand the paragraph (one-shot
  // reads can catch B mid-convergence under full-suite load).
  await expect.poll(async () => (await blockOf(b, "b", ids.q))?.type, SETTLE).toBe("paragraph");
  await close();
});
