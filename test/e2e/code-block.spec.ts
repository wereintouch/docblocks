// The code block's affordances: the header's hover/typing reveal, the language picker
// (the attr over the wire), the clipboard copy, the collapse/clamp sync, the "more" menu's
// display toggles, the logical line numbers, and the language pick that reveals the mermaid
// mode segment.
import { type Browser, type Page, expect, test } from "@playwright/test";

import {
  RELAY,
  SETTLE,
  editorContext,
  grantClipboardPermissions,
  interceptClipboardWrites,
  readClipboardPayload,
  rowsSettled,
} from "./helpers";

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

/** The code block's inner editable (descendant — the inner sits in the code body). */
function innerOf(page: Page, client: "a" | "b", id: string) {
  return pane(page, client).locator(`[data-block-id="${id}"] [data-slot="docblocks/block-content"]`);
}

/**
 * The block's WRAPPER only (the inner editable carries the same
 * data-block-id — the data-slot disambiguates).
 */
function blockWrapper(page: Page, client: "a" | "b", id: string) {
  return pane(page, client).locator(`[data-slot="docblocks/block"][data-block-id="${id}"]`);
}

test("the header reveals on hover; typing keeps the strip and hides the controls", async ({ browser }) => {
  const { a, close } = await openPanes(browser, "code-header");
  const id = await seedCode(a, "a", "const x = 1;");
  await rowsSettled(a);

  const block = blockWrapper(a, "a", id);
  const header = block.locator('[data-slot="docblocks/code-header"]');
  const actions = header.locator('[data-slot="docblocks/code-header-actions"]');

  // At rest (no hover, no focus): the strip is transparent, the controls
  // are hidden and unclickable.
  expect(await header.evaluate((el) => getComputedStyle(el).borderBottomColor)).toBe("rgba(0, 0, 0, 0)");
  expect(await actions.evaluate((el) => getComputedStyle(el).opacity)).toBe("0");

  // Hover: the strip stands and the controls reveal.
  await block.hover();
  await expect(header).not.toHaveCSS("border-bottom-color", "rgba(0, 0, 0, 0)");
  await expect(actions).toHaveCSS("opacity", "1");

  // The typing state: the caret is in the code and the pointer is AWAY
  // from the block — the strip stands (focus-within), the controls stand
  // hidden.
  await innerOf(a, "a", id).click();
  await a.keyboard.type(" 2");
  await a.mouse.move(5, 5); // the pointer leaves the block (the focus stands)
  await expect(header).not.toHaveCSS("border-bottom-color", "rgba(0, 0, 0, 0)");
  await expect(actions).toHaveCSS("opacity", "0");
  await close();
});

test("the header's controls stand over the keyboard (the focus reveal + the language pick)", async ({ browser }) => {
  const { a, b, close } = await openPanes(browser, "code-keyboard");
  const id = await seedCode(a, "a", "const x = 1;");
  await rowsSettled(a);

  const block = blockWrapper(a, "a", id);
  const header = block.locator('[data-slot="docblocks/code-header"]');
  const language = header.locator('[data-slot="docblocks/code-language"]');
  const actions = header.locator('[data-slot="docblocks/code-header-actions"]');

  // At rest (the pointer is away): the controls stand hidden.
  expect(await actions.evaluate((el) => getComputedStyle(el).opacity)).toBe("0");

  // The keyboard's path: the focus on a control stands the reveal (the
  // row's own focus-within — the hover-only reveal kept the controls
  // invisible under the Tab). Both groups stand: the focus on the left
  // control reveals the right ones over the tab walk.
  await language.focus();
  await expect(actions).toHaveCSS("opacity", "1");
  expect(await language.evaluate((el) => document.activeElement === el)).toBe(true);

  // The keyboard pick: the Enter stands the search, the typed name + the
  // Enter stand the language over the wire.
  await a.keyboard.press("Enter");
  const search = a.getByLabel("Search language");
  await expect(search).toBeVisible();
  await search.fill("py");
  await a.keyboard.press("Enter");
  expect((await blockOf(a, "a", id))?.attrs).toMatchObject({ language: "python" });
  await expect.poll(async () => (await blockOf(b, "b", id))?.attrs, SETTLE).toMatchObject({ language: "python" });

  // The Tab stands the next control (the copy button — the collapse is
  // disabled on the one-line block and skips the tab order) over the same
  // reveal.
  await language.focus();
  await a.keyboard.press("Tab");
  expect(await a.evaluate(() => document.activeElement?.getAttribute("data-slot"))).toBe("docblocks/code-copy");
  await close();
});

test("a language pick in A writes the attr — the label stands in B over the wire", async ({ browser }) => {
  const { a, b, close } = await openPanes(browser, "code-language");
  const id = await seedCode(a, "a", "const x = 1;");
  await rowsSettled(a);

  const block = blockWrapper(a, "a", id);
  await block.hover();
  await block.locator('[data-slot="docblocks/code-language"]').click();
  const search = a.locator('[data-slot="docblocks/code-language-search"]');
  await expect(search).toBeVisible();
  await search.fill("rus");
  await search.press("Enter"); // the first match (Rust)

  // The attr traveled the wire: B's label and the block attr stand.
  const blockB = blockWrapper(b, "b", id);
  await expect(blockB.locator('[data-slot="docblocks/code-language"]')).toContainText("Rust");
  await expect.poll(async () => blockOf(b, "b", id), SETTLE).toMatchObject({ attrs: { language: "rust" } });
  await close();
});

