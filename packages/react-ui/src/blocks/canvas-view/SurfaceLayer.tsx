/** One surface's layer on the document canvas (the canvas view): its
 *  children (the canvas elements) under the surface's own block context —
 *  the connector endpoints resolve against this siblings list — plus the
 *  surface's connector overlay and the ports' dots. The context provider
 *  is not a DOM node, so several surfaces merge onto the same canvas in
 *  root order (the later surface paints on top: the DOM order is the
 *  z-order). */
import { useStore } from "zustand";

import type { ReactNode } from "react";

import type { BlockId } from "docblocks-core";

import { useEditorContext } from "../../EditorProvider";
import type { Box } from "../../canvas/viewport";
import type { MovePreview } from "../../canvas/viewport-state";
import { useBlock } from "../../hooks";
import { CanvasItem } from "../CanvasItem";
import { ConnectorLayer } from "../ConnectorLayer";
import { BlockContext, useBlockContextValue } from "../block-context";
import { effectiveGeometry, portsOf } from "../canvas-geometry";

function SurfaceLayer({
  id,
  children,
  pendingConnector,
  movePreview,
  resizePreview,
  endpointDrag,
  endpointPreview,
  showPorts,
  endpointSnap,
}: {
  id: BlockId;
  children: BlockId[];
  pendingConnector: string | null;
  movePreview: MovePreview | null;
  resizePreview: { id: string; box: Box } | null;
  endpointDrag: { connectorId: string; which: "start" | "end" } | null;
  endpointPreview: {
    point: { x: number; y: number };
    snap: { blockId: string; port: "north" | "east" | "south" | "west"; t: number } | null;
  } | null;
  /** The ports' visibility (the connector tool active or an endpoint drag in flight). */
  showPorts: boolean;
  /** The endpoint drag's live edge snap (the side + the fractional
   *  position — the continuous anchor,; the
   *  snapped dot stands the connect green at the anchor's point). */
  endpointSnap: { blockId: string; port: "north" | "east" | "south" | "west"; t: number } | null;
}) {
  const contextValue = useBlockContextValue(id, children, "surface");
  return (
    <BlockContext.Provider value={contextValue}>
      {children.map((childId) => (
        <CanvasItem
          key={childId}
          id={childId}
          pendingConnector={pendingConnector}
          movePreview={movePreview !== null && movePreview.ids.includes(childId) ? movePreview : null}
          resizeBox={resizePreview !== null && resizePreview.id === childId ? resizePreview.box : null}
        />
      ))}
      <ConnectorLayer
        id={id}
        endpointDrag={endpointDrag}
        endpointPreview={endpointPreview}
        movePreview={movePreview}
        resizePreview={resizePreview}
      />
      {showPorts && <PortDots id={id} snapped={endpointSnap} />}
    </BlockContext.Provider>
  );
}

/**
 * The four edge ports of every canvas item (the connector's snap
 * targets): the small circles at the edge midpoints. They stand only
 * while the connector tool is active or a connector's endpoint is being
 * dragged (the ports are the tools'
 * affordance, not the resting chrome). Pure view state: no data, no
 * awareness. The dots stand in the surface's center-anchor space (the
 * 1x1 overflow-visible svg, the ConnectorLayer's parity), pointer-events
 * none — the press passes through to the canvas (the snap reads the
 * port's coordinates, not a dot press). The SNAPPED dot (the endpoint
 * drag's live port snap) stands the connect green (the "the point is
 * connected" indicator, the badge's parity).
 */
function PortDots({
  id,
  snapped,
}: {
  id: BlockId;
  snapped: { blockId: string; port: "north" | "east" | "south" | "west"; t: number } | null;
}) {
  const { store } = useEditorContext();
  const blocks = useStore(store, (state) => state.blocks);
  const surface = useBlock(id);
  if (surface === undefined || surface.type !== "surface") return null;
  const dots: ReactNode[] = [];
  for (const childId of surface.children ?? []) {
    const block = blocks[childId];
    // The connector stands no ports of its own (its ends are the ports'
    // users; a line's box would stand phantom squares over its spans);
    // the group's box is DERIVED (the flat marker) — its default-size box
    // would stand phantom dots at the surface's center.
    if (block === undefined || block.type === "connector" || block.type === "group") continue;
    const box = effectiveGeometry(block);
    const ports = portsOf(box);
    for (const port of ["north", "east", "south", "west"] as const) {
      const p = ports[port];
      const isSnapped = snapped !== null && snapped.blockId === childId && snapped.port === port;
      dots.push(
        <circle
          key={`${childId}-${port}`}
          data-canvas-port={port}
          data-canvas-port-snapped={isSnapped || undefined}
          cx={p.x}
          cy={p.y}
          r={isSnapped ? 3.5 : 2.5}
          fill={
            isSnapped
              ? "var(--docblocks-canvas-connect-color, #16a34a)"
              : "var(--docblocks-canvas-surface-background, var(--card, #ffffff))"
          }
          strokeWidth={1}
          style={{
            stroke: isSnapped
              ? "var(--docblocks-canvas-connect-color, #16a34a)"
              : "var(--docblocks-canvas-selection-border-color)",
          }}
          pointerEvents="none"
        />
      );
    }
  }
  if (dots.length === 0) return null;
  return (
    <svg
      data-slot="docblocks/canvas-port-dots"
      data-block-id={id}
      className="pointer-events-none absolute top-1/2 left-1/2 overflow-visible"
      width={1}
      height={1}
    >
      {dots}
    </svg>
  );
}

export { SurfaceLayer };
