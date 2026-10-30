import type { BlockId } from "docblocks-core";

import { Editor } from "../Editor";
import { EditorProvider, useEditorContext } from "../editor-provider";
import { useBlock } from "../hooks";
import { BlockGroups } from "./BlockView";
import { BlockContext, useBlockContextValue } from "./block-context";

const EMPTY_IDS: BlockId[] = [];

/**
 * The frame's content, rendered by the frame's OWN nested provider (the
 * provider's entry root IS the frame — its renderer carries the
 * descendants, like a list item's nested children): the frame's children
 * with the frame's block context.
 */
function FrameContent({ id }: { id: BlockId }) {
  const block = useBlock(id);
  if (block === undefined || block.type !== "frame") return null;
  const children = block.children ?? EMPTY_IDS;
  const contextValue = useBlockContextValue(id, children, "frame");
  return (
    <BlockContext.Provider value={contextValue}>
      <BlockGroups ids={children} />
    </BlockContext.Provider>
  );
}

/**
 * A canvas frame: a positioned box (the border tokens) whose content is
 * the nested PAGE blocks — a fresh nested EditorProvider on the SAME doc
 * with the frame as the entry root (the sync-embed subtree machinery):
 * the frame's children are editable in place, their selection/undo scoped
 * to this provider (a document hosts several independent selection
 * views). The provider inherits the enclosing renderers / resolvers.
 * The frame does not clip in v1 (overflow visible).
 */
function FrameBlock({ id }: { id: BlockId }) {
  const { doc, rootBlockId } = useEditorContext();
  if (rootBlockId === id) {
    // This provider's entry root is the frame itself: render the content
    // (the box and the nested provider are the surface-side concern).
    return <FrameContent id={id} />;
  }
  return (
    <div
      data-slot="docblocks/frame"
      data-block-id={id}
      className="box-border h-full w-full rounded-(--docblocks-radius) border-(length:--docblocks-table-border-width) border-(--docblocks-table-border-color) bg-(--docblocks-frame-background)"
    >
      <EditorProvider key={id} doc={doc} rootBlockId={id}>
        <Editor />
      </EditorProvider>
    </div>
  );
}

export { FrameBlock };
