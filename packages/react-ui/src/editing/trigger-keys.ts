/** The slash and the mention's triggers (the input-safety's stand): a
 *  "/" with a collapsed caret in a page text block opens the command
 *  menu, an "@" at a boundary opens the mention picker. The character
 *  stands in the doc as a regular one (the editor commits it; the
 *  browser's insertion is suppressed), and the menu tracks the text
 *  after it (the doc is the query's source of truth). */
import type { KeyboardEvent } from "react";

import type { BlockId, Doc } from "docblocks-core";

import type { BlockContextValue } from "../blocks";
import type { EditorStore } from "../state";
import { caretOffsetIn } from "./dom-offset";
import type { useMentionMenuApi } from "./mention";
import type { useSlashMenuApi } from "./slash";

type TriggerArgs = {
  doc: Doc;
  slash: ReturnType<typeof useSlashMenuApi>;
  mention: ReturnType<typeof useMentionMenuApi>;
  inner: HTMLElement;
  id: BlockId;
  context: BlockContextValue;
  rootBlockId: BlockId;
  store: EditorStore;
  declareLocalCaret: (offset: number) => void;
};

function handleTriggerKeys(
  event: KeyboardEvent<HTMLElement>,
  { doc, slash, mention, inner, id, context, rootBlockId, store, declareLocalCaret }: TriggerArgs
): boolean {
  // The slash trigger: a "/" with a collapsed caret in a page text block
  // (paragraph, heading, list-item, callout, quote — code is
  // excluded: a "/" there is plain text) at any position and any indent
  // of the root page sequence (or the provider's entry root itself)
  // opens the command menu. The character stands in the doc as a regular
  // one (the editor commits it; the browser's insertion is suppressed) —
  // the menu tracks the text after it (the doc is the query's source
  // of truth), and Backspace deletes it like any other.
  if (
    slash !== null &&
    event.key === "/" &&
    !event.nativeEvent.isComposing &&
    !event.metaKey &&
    !event.ctrlKey &&
    !event.altKey
  ) {
    const domSelection = window.getSelection();
    if (domSelection === null || !domSelection.isCollapsed) return false;
    if (domSelection.anchorNode === null || !inner.contains(domSelection.anchorNode)) return false;
    const block = store.getState().blocks[id];
    if (block === undefined) return false;
    const type = block.type;
    const isPageText =
      type === "paragraph" || type === "heading" || type === "list-item" || type === "callout" || type === "quote";
    const inPageSequence = context.parentId === rootBlockId || id === rootBlockId;
    if (isPageText && inPageSequence) {
      const caret = caretOffsetIn(inner, domSelection.anchorNode, domSelection.anchorOffset);
      if (slash.onSlashKey(event, id, context.parentId, caret)) {
        // The key's default is prevented by the trigger: the editor
        // commits the "/" itself (one undo step) and the caret lands
        // after it — declared before the store update, since the
        // rebase rule keeps a caret at the insertion offset in place.
        declareLocalCaret(caret + 1);
        doc.insertText(id, caret, "/");
        return true;
      }
    }
  }

  // The mention trigger: an "@" with a collapsed caret in a page text
  // block (the same page-text set as the slash; code is excluded — an
  // "@" there is plain text) at a boundary (the start or after
  // whitespace) opens the mention picker when a provider stands. The
  // character stands in the doc as a regular one (the editor commits
  // it; the browser's insertion is suppressed) — the picker tracks the
  // text after it. Without a provider, or at a non-boundary, the "@" is
  // plain text (the trigger declines and the key flows to the browser).
  if (
    mention !== null &&
    event.key === "@" &&
    !event.nativeEvent.isComposing &&
    !event.metaKey &&
    !event.ctrlKey &&
    !event.altKey
  ) {
    const domSelection = window.getSelection();
    if (domSelection === null || !domSelection.isCollapsed) return false;
    if (domSelection.anchorNode === null || !inner.contains(domSelection.anchorNode)) return false;
    const block = store.getState().blocks[id];
    if (block === undefined) return false;
    const type = block.type;
    const isPageText =
      type === "paragraph" || type === "heading" || type === "list-item" || type === "callout" || type === "quote";
    const inPageSequence = context.parentId === rootBlockId || id === rootBlockId;
    if (isPageText && inPageSequence) {
      const caret = caretOffsetIn(inner, domSelection.anchorNode, domSelection.anchorOffset);
      if (mention.onMentionKey(event, id, context.parentId, caret)) {
        declareLocalCaret(caret + 1);
        doc.insertText(id, caret, "@");
        return true;
      }
    }
  }
  return false;
}

export { handleTriggerKeys };
