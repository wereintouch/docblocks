// The code block's caption line over the wire: the typing's stand + the erase+blur's drop,
// and the caption's press's focus's stand over the code's live caret (no container's
// reseat's steal).
import { type Browser, type Page, expect, test } from "@playwright/test";

import { RELAY, SETTLE, editorContext } from "./helpers";

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

test("the caption types in A and stands in B; erase + blur drops the line in both", async ({ browser }) => {
  const { a, b, close } = await openPanes(browser, "code-caption");
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

test("the caption's press over the code's live caret stands the input's focus (no container's reseat's steal)", async ({
  browser,
}) => {
  const { a, close } = await openPanes(browser, "code-caption-caret");
  const id = await seedCode(a, "a", "const x = 1;");
  await a.waitForTimeout(600);

  const block = blockWrapper(a, "a", id);
  // The live caret over the code's inner (the user's editing state): the
  // press's input's seat stood stolen over the page's container's position
  // reseat (the reseat's seat's focus's move stood the blur, the empty
  // line's unmount — the caption's caret's disappear).
  await innerOf(a, "a", id).click();
  await block.hover();
  await block.locator('[data-slot="docblocks/code-caption-toggle"]').click();

  const captionA = pane(a, "a").locator('[data-slot="docblocks/code-caption"]');
  await expect(captionA).toBeVisible();
  await expect(captionA).toBeFocused();
  await captionA.fill("Figure one");
  await expect.poll(async () => blockOf(a, "a", id), SETTLE).toMatchObject({ attrs: { caption: "Figure one" } });
  // The typing lands the caption's attr, never the code's text.
  expect((await blockOf(a, "a", id))?.content?.[0]?.text).toBe("const x = 1;");
  await close();
});
