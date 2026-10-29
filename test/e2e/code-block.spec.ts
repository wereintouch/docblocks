import { type Browser, type Page, expect, test } from "@playwright/test";

// The code block's affordances: the header's hover/typing reveal, the
// language picker (the attr over the wire), the clipboard copy, the
// collapse/clamp sync, the caption line sync, the "more" menu's display
// toggles, the logical line numbers, the keyboard gestures (the
// quote/callout soft-line family), the language pick that reveals the
// mermaid mode segment, and the curated-language syntax highlight layer
// (the paint, the edit/language-change re-paint over the wire, and the
// wrap-off alignment).
const RELAY = "ws://localhost:5199";
const SETTLE = { timeout: 15_000 };

/**
 * A unique room per test: the relay keeps rooms for the dev server's
 * lifetime, so a fixed name would accumulate the content of failed attempts
 * across runs.
 */
async function openPanes(browser: Browser, seed: string): Promise<{ a: Page; b: Page; close: () => Promise<void> }> {
  const room = `${seed}-${Math.random().toString(36).slice(2, 8)}`;
  const contextA = await browser.newContext();
  const contextB = await browser.newContext();
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

/**
 * The block's WRAPPER only (the inner editable carries the same
 * data-block-id — the data-slot disambiguates).
 */
function blockWrapper(page: Page, client: "a" | "b", id: string) {
  return pane(page, client).locator(`[data-slot="docblocks/block"][data-block-id="${id}"]`);
}

test("the header reveals on hover; typing keeps the strip and hides the controls", async ({ browser }) => {
  const { a, close } = await openPanes(browser, "ux16-code-header");
  const id = await seedCode(a, "a", "const x = 1;");
  await a.waitForTimeout(600);

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

test("a language pick in A writes the attr — the label stands in B over the wire", async ({ browser }) => {
  const { a, b, close } = await openPanes(browser, "ux16-code-language");
  const id = await seedCode(a, "a", "const x = 1;");
  await a.waitForTimeout(600);

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
  const { a, close } = await openPanes(browser, "ux16-code-copy");
  const context = a.context();
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const id = await seedCode(a, "a", "if ok:\n\tgo()");
  await a.waitForTimeout(600);

  const block = blockWrapper(a, "a", id);
  await block.hover();
  const copy = block.locator('[data-slot="docblocks/code-copy"]');
  await copy.click();
  // The feedback flips while the write lands.
  await expect(copy).toHaveAttribute("data-copied", "true");
  const text = await a.evaluate(() => navigator.clipboard.readText());
  // The indentation stands, no line numbers (the numbers are a rendered
  // affordance, not text).
  expect(text).toBe("if ok:\n\tgo()");
  await close();
});

test("collapse toggles over the wire (the clamp stands in B); a short block's button is disabled", async ({
  browser,
}) => {
  const { a, b, close } = await openPanes(browser, "ux16-code-collapse");
  const longId = await seedCode(a, "a", "one\ntwo\nthree\nfour\nfive\nsix\nseven");
  const shortId = await seedCode(a, "a", "one\ntwo");
  await a.waitForTimeout(600);

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

test("the caption types in A and stands in B; erase + blur drops the line in both", async ({ browser }) => {
  const { a, b, close } = await openPanes(browser, "ux16-code-caption");
  const id = await seedCode(a, "a", "const x = 1;");
  await a.waitForTimeout(600);

  const block = blockWrapper(a, "a", id);
  await block.hover();
  await block.locator('[data-slot="docblocks/code-caption-toggle"]').click();
  // The caption line stands BELOW the block, as a SIBLING of the wrapper
  // (the TextBlock's fragment) — the pane scope is unambiguous (one code
  // block in the room).
  const captionA = pane(a, "a").locator('[data-slot="docblocks/code-caption"]');
  await expect(captionA).toBeVisible();
  await captionA.fill("Figure one");

  // The attr travels the wire: B stands the caption line with the text.
  const captionB = pane(b, "b").locator('[data-slot="docblocks/code-caption"]');
  await expect(captionB).toBeVisible();
  await expect(captionB).toHaveValue("Figure one");
  await expect.poll(async () => blockOf(b, "b", id), SETTLE).toMatchObject({ attrs: { caption: "Figure one" } });

  // Erase + blur in A: the attr writes the empty string (the removed
  // state), the line unmounts in both panes.
  await captionA.fill("");
  await innerOf(a, "a", id).click(); // the blur
  await expect(captionA).toBeHidden();
  await expect(captionB).toBeHidden();
  await expect.poll(async () => blockOf(b, "b", id), SETTLE).toMatchObject({ attrs: { caption: "" } });
  await close();
});

test("the more menu's toggles flip over the wire (defaults ON); off removes the numbers column", async ({
  browser,
}) => {
  const { a, b, close } = await openPanes(browser, "ux16-code-more");
  const id = await seedCode(a, "a", "const x = 1;");
  await a.waitForTimeout(600);

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
  const { a, close } = await openPanes(browser, "ux16-code-numbers");
  const longLine = "x ".repeat(160).trim();
  const id = await seedCode(a, "a", `const first = 1;\nconst wrapped = "${longLine}";\nconst last = 3;`);
  await a.waitForTimeout(600);

  const block = blockWrapper(a, "a", id);
  // Three logical lines → three numbers (the wrapped middle line carries
  // no continuation numbers), and the wrap is on by default (the wrapped
  // line wraps, not scrolls).
  expect(await block.locator('[data-slot="docblocks/code-line-numbers"] span').count()).toBe(3);
  await expect(block.locator('[data-slot="docblocks/code-scroll"]')).not.toHaveClass(/overflow-x-auto/);
  await close();
});

test("picking mermaid through the language menu reveals the mode segment in both panes", async ({ browser }) => {
  const { a, b, close } = await openPanes(browser, "ux16-code-mermaid-pick");
  const id = await seedCode(a, "a", "graph TD\n A-->B", { language: "mermaid" });
  await a.waitForTimeout(600);

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

test("Enter on a non-empty code line is a line break; the empty last line exits", async ({ browser }) => {
  const { a, b, close } = await openPanes(browser, "ux16-code-enter");
  const id = await seedCode(a, "a", "line one");
  await a.waitForTimeout(600);

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
  const paragraph = pane(a, "a").locator(`[data-block-id="${ids[2]}"] [data-slot="docblocks/block-content"]`);
  await expect(paragraph).toBeFocused();
  // The exit traveled the wire — wait for B to stand it (one-shot reads
  // can catch B mid-convergence).
  await expect.poll(async () => (await blockOf(b, "b", ids[2]!))?.type, SETTLE).toBe("paragraph");
  await expect.poll(async () => (await blockOf(b, "b", id))?.type, SETTLE).toBe("code");
  await close();
});

test("Enter on a wholly empty code converts it to a paragraph in place", async ({ browser }) => {
  const { a, close } = await openPanes(browser, "ux16-code-empty-enter");
  const id = await seedCode(a, "a", "");
  await a.waitForTimeout(600);

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
  const { a, b, close } = await openPanes(browser, "ux16-code-backspace");
  const ids = await a.evaluate(() => {
    const doc = window.__paneDocs?.a ?? null;
    if (doc === null) throw new Error("the pane's doc is not mounted");
    const prev = doc.insertBlock("paragraph");
    doc.insertText(prev, 0, "prev");
    const code = doc.insertBlock("code");
    doc.insertText(code, 0, "abc");
    return { prev, code };
  });
  await a.waitForTimeout(600);

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

test("the highlight layer paints for a curated language and follows the edits (both panes)", async ({ browser }) => {
  const { a, b, close } = await openPanes(browser, "ux17-code-highlight");
  const id = await seedCode(a, "a", "", { language: "python" });
  await a.waitForTimeout(600);

  const layer = blockWrapper(a, "a", id).locator('[data-slot="docblocks/code-highlight"]');

  // The curated language stands the token-colored layer behind the
  // transparent inner ink; typing commits the doc and the layer re-paints
  // with the new tokens.
  const inner = innerOf(a, "a", id);
  await inner.click();
  await a.keyboard.type("def main():");
  await expect.poll(async () => (await layer.evaluate((el) => el.innerHTML)).includes("hljs-keyword")).toBe(true);
  await a.keyboard.press("Enter"); // the code line break (a \n in the text)
  await a.keyboard.type("return 1");
  await expect.poll(async () => (await layer.evaluate((el) => el.innerHTML)).includes("hljs-number")).toBe(true);

  // The remote pane re-paints its own layer over the wire — the doc text
  // is the sync channel, the highlight is derived from it.
  const layerB = blockWrapper(b, "b", id).locator('[data-slot="docblocks/code-highlight"]');
  await expect.poll(async () => (await layerB.evaluate((el) => el.innerHTML)).includes("hljs-number")).toBe(true);

  // The inner ink is transparent behind the layer (the caret stands;
  // getComputedStyle serializes the transparent keyword as rgba(0,0,0,0)).
  expect(await inner.evaluate((el) => getComputedStyle(el).color)).toBe("rgba(0, 0, 0, 0)");
  await close();
});

test("a language pick through the header re-highlights the layer", async ({ browser }) => {
  const { a, close } = await openPanes(browser, "ux17-code-highlight-lang");
  const id = await seedCode(a, "a", '{"x": 1}\n', { language: "python" });
  await a.waitForTimeout(600);

  const block = blockWrapper(a, "a", id);
  const layer = block.locator('[data-slot="docblocks/code-highlight"]');
  await expect.poll(async () => (await layer.evaluate((el) => el.innerHTML)).includes("hljs-string")).toBe(true);
  expect(await layer.evaluate((el) => el.innerHTML)).not.toContain("hljs-attr");

  // Pick json through the header menu (the real UI path).
  await block.hover();
  await block.locator('[data-slot="docblocks/code-language"]').click();
  const search = a.locator('[data-slot="docblocks/code-language-search"]');
  await expect(search).toBeVisible();
  await search.fill("jso");
  await search.press("Enter"); // the first match (JSON)

  // The json grammar paints the key as an attr — the re-paint, not the
  // raw text.
  await expect.poll(async () => (await layer.evaluate((el) => el.innerHTML)).includes("hljs-attr")).toBe(true);
  await close();
});

test("the highlight layer aligns with the inner in the wrap-off horizontal scroll", async ({ browser }) => {
  const { a, close } = await openPanes(browser, "ux17-code-highlight-wrap");
  const longLine = "const payload = " + "x".repeat(160) + ";";
  const id = await seedCode(a, "a", longLine + "\nconst done = true;", {
    language: "javascript",
    wrap: false,
  });
  await a.waitForTimeout(600);

  const block = blockWrapper(a, "a", id);
  const layer = block.locator('[data-slot="docblocks/code-highlight"]');
  await expect.poll(async () => (await layer.evaluate((el) => el.innerHTML)).includes("hljs-keyword")).toBe(true);

  // The wrap-off scroll stands (the long line overflows the viewport).
  const scroll = block.locator('[data-slot="docblocks/code-scroll"]');
  expect(await scroll.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeGreaterThan(0);

  // The layer and the inner share the scroll content box — the boxes align
  // (the same typography and the same content, no horizontal drift).
  const inner = innerOf(a, "a", id);
  const innerBox = await inner.boundingBox();
  const layerBox = await layer.boundingBox();
  if (innerBox === null || layerBox === null) throw new Error("the boxes stand");
  expect(Math.abs(innerBox.width - layerBox.width)).toBeLessThan(1);
  expect(Math.abs(innerBox.height - layerBox.height)).toBeLessThan(1);
  await close();
});
