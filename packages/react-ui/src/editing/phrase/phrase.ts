/** The shared phrase-trigger helpers: the query boundary, the block's text,
 *  the trigger block's inner editable, and the live caret offset. The slash
 *  and the mention pickers both read the trigger phrase state from the live
 *  DOM through these. */
import type { RefObject } from "react";

import type { Block, BlockId } from "docblocks-core";

import { caretOffsetIn } from "../dom-offset";

/** One query boundary: the whitespace characters that end the query. */
function isQueryBoundary(ch: string): boolean {
  return ch === " " || ch === "\t" || ch === "\n";
}

/** The block's text (a content block's runs joined; absent content is empty). */
function blockTextOf(block: Block | null | undefined): string {
  if (block === null || block === undefined || !("content" in block)) return "";
  return (block.content ?? []).reduce((t, run) => t + run.text, "");
}

/** The trigger block's inner editable (null when the block vanished). */
function blockInnerOf(rootRef: RefObject<HTMLElement | null>, blockId: BlockId): HTMLElement | null {
  return (
    rootRef.current?.querySelector<HTMLElement>(`[data-block-id="${blockId}"] [data-slot="docblocks/block-content"]`) ??
    null
  );
}

/**
 * The caret offset inside the trigger block, live from the DOM selection.
 * The browser settles the DOM before the store commit that re-renders the
 * menu, so the read stands at the current text (a stale caret state would
 * stand past the shrunken query's end after a Backspace and close the menu
 * wrongly). The declared open seat (the caret right after the trigger
 * character) stands when the selection does not sit in the block.
 */
function liveCaretOf(rootRef: RefObject<HTMLElement | null>, blockId: BlockId, fallback: number): number {
  const el = blockInnerOf(rootRef, blockId);
  const selection = window.getSelection();
  if (
    el !== null &&
    selection !== null &&
    selection.rangeCount > 0 &&
    selection.isCollapsed &&
    selection.anchorNode !== null &&
    el.contains(selection.anchorNode)
  ) {
    return caretOffsetIn(el, selection.anchorNode, selection.anchorOffset);
  }
  return fallback;
}

export { blockInnerOf, blockTextOf, isQueryBoundary, liveCaretOf };
