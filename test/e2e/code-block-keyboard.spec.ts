// The code block's keyboard gestures: the Enter's line break / the empty last line's exit,
// the empty code's in-place conversion, and the Backspace's no-merge + the empty one's
// reset to a paragraph.
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

function pane(page: Page, client: "a" | "b") {
  return page.locator(`[data-testid="doc-${client}"]`);
}

/** Insert one block with text into the pane's doc through the harness doc global. */
async function seedCode(page: Page, client: "a" | "b", text: string, attrs?: Record<string, unknown>): Promise<string> {
  const id = await page.evaluate(
    ({ client, text, attrs }) => {
      const doc = window.__paneDocs?.[client] ?? null;
      if (doc === null) throw new Error("the pane's doc is not mounted");
      const code = doc.insertBlock("code", attrs);
      if (text !== "") doc.insertText(code, 0, text);
      return code;
    },
    { client, text, attrs }
  );
  expect(id).not.toBeNull();
  return id;
}

function blockOf(page: Page, client: "a" | "b", id: string) {
  return page.evaluate(({ client, id }) => window.__paneDocs?.[client]?.getBlock(id) ?? null, { client, id });
}

/** The pane's root child ids (the starter paragraph counts). */
async function rootIds(page: Page, client: "a" | "b"): Promise<string[]> {
  return page.evaluate((c) => {
    const doc = window.__paneDocs?.[c] ?? null;
    if (doc === null) throw new Error("the pane's doc is not mounted");
    return doc.getChildren(doc.meta.id);
  }, client);
}

/** The code block's inner editable (descendant — the inner sits in the code body). */
function innerOf(page: Page, client: "a" | "b", id: string) {
  return pane(page, client).locator(`[data-block-id="${id}"] [data-slot="docblocks/block-content"]`);
}

test("Enter on a non-empty code line is a line break; the empty last line exits", async ({ browser }) => {
  const { a, b, close } = await openPanes(browser, "code-enter");
  const id = await seedCode(a, "a", "line one");
  await rowsSettled(a);

  const inner = innerOf(a, "a", id);
  await inner.click();
  await a.keyboard.press("End");

  // Enter on the non-empty line: a soft line break (the type stands).
  await a.keyboard.press("Enter");
  expect(await a.evaluate((q) => window.__paneDocs?.a?.getText(q) ?? null, id)).toBe("line one\n");
  expect((await blockOf(a, "a", id))?.type).toBe("code");
  expect((await rootIds(a, "a")).length).toBe(2); // the starter + the code

  // A second line, then the empty last line: Enter exits — the code keeps
  // both lines, a new empty paragraph takes the caret.
  await a.keyboard.type("line two");
  await a.keyboard.press("Enter"); // the line break
  await a.keyboard.press("Enter"); // the exit
  expect((await blockOf(a, "a", id))?.type).toBe("code");
  expect(await a.evaluate((q) => window.__paneDocs?.a?.getText(q) ?? null, id)).toBe("line one\nline two");
  const ids = await rootIds(a, "a");
  expect(ids).toHaveLength(3);
  expect((await blockOf(a, "a", ids[2]!))?.type).toBe("paragraph");
  // The exit re-seats the caret into the next paragraph (the seat is read
  // over the live selection's anchor — the page's single editable's focus
  // is the container).
  await expect
    .poll(
      async () =>
        a.evaluate((id) => {
          const selection = window.getSelection();
          if (selection === null || selection.anchorNode === null) return false;
          const inner = document.querySelector<HTMLElement>(
            `[data-block-id="${id}"] [data-slot='docblocks/block-content']`
          );
          return inner !== null && inner.contains(selection.anchorNode);
        }, ids[2]),
      SETTLE
    )
    .toBe(true);
  // The exit traveled the wire — wait for B to stand it (one-shot reads
  // can catch B mid-convergence).
  await expect.poll(async () => (await blockOf(b, "b", ids[2]!))?.type, SETTLE).toBe("paragraph");
  await expect.poll(async () => (await blockOf(b, "b", id))?.type, SETTLE).toBe("code");
  await close();
});

test("Enter on a wholly empty code converts it to a paragraph in place", async ({ browser }) => {
  const { a, close } = await openPanes(browser, "code-empty-enter");
  const id = await seedCode(a, "a", "");
  await rowsSettled(a);

  const inner = innerOf(a, "a", id);
  await inner.click();
  await a.keyboard.press("Enter");

  expect((await blockOf(a, "a", id))?.type).toBe("paragraph");
  expect((await rootIds(a, "a")).length).toBe(2); // the starter + the converted block
  await close();
});

test("Backspace at the start of a non-empty code never merges; the empty one resets to a paragraph", async ({
  browser,
}) => {
  const { a, b, close } = await openPanes(browser, "code-backspace");
  const ids = await a.evaluate(() => {
    const doc = window.__paneDocs?.a ?? null;
    if (doc === null) throw new Error("the pane's doc is not mounted");
    const prev = doc.insertBlock("paragraph");
    doc.insertText(prev, 0, "prev");
    const code = doc.insertBlock("code");
    doc.insertText(code, 0, "abc");
    return { prev, code };
  });
  await rowsSettled(a);

  const inner = innerOf(a, "a", ids.code);
  await inner.click();
  await a.keyboard.press("Home");

  // Backspace at offset 0: no merge — the code stands with its text, the
  // previous block is untouched.
  await a.keyboard.press("Backspace");
  expect(await rootIds(a, "a")).toHaveLength(3); // the starter + prev + the code
  expect(await a.evaluate((q) => window.__paneDocs?.a?.getText(q) ?? null, ids.code)).toBe("abc");
  expect(await a.evaluate((p) => window.__paneDocs?.a?.getText(p) ?? null, ids.prev)).toBe("prev");

  // The characters delete in place until the code is empty; the next
  // Backspace resets it to a paragraph (over the wire).
  await a.keyboard.press("End");
  await a.keyboard.press("Backspace");
  await a.keyboard.press("Backspace");
  await a.keyboard.press("Backspace");
  expect(await a.evaluate((q) => window.__paneDocs?.a?.getText(q) ?? null, ids.code)).toBe("");
  await a.keyboard.press("Backspace");
  expect((await blockOf(a, "a", ids.code))?.type).toBe("paragraph");
  expect(await rootIds(a, "a")).toHaveLength(3); // the starter + prev + the converted paragraph
  await expect.poll(async () => (await blockOf(b, "b", ids.code))?.type, SETTLE).toBe("paragraph");
  await close();
});
