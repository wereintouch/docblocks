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
 * The removal and the root's trailing-paragraph stand share one undo step.
 * The caret re-seats on the next surviving text block, then the previous one
 * or the stood tail. Without a text survivor the focus parks on the editor
 * root, keeping the undo hotkey reachable after the deleted rows unmount.
 */
import { useCallback } from "react";

import type { BlockId } from "docblocks-core";

import { entrySequenceParent } from "../blocks";
import { useEditorContext } from "../editor-provider";
import { focusCaretIn, removeBlocksSelection } from "./block-commands";
import { editorRootOf } from "./dom-offset";

function useDeleteBlock(): (button: HTMLElement, blockId: BlockId) => void {
  const { doc, rootBlockId, selection } = useEditorContext();

  return useCallback(
    (button: HTMLElement, blockId: BlockId) => {
      const view = selection.view;
      if (view === null) return;
      const current = view.get();
      const ids = current.kind === "blocks" && current.ids.includes(blockId) ? current.ids : [blockId];
      const caret = removeBlocksSelection(doc, entrySequenceParent(doc, rootBlockId), ids);
      view.set({ kind: "none" });
      const root = editorRootOf(button);
      if (caret !== null) {
        focusCaretIn(caret.blockId, caret.offset, root ?? document);
        return;
      }
      if (root instanceof HTMLElement) root.focus();
    },
    [doc, rootBlockId, selection]
  );
}

export { useDeleteBlock };
