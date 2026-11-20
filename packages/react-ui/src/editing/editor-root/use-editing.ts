/**
 * Document-level wiring owned by the editor root: `selectionchange` maps
 * the DOM selection to the core Selection view (`selection-tracking`), the
 * mod+z / mod+shift+z / mod+y hotkeys drive doc.undo()/doc.redo()
 * (`history-reseat`), the document-zone keys (select-all, ctrl+home/end)
 * and the blocks selection's keys stand in their own units, the copy event
 * carries the selection's payload (`copy-handler`), and the mouse drag's
 * cross selection runs the `cross-drag` session. The keydown and copy
 * listeners live on the root, so they never fire outside the editor.
 *
 * The selection view is read at event time through the stable context
 * handle: the view becomes live when the provider's mount effect runs,
 * which is after this hook's effect subscribed (child effects run first),
 * so a render-time value would be a stale null.
 */
import { useCallback, useRef } from "react";
import type { ClipboardEvent, KeyboardEvent, PointerEvent, RefObject } from "react";

import { useEditorContext } from "../../editor-provider";
import { useCrossDrag } from "../cross-drag";
import { handleBlocksSelectionKeys } from "./blocks-keys";
import { createCopyHandler } from "./copy-handler";
import { handleDocumentEdge, handleSelectAll } from "./document-keys";
import { RESEAT_WINDOW_MS, scheduleHistoryReseat } from "./history-reseat";
import { useSelectionTracking } from "./selection-tracking";

interface EditingHandle {
  /** Attach to the editor root element. */
  rootRef: RefObject<HTMLDivElement | null>;
  /** The undo/redo hotkeys; attach to the editor root element. */
  onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void;
  /** The cross-range copy payload; attach to the editor root element. */
  onCopy: (event: ClipboardEvent<HTMLDivElement>) => void;
  /** The cross-drag selection session; attach the pointerdown to the editor root element. */
  onPointerDown: (event: PointerEvent<HTMLDivElement>) => void;
}

function useEditing(): EditingHandle {
  const { doc, rootBlockId, selection: selectionRef, viewMode, mode } = useEditorContext();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const crossDrag = useCrossDrag(rootRef, doc, viewMode);

  useSelectionTracking(doc, rootRef, selectionRef, viewMode);

  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      // Keys typed inside a nested editor (a sync-embed) bubble up to this
      // root; that editor's own hotkeys handle them, so this root must not
      // double-fire undo/redo.
      const root = rootRef.current;
      const target = event.target instanceof Element ? event.target : null;
      const nearest = target?.closest('[data-slot="docblocks/editor"]') ?? null;
      if (root !== null && nearest !== null && nearest !== root) return;
      // A key from a portaled form control (the shape toolbar's hex input
      // stands in the document body): the DOM path never crosses the root,
      // and the control owns its own keys (a Backspace in the input must
      // not delete the blocks selection). A dropped focus (the target
      // body/document) is NOT a form control — the undo hotkey must still
      // reach the doc from there (the focus-parking contract).
      const formControl = target?.closest("input, textarea, [contenteditable='true']") ?? null;
      if (root !== null && target !== null && formControl !== null && !root.contains(target)) return;
      if (root !== null) {
        const documentScope = { doc, rootBlockId, root, target };
        if (handleSelectAll(event, documentScope)) return;
        if (handleDocumentEdge(event, documentScope)) return;
      }
      // The read-only stand (view / published): the hotkeys stand no stand
      // (the undo/redo's path and the blocks selection's delete are
      // editing's paths).
      if (viewMode) return;
      const view = selectionRef.view;
      if (view !== null && handleBlocksSelectionKeys(event, { doc, rootBlockId, root, view })) return;
      const mod = event.metaKey || event.ctrlKey;
      if (!mod) return;
      const key = event.key.toLowerCase();
      if (key === "z" && !event.shiftKey) {
        event.preventDefault();
        doc.undo();
        // The inverse step may remount the restored selection's block (a
        // type change): the remount takes the DOM caret and focus with the
        // old element, so the restored selection re-seats the DOM. The
        // reseat's window stands the remount's transient selection loss
        // (the mapping's none's suppression — the inverse's next snapshot
        // then reads the restored state, not the residue).
        selectionRef.reseatUntil.current = Date.now() + RESEAT_WINDOW_MS;
        scheduleHistoryReseat(doc, view, root);
      } else if ((key === "z" && event.shiftKey) || key === "y") {
        event.preventDefault();
        doc.redo();
        // The redo's step is the same remount case in the other direction
        // (the forward type change takes the old element out from under
        // the seat).
        selectionRef.reseatUntil.current = Date.now() + RESEAT_WINDOW_MS;
        scheduleHistoryReseat(doc, view, root);
      }
    },
    [doc, rootBlockId, selectionRef, viewMode]
  );

  const onCopy = createCopyHandler({ doc, mode, viewMode, rootRef, selectionRef });

  return {
    rootRef,
    onKeyDown,
    onCopy,
    // The read-only stand (view / published): the cross-drag's session is
    // off (the selection's gesture is an editing's path).
    onPointerDown: (event: PointerEvent<HTMLDivElement>) => {
      if (viewMode) return;
      crossDrag.onPointerDown(event);
    },
  };
}

export { useEditing };
