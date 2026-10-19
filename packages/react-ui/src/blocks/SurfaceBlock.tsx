import type { BlockId, SurfaceBlock as SurfaceBlockType } from "docblocks-core";

import { CanvasItem } from "./CanvasItem";
import { ConnectorLayer } from "./ConnectorLayer";
import { BlockContext, useBlockContextValue } from "./block-context";

const EMPTY_IDS: BlockId[] = [];

/**
 * A surface (the canvas container): the canvas elements in the children
 * order — the order IS the z-order (no z-index: the DOM order is the
 * paint order, a moveBlock within the children is a z-order change).
 * The container is a relative viewport (the height, border, and
 * background tokens; it clips its elements — the canvas is a viewport,
 * pan/zoom is the interaction stage). The surface provides the block
 * context (the children are the elements) for the canvas-text gestures
 * and the page-block children.
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
        className="
          relative h-(--docblocks-canvas-height) overflow-hidden rounded-(--docblocks-radius)
          border-(length:--docblocks-table-border-width) border-(--docblocks-table-border-color)
          bg-(--docblocks-canvas-background)
        "
      >
        <BlockContext.Provider value={contextValue}>
          {children.map((childId) => (
            <CanvasItem key={childId} id={childId} />
          ))}
          <ConnectorLayer
            id={id}
            interactive={false}
            endpointDrag={null}
            endpointPreview={null}
            onEndpointDrag={() => {
              /* The page view's embedded surface stands the overlay inert. */
            }}
            movePreview={null}
            resizePreview={null}
          />
        </BlockContext.Provider>
      </div>
    </div>
  );
}

export { SurfaceBlock };
