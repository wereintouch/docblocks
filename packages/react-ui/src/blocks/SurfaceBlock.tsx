import type { BlockId, SurfaceBlock as SurfaceBlockType } from "docblocks-core";

import { CanvasItem } from "./CanvasItem";
import { ConnectorArrowDefs } from "./ConnectorArrowDefs";
import { BlockContext, useBlockContextValue } from "./block-context";
import { ConnectorLabelChips } from "./canvas-view/ConnectorLabelChips";

const EMPTY_IDS: BlockId[] = [];

/**
 * A surface (the canvas container): the canvas elements in the children
 * order — the order IS the z-order (the explicit zIndex: the
 * dense indices stand the paint order, the legacy shape's children
 * position is the lenient fallback). The connector's line stands inside
 * its own wrapper (the interleaved paint order) with the hit path inert
 * (the page view is not selectable). The container is a relative viewport
 * (the height, border, and background tokens; it clips its elements — the
 * canvas is a viewport, pan/zoom is the interaction stage). The surface
 * provides the block context (the children are the elements) for the
 * canvas-text gestures and the page-block children.
 */
function SurfaceBlock({ id, block }: { id: BlockId; block: SurfaceBlockType }) {
  const children = block.children ?? EMPTY_IDS;
  const contextValue = useBlockContextValue(id, children, "surface");
  return (
    <div
      data-slot="docblocks/block"
      data-block-type="surface"
      data-block-id={id}
      className="relative my-(--docblocks-block-spacing) outline-none"
    >
      <div
        data-slot="docblocks/canvas"
        className="relative h-(--docblocks-canvas-height) overflow-hidden rounded-(--docblocks-radius) border-(length:--docblocks-table-border-width) border-(--docblocks-table-border-color) bg-(--docblocks-canvas-background)"
      >
        <BlockContext.Provider value={contextValue}>
          <ConnectorArrowDefs id={id} />
          {children.map((childId) => (
            <CanvasItem key={childId} id={childId} interactive={false} />
          ))}
          {/* The connector label chips (the display stand — the page view's
              inert surface keeps the label). */}
          <ConnectorLabelChips children={children} />
        </BlockContext.Provider>
      </div>
    </div>
  );
}

export { SurfaceBlock };
