import { useEffect, useRef } from "react";
import type { KeyboardEvent, RefObject } from "react";

import { useEditorContext } from "../EditorProvider";
import { mapDomSelection, selectionsEqual } from "./selection-mapping";

interface EditingHandle {
  /** Attach to the editor root element. */
  rootRef: RefObject<HTMLDivElement | null>;
  /** The undo/redo hotkeys; attach to the editor root element. */
  onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void;
}

/**
 * Document-level wiring owned by the editor root: `selectionchange` maps
 * the DOM selection to the core Selection view, and the mod+z /
 * mod+shift+z / mod+y hotkeys drive doc.undo()/doc.redo() (the keydown
 * listener lives on the root, so they never fire outside the editor).
 *
 * The selection view is read at event time through the stable context
 * handle: the view becomes live when the provider's mount effect runs,
 * which is after this hook's effect subscribed (child effects run first),
 * so a render-time value would be a stale null.
 */
function useEditing(): EditingHandle {
  const { doc, selection: selectionRef } = useEditorContext();
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const onSelectionChange = () => {
      const root = rootRef.current;
      const view = selectionRef.view;
      if (root === null || view === null) return;
      const next = mapDomSelection(root, window.getSelection());
      // The view emits even on no-op sets — only push a real change.
      if (!selectionsEqual(next, view.get())) view.set(next);
    };
    document.addEventListener("selectionchange", onSelectionChange);
    return () => document.removeEventListener("selectionchange", onSelectionChange);
  }, [selectionRef]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
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

  return { rootRef, onKeyDown };
}

export { useEditing };
export type { EditingHandle };
