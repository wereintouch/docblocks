// The @ mention's e2e shared kit: the pane's top-level editor's locator + the trigger phrase's
// typing over the block's inner.
import { type Page } from "@playwright/test";

/** The top-level editor of a pane (the non-catalog panes hold one editor). */
function editorOf(page: Page, client: "a" | "b") {
  return page.locator(`[data-testid="doc-${client}"] [data-slot="docblocks/editor"]`).first();
}

/** Click into a paragraph's inner and type the trigger phrase. */
async function typeMentionPhrase(page: Page, client: "a" | "b", blockId: string, phrase: string): Promise<void> {
  const inner = page.locator(
    `[data-testid="doc-${client}"] [data-block-id="${blockId}"][data-slot="docblocks/block-content"]`
  );
  await inner.click();
  await page.keyboard.type(phrase);
}

export { editorOf, typeMentionPhrase };
