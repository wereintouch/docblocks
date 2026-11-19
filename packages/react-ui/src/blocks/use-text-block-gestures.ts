/** The text block's row gestures: the gutter's press (the blocks'
 * selection, the Shift's extension from the previous anchor), the
 * quick-insert plus (an empty paragraph under the block, the caret at its
 * start), the control's mousedown guard (the caret's no move), and the
 * collapse toggle (a view-state flip — no doc command, no wire update,
 * not in the undo history). */
import { useCallback } from "react";
import type { MouseEvent as ReactMouseEvent, RefObject } from "react";

import type { BlockId } from "docblocks-core";

import { editorRootOf } from "../editing/dom-offset";
import { insertParagraphAfter } from "../editing/gutter-plus";
import { parkEditorFocus } from "../editing/page-surface";
import { useEditorContext } from "../editor-provider";
import { indentOf } from "./flat";
import type { EditableBlock } from "./models";

interface UseTextBlockGesturesArgs {
  id: BlockId;
  block: EditableBlock;
  /** The block context's value (the parent's id + type). */
  parentId: string;
  wrapperRef: RefObject<HTMLElement | null>;
}

function useTextBlockGestures({ id, block, parentId, wrapperRef }: UseTextBlockGesturesArgs) {
  const { doc, store, selection: selectionRef } = useEditorContext();

  /** Gutter click: a blocks selection on this block (Shift extends from the previous anchor). */
  const onGutterClick = useCallback(
    (event: ReactMouseEvent<HTMLButtonElement>) => {
      event.preventDefault();
      const view = selectionRef.view;
      if (view === null) return;
      const current = view.get();
      if (event.shiftKey && current.kind === "blocks") {
        const siblings = doc.getChildren(parentId);
        const anchorIndex = siblings.indexOf(current.anchorId);
        const hereIndex = siblings.indexOf(id);
        // Same parent only; a cross-parent range is a v1.1 feature.
        if (anchorIndex !== -1 && hereIndex !== -1) {
          const [low, high] = anchorIndex <= hereIndex ? [anchorIndex, hereIndex] : [hereIndex, anchorIndex];
          view.set({ kind: "blocks", ids: siblings.slice(low, high + 1), anchorId: current.anchorId });
        } else {
          view.set({ kind: "blocks", ids: [id], anchorId: id });
        }
      } else {
        view.set({ kind: "blocks", ids: [id], anchorId: id });
      }
      // The editor root's focus park (the selection keys' reach): the
      // wrapper is not focusable in the shared-editable model (a focusable
      // wrapper would stand the mousedown's focus fallback's landing and
      // seat a caret over the blocks' view).
      if (wrapperRef.current !== null) parkEditorFocus(wrapperRef.current);
    },
    [doc, id, parentId, selectionRef, wrapperRef]
  );

  /** Gutter plus: an empty paragraph under this block (one transact), the caret at its start. */
  const onGutterPlusClick = useCallback(
    (event: ReactMouseEvent<HTMLButtonElement>) => {
      event.preventDefault();
      insertParagraphAfter(doc, id, parentId, indentOf(block), editorRootOf(wrapperRef.current ?? document));
    },
    [block, doc, id, parentId, wrapperRef]
  );

  /** Keep a mousedown on a block control from moving the text caret. */
  const onControlMouseDown = useCallback((event: ReactMouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
  }, []);

  /** Collapse toggle: a view-state flip (no doc command, no wire update, not in the undo history). */
  const onCollapseClick = useCallback(
    (event: ReactMouseEvent<HTMLButtonElement>) => {
      event.preventDefault();
      const state = store.getState();
      state.setCollapsed(id, !state.collapsedIds.includes(id));
    },
    [id, store]
  );

  return { onCollapseClick, onControlMouseDown, onGutterClick, onGutterPlusClick };
}

export { useTextBlockGestures };
export type { UseTextBlockGesturesArgs };
