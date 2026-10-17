import { useEffect, useRef } from "react";
import type { ClipboardEvent, KeyboardEvent, PointerEvent, RefObject } from "react";

import { useEditorContext } from "../EditorProvider";
import { entrySequenceParent } from "../blocks/flat";
import { removeBlocksSelection } from "./block-commands";
import { crossRangeClipboardContent } from "./cross-copy";
import { useCrossDrag } from "./cross-drag";
import { mapDomSelection, selectionsEqual } from "./selection-mapping";

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

/**
 * Document-level wiring owned by the editor root: `selectionchange` maps
 * the DOM selection to the core Selection view, the mod+z / mod+shift+z /
 * mod+y hotkeys drive doc.undo()/doc.redo(), and the copy event carries
 * the cross-range payload (the keydown and copy listeners live on the
 * root, so they never fire outside the editor).
 *
 * The selection view is read at event time through the stable context
 * handle: the view becomes live when the provider's mount effect runs,
 * which is after this hook's effect subscribed (child effects run first),
 * so a render-time value would be a stale null.
 */
function useEditing(): EditingHandle {
  const { doc, rootBlockId, selection: selectionRef } = useEditorContext();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const crossDrag = useCrossDrag(rootRef, doc);

  useEffect(() => {
    const onSelectionChange = () => {
      const root = rootRef.current;
      const view = selectionRef.view;
      if (root === null || view === null) return;
      const next = mapDomSelection(root, window.getSelection(), doc);
      // The view emits even on no-op sets — only push a real change.
      if (!selectionsEqual(next, view.get())) view.set(next);
    };
    document.addEventListener("selectionchange", onSelectionChange);
    return () => document.removeEventListener("selectionchange", onSelectionChange);
  }, [doc, selectionRef]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    // Keys typed inside a nested editor (a sync-embed) bubble up to this
    // root; that editor's own hotkeys handle them, so this root must not
    // double-fire undo/redo.
    const root = rootRef.current;
    const target = event.target instanceof Element ? event.target : null;
    const nearest = target?.closest('[data-slot="docblocks/editor"]') ?? null;
    if (root !== null && nearest !== null && nearest !== root) return;
    const view = selectionRef.view;
    if (view !== null) {
      const selection = view.get();
      if (selection.kind === "blocks") {
        // The blocks (gutter) selection's keys on a row no per-block
        // handler owns (the non-text rows: the row wrapper is focused and
        // its keydown bubbles here). A text row's own wrapper handles the
        // same keys earlier on the event path and resets the view to
        // none, so there is no double fire.
        if (event.key === "Delete" || event.key === "Backspace") {
          event.preventDefault();
          removeBlocksSelection(doc, entrySequenceParent(doc, rootBlockId), selection.ids);
          view.set({ kind: "none" });
          // The deleted rows unmount and the browser would drop the focus to
          // the document: park it on the editor root (the undo hotkey reach).
          root?.focus();
          return;
        }
        if (event.key === "Escape") {
          event.preventDefault();
          view.set({ kind: "none" });
          return;
        }
      }
    }
    const mod = event.metaKey || event.ctrlKey;
    if (!mod) return;
    const key = event.key.toLowerCase();
    if (key === "z" && !event.shiftKey) {
      event.preventDefault();
      doc.undo();
    } else if ((key === "z" && event.shiftKey) || key === "y") {
      event.preventDefault();
      doc.redo();
    }
  };

  const onCopy = (event: ClipboardEvent<HTMLDivElement>) => {
    // A copy from a nested editor (a sync-embed) bubbles up to this root;
    // that editor's own copy handler owns its payload.
    const root = rootRef.current;
    const view = selectionRef.view;
    if (root === null || view === null) return;
    const target = event.target instanceof Element ? event.target : null;
    const nearest = target?.closest('[data-slot="docblocks/editor"]') ?? null;
    if (nearest !== null && nearest !== root) return;
    // The browser cannot copy a selection across a contenteditable
    // boundary: a cross-block range is serialized from the doc (the
    // covered segment of each chain block); same-block copies keep the
    // default copy.
    const selection = view.get();
    const payload = crossRangeClipboardContent(doc, selection);
    if (payload === null) return;
    event.preventDefault();
    event.clipboardData.setData("text/plain", payload.text);
    event.clipboardData.setData("text/html", payload.html);
  };

  return { rootRef, onKeyDown, onCopy, ...crossDrag };
}

export { useEditing };
export type { EditingHandle };
