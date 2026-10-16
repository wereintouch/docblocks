import { useStore } from "zustand";

import { useMemo } from "react";

import type { BlockId } from "docblocks-core";

import { useEditorContext } from "../EditorProvider";
import { useBlock } from "../hooks";
import { ScrollArea } from "../shared/ui/ScrollArea";
import { BlockGroups } from "./BlockView";
import { CanvasItem } from "./CanvasItem";
import { ConnectorLayer } from "./ConnectorLayer";
import { BlockContext, useBlockContextValue } from "./block-context";
import { pageCardStyle } from "./canvas-geometry";

/**
 * One surface's layer on the document canvas (the canvas view): its
 * children (the canvas elements) under the surface's own block context —
 * the connector endpoints resolve against this siblings list — plus the
 * surface's connector overlay. The context provider is not a DOM node, so
 * several surfaces merge onto the same canvas in root order (the later
 * surface paints on top: the DOM order is the z-order).
 */
function SurfaceLayer({ id, children }: { id: BlockId; children: BlockId[] }) {
  const contextValue = useBlockContextValue(id, children);
  return (
    <BlockContext.Provider value={contextValue}>
      {children.map((childId) => (
        <CanvasItem key={childId} id={childId} />
      ))}
      <ConnectorLayer id={id} />
    </BlockContext.Provider>
  );
}

/**
 * The document's canvas view (the `view === "canvas"` mode): the document's
 * page rendered as a page miniature — a positioned vertical rectangle of
 * page proportions holding the root's page children (the non-surface
 * children, in reading order) — at the root's geometry (the center anchor;
 * the default is the canvas center with the default page size), and every
 * root-level surface's elements on the same canvas (the shared origin is
 * the canvas center). The surface container itself has no canvas box here:
 * the canvas view IS the surface. Switching views writes nothing to the
 * data (the view is view state, like the selection).
 */
function CanvasView() {
  const { store, rootBlockId } = useEditorContext();
  const rootChildren = useStore(store, (state) => state.rootChildren);
  const blocks = useStore(store, (state) => state.blocks);
  const root = useBlock(rootBlockId);

  // Split the root's children into the page (the non-surface blocks, in
  // reading order) and the surfaces (each rendered as its own layer).
  const { pageChildren, surfaces } = useMemo(() => {
    const page: BlockId[] = [];
    const list: { id: BlockId; children: BlockId[] }[] = [];
    for (const id of rootChildren) {
      const block = blocks[id];
      if (block === undefined) continue;
      if (block.type === "surface") {
        list.push({ id, children: block.children ?? [] });
      } else {
        page.push(id);
      }
    }
    return { pageChildren: page, surfaces: list };
  }, [rootChildren, blocks]);

  const pageContext = useBlockContextValue(rootBlockId, pageChildren);

  if (root === undefined) return null;

  return (
    <div
      data-slot="docblocks/canvas-view"
      className="
        relative h-(--docblocks-canvas-view-height) overflow-hidden bg-(--docblocks-canvas-background)
        bg-[radial-gradient(circle,var(--docblocks-canvas-view-dot)_1px,transparent_1px)]
        bg-size-[var(--docblocks-canvas-view-grid)_var(--docblocks-canvas-view-grid)]
      "
    >
      <ScrollArea
        data-slot="docblocks/page-card"
        style={pageCardStyle(root)}
        className="
          box-border rounded-(--docblocks-radius) bg-(--docblocks-page-card-background)
          p-(--docblocks-page-card-padding) shadow-(--docblocks-page-card-shadow)
        "
      >
        <BlockContext.Provider value={pageContext}>
          <BlockGroups ids={pageChildren} />
        </BlockContext.Provider>
      </ScrollArea>
      {surfaces.map(({ id, children }) => (
        <SurfaceLayer key={id} id={id} children={children} />
      ))}
    </div>
  );
}

export { CanvasView };
