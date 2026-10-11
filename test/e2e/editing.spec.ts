import { type Browser, type Page, expect, test } from "@playwright/test";

// Each test gets its own room via ?syncUrl= — the relay keeps rooms for
// the dev server's lifetime, so a shared room would be polluted by other
// spec files (and by manually opened tabs).
const RELAY = "ws://localhost:5199";
const SETTLE = { timeout: 15_000 };

async function openPane(page: Page, client: "a" | "b", room: string): Promise<void> {
  await page.goto(`/?client=${client}&syncUrl=${RELAY}/${room}`);
  await expect(page.getByTestId(`status-${client}`)).toHaveText("connected", SETTLE);
}

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

async function twoPanes(
  browser: Browser,
  room: string
): Promise<{
  a: Page;
  b: Page;
  close: () => Promise<void>;
}> {
  const contextA = await browser.newContext();
  const contextB = await browser.newContext();
  const a = await contextA.newPage();
  const b = await contextB.newPage();
  const uniqueRoom = `${room}-${Math.random().toString(36).slice(2, 8)}`;
  await openPane(a, "a", uniqueRoom);
  await openPane(b, "b", uniqueRoom);
  return {
    a,
    b,
    close: async () => {
      await contextA.close();
      await contextB.close();
    },
  };
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
  await expect(paragraph(a, "a")).toHaveText("a", SETTLE);
  await expect(paragraph(b, "b")).toHaveText("a", SETTLE);

  await a.keyboard.press("Control+Shift+z");
  await expect(paragraph(a, "a")).toHaveText("ab", SETTLE);
  await expect(paragraph(b, "b")).toHaveText("ab", SETTLE);

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
  await expect(paragraph(a, "a")).toHaveText("a", SETTLE);
  await expect(paragraph(b, "b")).toHaveText("a", SETTLE);
  await expect.poll(async () => caretOffset(a), SETTLE).toBe(1);

  // Undo restores the text; the caret stays at the deletion start (the
  // undo inserts exactly at the caret position, which does not move it).
  await a.keyboard.press("Control+z");
  await expect(paragraph(a, "a")).toHaveText("abc", SETTLE);
  await expect(paragraph(b, "b")).toHaveText("abc", SETTLE);
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
