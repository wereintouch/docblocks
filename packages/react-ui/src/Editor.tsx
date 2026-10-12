import { useStore } from "zustand";

import { useMemo } from "react";

import { useEditorContext } from "./EditorProvider";
import { BlockGroups } from "./blocks/BlockView";
import { CanvasView } from "./blocks/CanvasView";
import { BlockContext } from "./blocks/block-context";
import { SlashMenuContext, useSlashMenu } from "./editing/slash";
import { useEditing } from "./editing/useEditing";
import { PresenceCaretOverlay } from "./presence/presence-caret";

/**
 * The document's view mode: the page flow (the root's children in reading
 * order) or the canvas (the page as a miniature rectangle plus the surface
 * elements on one canvas). View state — switching writes nothing to the
 * data (like the selection).
 */
type EditorView = "page" | "canvas";

/**
 * Renders the document's entry list in reading order (the document root's
 * children, or a single subtree block when the provider got a
 * `rootBlockId`). The root is the editor's focus/keyboard scope: the
 * undo/redo hotkeys only fire for keys targeted inside it. The root block
 * context (the entry root and its children) is provided for every entry.
 *
 * The `view` prop selects the rendering: "page" (default) is the entry
 * list; "canvas" renders the document's page as a page miniature and the
 * root-level surfaces' elements on one canvas (see CanvasView).
 */
function Editor({ view = "page" }: { view?: EditorView }) {
  const { store, rootBlockId } = useEditorContext();
  const rootChildren = useStore(store, (state) => state.rootChildren);
  const rootContext = useMemo(() => ({ parentId: rootBlockId, siblings: rootChildren }), [rootBlockId, rootChildren]);
  const { rootRef, onKeyDown } = useEditing();
  const slash = useSlashMenu(rootRef);

  return (
    <div ref={rootRef} data-slot="docblocks/editor" data-view={view} tabIndex={-1} onKeyDown={onKeyDown}>
      <SlashMenuContext.Provider value={slash.api}>
        <BlockContext.Provider value={rootContext}>
          {view === "canvas" ? <CanvasView /> : <BlockGroups ids={rootChildren} />}
        </BlockContext.Provider>
      </SlashMenuContext.Provider>
      <PresenceCaretOverlay rootRef={rootRef} />
      {slash.menuNode}
    </div>
  );
}

export { Editor };
export type { EditorView };
