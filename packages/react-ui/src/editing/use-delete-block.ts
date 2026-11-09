/** The page row's delete affordance (the hover's trash icon): the shared
 * click gesture.
 *
 * The click is a true deletion (`removeBlocksSelection`): the keyboard's
 * Delete key's image special case (the in-place conversion to an empty
 * paragraph) stands for the key gesture only — the icon's semantics are
 * the explicit delete. The row's whole blocks selection is deleted when
 * the row is part of one (the Delete key's gesture parity); otherwise the
 * row alone.
 *
 * The gesture stands the Delete key's tail contract: over the document
 * root the caret re-seats on the trailing paragraph's guarantee;
 * otherwise the focus parks on the editor root (the deleted rows unmount
 * and the browser would drop the focus to the document — the undo hotkey
 * must still reach the doc from the park).
 */
import { useCallback } from "react";

import type { BlockId } from "docblocks-core";

import { entrySequenceParent } from "../blocks";
import { useEditorContext } from "../editor-provider";
import { ensureTrailingParagraph, focusCaretIn, removeBlocksSelection } from "./block-commands";
import { editorRootOf } from "./dom-offset";

function useDeleteBlock(): (button: HTMLElement, blockId: BlockId) => void {
  const { doc, rootBlockId, selection } = useEditorContext();

  return useCallback(
    (button: HTMLElement, blockId: BlockId) => {
      const view = selection.view;
      if (view === null) return;
      const current = view.get();
      const ids = current.kind === "blocks" && current.ids.includes(blockId) ? current.ids : [blockId];
      removeBlocksSelection(doc, entrySequenceParent(doc, rootBlockId), ids);
      view.set({ kind: "none" });
      const root = editorRootOf(button);
      if (rootBlockId === doc.meta.id) {
        const trailingId = ensureTrailingParagraph(doc, doc.meta.id);
        if (trailingId !== null) {
          focusCaretIn(trailingId, 0, root);
          return;
        }
      }
      if (root instanceof HTMLElement) root.focus();
    },
    [doc, rootBlockId, selection]
  );
}

export { useDeleteBlock };
