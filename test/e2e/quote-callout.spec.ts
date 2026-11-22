// The callout shares the quote interactivity: Backspace at the start never
// merges (no wire update), Enter on a non-empty line is a break, and the
// empty last line exits (the lines stand as the callout, a new paragraph
// takes the caret).
import { type Browser, type Page, expect, test } from "@playwright/test";

import { RELAY, SETTLE, caretIn, editorContext, outCount, rowsSettled } from "./helpers";

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

test("the callout shares the quote interactivity", async ({ browser }) => {
  const { a, b, close } = await openPanes(browser, "quote-callout");
  const calloutId = await a.evaluate(() => {
    const doc = window.__paneDocs?.a ?? null;
    if (doc === null) throw new Error("the pane's doc is not mounted");
    const c = doc.insertBlock("callout");
    doc.insertText(c, 0, "one");
    return c;
  });
  await rowsSettled(a);

  const calloutInner = a.locator(`[data-block-id="${calloutId}"] [data-slot="docblocks/block-content"]`);
  const outBefore = await outCount(a, "a");

  // Backspace at offset 0 of a non-empty callout: no merge, no wire update.
  await calloutInner.click();
  await a.keyboard.press("Home");
  await a.keyboard.press("Backspace");
  await expect.poll(async () => outCount(a, "a")).toBe(outBefore);
  expect(await a.evaluate((c) => window.__paneDocs?.a?.getText(c) ?? null, calloutId)).toBe("one");
  expect((await blockOf(a, "a", calloutId))?.type).toBe("callout");

  // Enter is a line break (no split); from the empty last line it exits:
  // the lines stand as the callout, a new paragraph takes the caret.
  await a.keyboard.press("End");
  await a.keyboard.press("Enter"); // line break
  await a.keyboard.type("two");
  await a.keyboard.press("Enter"); // line break after "two"
  await a.keyboard.press("Enter"); // the exit
  expect((await blockOf(a, "a", calloutId))?.type).toBe("callout");
  expect(await a.evaluate((c) => window.__paneDocs?.a?.getText(c) ?? null, calloutId)).toBe("one\ntwo");
  const ids = await rootIds(a, "a");
  expect(ids).toHaveLength(3); // the starter + the callout + the new paragraph
  expect(ids[1]).toBe(calloutId);
  expect((await blockOf(a, "a", ids[2]!))?.type).toBe("paragraph");
  // The caret stands in the new paragraph (the gesture's focus move — the
  // shared page container is the focused element, the caret's seat is the
  // live selection's).
  await expect
    .poll(() => caretIn(a, `[data-block-id="${ids[2]!}"] [data-slot="docblocks/block-content"]`), SETTLE)
    .toBe(true);
  // The exit traveled the wire — wait for B to stand the callout + text
  // (one-shot reads can catch B mid-convergence).
  await expect.poll(async () => (await blockOf(b, "b", calloutId))?.type, SETTLE).toBe("callout");
  await expect
    .poll(async () => await b.evaluate((c) => window.__paneDocs?.b?.getText(c) ?? null, calloutId), SETTLE)
    .toBe("one\ntwo");
  await close();
});
