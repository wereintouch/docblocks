import { useStore } from "zustand";

import { useMemo } from "react";

import { useEditorContext } from "./EditorProvider";
import { BlockGroups } from "./blocks/BlockView";
import { BlockContext } from "./blocks/block-context";
import { useEditing } from "./editing/useEditing";
import { PresenceCaretOverlay } from "./presence/presence-caret";

/**
 * Renders the document's entry list in reading order (the document root's
 * children, or a single subtree block when the provider got a
 * `rootBlockId`). The root is the editor's focus/keyboard scope: the
 * undo/redo hotkeys only fire for keys targeted inside it. The root block
 * context (the entry root and its children) is provided for every entry.
 */
function Editor() {
  const { store, rootBlockId } = useEditorContext();
  const rootChildren = useStore(store, (state) => state.rootChildren);
  const rootContext = useMemo(() => ({ parentId: rootBlockId, siblings: rootChildren }), [rootBlockId, rootChildren]);
  const { rootRef, onKeyDown } = useEditing();

  return (
    <div ref={rootRef} data-slot="docblocks/editor" tabIndex={-1} onKeyDown={onKeyDown}>
      <BlockContext.Provider value={rootContext}>
        <BlockGroups ids={rootChildren} />
      </BlockContext.Provider>
      <PresenceCaretOverlay rootRef={rootRef} />
    </div>
  );
}

export { Editor };