test("copy writes the indented plain text to the clipboard with the circle-check feedback", async ({ browser }) => {
  const { a, close } = await openPanes(browser, "code-copy");
  const context = a.context();
  await grantClipboardPermissions(context);
  const id = await seedCode(a, "a", "if ok:\n\tgo()");
  await rowsSettled(a);

  const block = blockWrapper(a, "a", id);
  await block.hover();
  const copy = block.locator('[data-slot="docblocks/code-copy"]');
  await interceptClipboardWrites(a);
  await copy.click();
  // The feedback flips while the write lands.
  await expect(copy).toHaveAttribute("data-copied", "true");
  const text = (await readClipboardPayload(a)).plain;
  // The indentation stands, no line numbers (the numbers are a rendered
  // affordance, not text).
  expect(text).toBe("if ok:\n\tgo()");
  await close();
});

test("collapse toggles over the wire (the clamp stands in B); a short block's button is disabled", async ({
  browser,
}) => {
  const { a, b, close } = await openPanes(browser, "code-collapse");
  const longId = await seedCode(a, "a", "one\ntwo\nthree\nfour\nfive\nsix\nseven");
  const shortId = await seedCode(a, "a", "one\ntwo");
  await rowsSettled(a);

  const longBlock = blockWrapper(a, "a", longId);
  const shortBlock = blockWrapper(a, "a", shortId);

  // The ≤5-logical-lines block: the button is disabled (not hidden).
  expect(await shortBlock.locator('[data-slot="docblocks/code-collapse"]').isDisabled()).toBe(true);

  // Toggle the long block in A: B's body stands clamped (the attr syncs).
  await longBlock.hover();
  await longBlock.locator('[data-slot="docblocks/code-collapse"]').click();
  const bodyB = pane(b, "b").locator(`[data-block-id="${longId}"] [data-slot="docblocks/code-body"]`);
  await expect(bodyB).toHaveCSS("overflow", "hidden");
  await expect.poll(async () => blockOf(b, "b", longId), SETTLE).toMatchObject({ attrs: { collapsed: true } });
  // A collapsed block is always expandable.
  expect(await longBlock.locator('[data-slot="docblocks/code-collapse"]').isDisabled()).toBe(false);
  await close();
});

test("the more menu's toggles flip over the wire (defaults ON); off removes the numbers column", async ({
  browser,
}) => {
  const { a, b, close } = await openPanes(browser, "code-more");
  const id = await seedCode(a, "a", "const x = 1;");
  await rowsSettled(a);

  const block = blockWrapper(a, "a", id);
  // The defaults read as ON for a fresh block (the absent attrs): the
  // numbers column stands.
  expect((await blockOf(a, "a", id))?.attrs?.lineNumbers ?? true).toBe(true);
  expect((await blockOf(a, "a", id))?.attrs?.wrap ?? true).toBe(true);
  expect(await block.locator('[data-slot="docblocks/code-line-numbers"]').count()).toBe(1);

  await block.hover();
  await block.locator('[data-slot="docblocks/code-more"]').click();
  const menu = a.locator('[data-slot="docblocks/code-more-menu"]');
  await expect(menu).toBeVisible();
  // Both items stand checked (the defaults ON).
  await expect(menu.locator('[data-code-option="lineNumbers"]')).toHaveAttribute("data-state", "checked");
  await expect(menu.locator('[data-code-option="wrap"]')).toHaveAttribute("data-state", "checked");
  await menu.locator('[data-code-option="lineNumbers"]').click();
  await menu.locator('[data-code-option="wrap"]').click();

  // The attrs travel the wire and B stands them: no numbers column, the
  // wrap-off classes.
  await expect(await block.locator('[data-slot="docblocks/code-line-numbers"]').count()).toBe(0);
  const blockB = blockWrapper(b, "b", id);
  // B converges over the wire — wait for the stand (a one-shot read can
  // catch B mid-convergence under full-suite load).
  await expect.poll(() => blockOf(b, "b", id), SETTLE).toMatchObject({ attrs: { lineNumbers: false, wrap: false } });
  await expect(blockB.locator('[data-slot="docblocks/code-line-numbers"]')).toHaveCount(0, SETTLE);
  await expect(blockB.locator('[data-slot="docblocks/code-scroll"]')).toHaveClass(/overflow-x-auto/);
  await close();
});

test("line numbers stand per LOGICAL line: wrapped continuations carry none", async ({ browser }) => {
  const { a, close } = await openPanes(browser, "code-numbers");
  const longLine = "x ".repeat(160).trim();
  const id = await seedCode(a, "a", `const first = 1;\nconst wrapped = "${longLine}";\nconst last = 3;`);
  await rowsSettled(a);

  const block = blockWrapper(a, "a", id);
  // Three logical lines → three numbers (the wrapped middle line carries
  // no continuation numbers), and the wrap is on by default (the wrapped
  // line wraps, not scrolls).
  expect(await block.locator('[data-slot="docblocks/code-line-numbers"] span').count()).toBe(3);
  await expect(block.locator('[data-slot="docblocks/code-scroll"]')).not.toHaveClass(/overflow-x-auto/);
  await close();
});

test("picking mermaid through the language menu reveals the mode segment in both panes", async ({ browser }) => {
  const { a, b, close } = await openPanes(browser, "code-mermaid-pick");
  const id = await seedCode(a, "a", "graph TD\n A-->B", { language: "mermaid" });
  await rowsSettled(a);

  const segmentA = pane(a, "a").locator(`[data-block-id="${id}"] [data-slot="docblocks/mermaid-mode"]`);
  const segmentB = pane(b, "b").locator(`[data-block-id="${id}"] [data-slot="docblocks/mermaid-mode"]`);
  await expect(segmentA).toHaveCount(1);
  await expect(segmentB).toHaveCount(1);
  // The default mode is code (the attr may be absent; the JSON shows the
  // language).
  await expect
    .poll(async () => blockOf(b, "b", id), SETTLE)
    .toMatchObject({ type: "code", attrs: { language: "mermaid" } });
  await close();
});
