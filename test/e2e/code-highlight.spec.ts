// The curated-language syntax highlight layer: the paint over the edit's re-paint (both
// panes), the language pick's re-highlight, and the wrap-off's horizontal scroll's
// alignment.
import { type Browser, type Page, expect, test } from "@playwright/test";

import { RELAY, editorContext } from "./helpers";

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

test("the highlight layer paints for a curated language and follows the edits (both panes)", async ({ browser }) => {
  const { a, b, close } = await openPanes(browser, "code-highlight");
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
  const { a, close } = await openPanes(browser, "code-highlight-lang");
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
  const { a, close } = await openPanes(browser, "code-highlight-wrap");
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
