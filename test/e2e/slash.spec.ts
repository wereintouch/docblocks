import { type Browser, type Page, expect, test } from "@playwright/test";

import { RELAY, SETTLE, caretIn, editorContext, outCount } from "./helpers";

/**
 * The "/" slash command menu (the reworked model): the "/" is regular doc
 * text — the keypress commits it through the command API (the browser's
 * insertion stands suppressed), and the query typed after it is plain text
 * (the doc is the source of truth; the filter is the suffix after the
 * triggering "/" up to the first whitespace). The menu stands at the "/"
 * character (below the line; above it when the below placement overruns
 * the viewport), zero matches hide the list (deleting back brings it),
 * Esc keeps the phrase in the text (the existing "/" never re-triggers —
 * only a "/" keypress does), and a picked command converts the block's
 * type with the rest of the text surviving (the trigger phrase is
 * stripped). The trigger stands at any position and indent of a page text
 * block; code is excluded (a "/" there is plain text).
 */

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

function inner(page: Page, client: "a" | "b") {
  return page.locator(`[data-testid="doc-${client}"] [data-slot="docblocks/block-content"]`).first();
}

function menu(page: Page) {
  return page.locator('[data-slot="docblocks/slash-menu"]');
}

test("the / is a plain doc character — the doc and the wire see it; Backspace deletes it", async ({ browser }) => {
  const { a, b, close } = await openPanes(browser, "slash-plain");
  const target = inner(a, "a");
  await target.click();
  const outBefore = await outCount(a, "a");

  await a.keyboard.press("/");
  // The menu stands open and the character is in the doc (both panes — the
  // sync is plain text).
  await expect(menu(a)).toBeVisible();
  await expect(target).toHaveText("/");
  await expect(inner(b, "b")).toHaveText("/");
  await expect.poll(async () => outCount(a, "a")).toBe(outBefore + 1); // the wire log lags the update — polled

  // Backspace deletes the "/" like any other character: the anchor vanishes
  // and the menu closes.
  await a.keyboard.press("Backspace");
  await expect(menu(a)).toHaveCount(0);
  await expect(target).toHaveText("");
  await expect(inner(b, "b")).toHaveText("");
  await expect.poll(async () => outCount(a, "a")).toBe(outBefore + 2); // the wire log lags the update — polled
  await close();
});

test("the query filters; zero matches hide the list; deleting back brings it (the focus stays in the block)", async ({
  browser,
}) => {
  const { a, close } = await openPanes(browser, "slash-filter");
  const target = inner(a, "a");
  await target.click();

  await a.keyboard.type("/hea");
  await expect(menu(a)).toBeVisible();
  await expect(menu(a).locator('[role="menuitem"]')).toHaveCount(3);
  await expect(menu(a).locator('[role="menuitem"]')).toHaveText(["Heading 1", "Heading 2", "Heading 3"]);
  await expect.poll(() => caretIn(a, "[data-testid='doc-a'] [data-slot='docblocks/block-content']"), SETTLE).toBe(true);

  // Zero matches: the list disappears (no placeholder).
  await a.keyboard.type("zz");
  await expect(menu(a)).toHaveCount(0);
  await expect.poll(() => caretIn(a, "[data-testid='doc-a'] [data-slot='docblocks/block-content']"), SETTLE).toBe(true);
  await expect(target).toHaveText("/heazz");

  // Deleting back to a match brings the list (the state never closed — the
  // doc is the source of truth).
  await a.keyboard.press("Backspace");
  await a.keyboard.press("Backspace");
  await expect(target).toHaveText("/hea");
  await expect(menu(a)).toBeVisible();
  await expect(menu(a).locator('[role="menuitem"]')).toHaveCount(3);
  await expect.poll(() => caretIn(a, "[data-testid='doc-a'] [data-slot='docblocks/block-content']"), SETTLE).toBe(true);
  await close();
});

test("Esc keeps the phrase in the text; the existing / never re-triggers; a new / does", async ({ browser }) => {
  const { a, close } = await openPanes(browser, "slash-esc");
  const target = inner(a, "a");
  await target.click();

  await a.keyboard.type("/head");
  await expect(menu(a)).toBeVisible();
  await a.keyboard.press("Escape");
  await expect(menu(a)).toHaveCount(0);
  // The phrase stands in the doc as plain text (the block is editable as usual).
  await expect(target).toHaveText("/head");
  await expect.poll(() => caretIn(a, "[data-testid='doc-a'] [data-slot='docblocks/block-content']"), SETTLE).toBe(true);

  // Moving the caret back to the same "/" (no new "/" keypress) does not
  // re-open the menu.
  await a.keyboard.press("Home");
  await a.keyboard.press("ArrowRight");
  await a.keyboard.press("ArrowRight");
  await expect(menu(a)).toHaveCount(0);

  // A freshly typed "/" is a new trigger.
  await a.keyboard.press("End");
  await a.keyboard.press("/");
  await expect(menu(a)).toBeVisible();
  await expect(target).toHaveText("/head/");
  await close();
});

test("code does not trigger (a / there is plain text)", async ({ browser }) => {
  const { a, close } = await openPanes(browser, "slash-code");
  const target = inner(a, "a");
  await target.click();

  // A code block via the menu (the replace path on the phrase-only block).
  await a.keyboard.press("/");
  await expect(menu(a).getByRole("menuitem", { name: "Code block", exact: true })).toBeVisible();
  await menu(a).getByRole("menuitem", { name: "Code block", exact: true }).click();
  await expect(menu(a)).toHaveCount(0);
  const code = a.locator('[data-block-type="code"]');
  await expect(code).toHaveCount(1);

  // Inside the code block: the "/" is a plain character (no menu).
  const codeInner = code.locator('[data-slot="docblocks/block-content"]');
  await codeInner.click();
  await a.keyboard.type("a/b");
  await expect(menu(a)).toHaveCount(0);
  await expect(codeInner).toHaveText("a/b");
  await close();
});
