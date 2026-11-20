import { type Page } from "@playwright/test";

/** The caret's seat over the block's inner (the shared-page model's
 * check): the page container is the focused element, and the caret's block
 * is read from the live DOM selection (the anchor, or the range's
 * endpoints over the clamped engines). */
async function caretIn(page: Page, innerSelector: string): Promise<boolean> {
  return page.evaluate((selector) => {
    const el = document.querySelector(selector) as HTMLElement | null;
    const selection = window.getSelection();
    if (el === null || selection === null || selection.rangeCount === 0) return false;
    const range = selection.getRangeAt(0);
    return el.contains(selection.anchorNode) || el.contains(range.startContainer) || el.contains(range.endContainer);
  }, innerSelector);
}

export { caretIn };
