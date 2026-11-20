/** The canvas's world-space overlays: the in-flight previews painted
 * inside the world div (the pan / zoom's transform applies — the previews
 * scale with the zoom, like the content): the drag-to-size placement
 * preview (the shape's figure at the dragged box, the dashed cyan line),
 * the connector's pending preview line + the snap badges (the pending's
 * snap, the hover's stand before the press), the pen's in-flight stroke,
 * and the ghost text block (the double-click's empty-canvas entry). The
 * screen-space chrome (the marquee, the handles, the toolbars, the dock)
 * stands over the world — CanvasScreenChrome. */
import { ShapeSvg } from "../ShapeSvg";
import type { CanvasPort } from "../geometry";
import type { CanvasViewportState } from "../viewport";
import { CanvasTextGhost } from "./CanvasTextGhost";
import { ConnectorPreviewLine } from "./ConnectorPreviewLine";
import { ConnectorSnapBadge } from "./ConnectorSnapBadge";

type Point = { x: number; y: number };

function CanvasOverlays({
  viewport,
  previewFrom,
  previewEnd,
  previewSnap,
  hoverSnapPoint,
}: {
  viewport: CanvasViewportState;
  previewFrom: Point | null;
  previewEnd: Point | null;
  previewSnap: { port: CanvasPort } | null;
  hoverSnapPoint: Point | null;
}) {
  return (
    <>
      {viewport.placePreview !== null && (
        // The drag-to-size placement preview (the shape's figure at the
        // dragged box, the dashed cyan line; the world's space, so it
        // scales with the zoom).
        <div
          data-slot="docblocks/canvas-place-preview"
          className="pointer-events-none absolute"
          style={{
            left: `calc(50% + ${viewport.placePreview.x}px)`,
            top: `calc(50% + ${viewport.placePreview.y}px)`,
            width: `${viewport.placePreview.w}px`,
            height: `${viewport.placePreview.h}px`,
            transform: "translate(-50%, -50%)",
            color: "var(--docblocks-canvas-selection-border-color)",
            opacity: 0.6,
          }}
        >
          {viewport.placePreview.kind === "container" ? (
            <div className="h-full w-full rounded-(--docblocks-radius) border-2 border-dashed border-current" />
          ) : (
            <ShapeSvg
              id="docblocks-place-preview"
              block={{
                type: "shape",
                attrs: { variant: viewport.placePreview.variant, stroke: "currentColor", strokeStyle: "dash" },
                geometry: {
                  x: 0,
                  y: 0,
                  w: viewport.placePreview.w,
                  h: viewport.placePreview.h,
                },
              }}
            />
          )}
        </div>
      )}
      {(viewport.pendingConnector !== null || viewport.pendingFree !== null) &&
        previewFrom !== null &&
        previewEnd !== null && (
          // The connector's pending preview line: the dashed segment
          // from the pending stand (the snapped press point, or the
          // auto anchor over the plain block ref) to the cursor's snap
          // (the endpoint drag's parity) (the world's space, so it
          // scales with the zoom).
          <ConnectorPreviewLine id={viewport.pendingConnector ?? undefined} from={previewFrom} point={previewEnd} />
        )}
      {previewFrom !== null && previewEnd !== null && previewSnap !== null && (
        // The preview end's snap: the circle + the connect badge at
        // the snapped edge point (the endpoint drag's parity).
        <ConnectorSnapBadge slot="docblocks/canvas-connector-preview-snap" point={previewEnd} port={previewSnap.port} />
      )}
      {viewport.activeTool === "connector" &&
        previewFrom === null &&
        viewport.connectorHoverSnap !== null &&
        hoverSnapPoint !== null && (
          // The hover snap (before the stand): the circle + the connect
          // badge at the snapped edge point — the press's stand
          // preview (the line stands from that point on the press).
          <ConnectorSnapBadge
            slot="docblocks/canvas-connector-hover-snap"
            point={hoverSnapPoint}
            port={viewport.connectorHoverSnap.port}
          />
        )}
      {viewport.penPoints.length > 1 && (
        <svg
          data-slot="docblocks/canvas-pen-preview"
          className="pointer-events-none absolute top-1/2 left-1/2 overflow-visible"
          width={1}
          height={1}
        >
          <path
            d={viewport.penPoints.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`).join(" ")}
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )}
      {viewport.pendingText !== null && (
        // The ghost text block (the double-click's empty-canvas entry):
        // the world's space, so it scales with the zoom — over the
        // world's content (the surfaces), under the screen-space
        // toolbars (the DOM order's paint stand).
        <CanvasTextGhost
          point={viewport.pendingText}
          onClose={() => viewport.setPendingText(null)}
          onEdit={(id) => viewport.setCanvasTextEditing(id)}
        />
      )}
    </>
  );
}

export { CanvasOverlays };
