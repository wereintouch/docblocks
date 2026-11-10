/**
 * The frame's window's content: the inert clipped copy of the surface's
 * layer — the surface's children (the `excludedIds` stand out: the
 * frame-chain's cycle guard) + the connector's label chips, the whole
 * layer pointer-transparent (the interaction stands on the originals
 * outside the window — the copies' stand is the render only). The content
 * stands at the window's offset (the surface's world origin (0,0) at the
 * caller's box-local point — the frameWindowOffset's stand over the
 * effective geometry), so the copy stands over the world's parity and the
 * box's slide over the preview is the window's pan (the content re-stands
 * its world coordinates). The session's props stand the committed stand
 * (null/false — the window's copy stands the still content, not the
 * in-flight previews).
 */
import type { BlockId } from "docblocks-core";

import { useBlock } from "../hooks";
import { cn } from "../shared/ui/cn";
import { ConnectorLabelChips } from "./canvas-view/ConnectorLabelChips";
import { SurfaceLayer } from "./canvas-view/SurfaceLayer";

const EMPTY_IDS: BlockId[] = [];

function FrameWindowContent({
  surfaceId,
  offset,
  excludedIds = EMPTY_IDS,
  className,
}: {
  /** The surface whose children stand the window's content. */
  surfaceId: BlockId;
  /** The box-local position of the surface's world origin (0,0). */
  offset: { left: number; top: number };
  /** The children the window's content excludes (the window's own frame —
   *  the reference stands out of its own window). */
  excludedIds?: readonly BlockId[];
  className?: string;
}) {
  const surface = useBlock(surfaceId);
  const children = surface !== undefined && surface.type === "surface" ? (surface.children ?? EMPTY_IDS) : EMPTY_IDS;
  return (
    <div data-slot="docblocks/frame-window-content" className={cn("pointer-events-none absolute inset-0", className)}>
      <div className="absolute" style={{ left: offset.left, top: offset.top, width: 0, height: 0 }}>
        <SurfaceLayer
          id={surfaceId}
          children={children}
          pendingConnector={null}
          movePreview={null}
          resizePreview={null}
          endpointDrag={null}
          endpointPreview={null}
          showPorts={false}
          endpointSnap={null}
          kbFocusId={null}
          inert
          excludedIds={excludedIds}
        />
        <ConnectorLabelChips children={children} />
      </div>
    </div>
  );
}

export { FrameWindowContent };
