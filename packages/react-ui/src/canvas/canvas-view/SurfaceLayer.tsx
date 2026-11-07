/** One surface's layer on the document canvas (the canvas view): its
 *  children (the canvas elements) under the surface's own block context —
 *  the connector endpoints resolve against this siblings list. The Z-ORDER
 *  stand (the explicit zIndex): the children's DOM order IS the
 *  paint order — the connector's line stands inside its own wrapper (the
 *  CanvasItem's content), interleaved with the figures, not in a single
 *  overlay over everything. The surface's hidden arrowhead defs stand
 *  once (the per-line SVGs reference them by the url fragment), and the
 *  ports' dots stand the tool's chrome (always over the paint order). The
 *  context providers are not DOM nodes, so several surfaces merge onto the
 *  same canvas in root order (the later surface paints on top: the DOM
 *  order is the z-order). */
import { useStore } from "zustand";

import { type ReactNode, useMemo } from "react";

import type { BlockId } from "docblocks-core";

import type { Box, MovePreview } from "../../canvas";
import { useEditorContext } from "../../editor-provider";
import { useBlock } from "../../hooks";
import { BlockContext, useBlockContextValue } from "../../shared/providers/block-context";
import { CanvasItem } from "../CanvasItem";
import { ConnectorArrowDefs } from "../ConnectorArrowDefs";
import type { CanvasSession } from "../connector-session-context";
import { CanvasSessionContext } from "../connector-session-context";
import { effectiveGeometry, portsOf, surfaceChromeKey } from "../geometry";
import { SURFACE_BG } from "./constants";

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
  kbFocusId = null,
  inert = false,
  excludedIds,
  frameChain,
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
  /** The keyboard focus's item (the canvas view's arrow navigation). */
  kbFocusId?: string | null;
  /** The inert stand (the frame window's copy): the whole layer stands
   *  pointer-transparent (the copies' stand is the render only — the
   *  interaction stands on the originals) and the ports' dots stand off.
   *  The layer's content stand at the world's origin (the zero-size box
   *  anchor — the caller's window's offset places the origin). */
  inert?: boolean;
  /** The children the layer does not render (the frame chain's cycle
   *  guard — the chain's frames + the window's own frame). The siblings'
   *  context keeps them (the endpoint's resolution stands the full list). */
  excludedIds?: readonly BlockId[];
  /** The frames this layer renders inside of (the window's cycle guard —
   *  the frame's renderer carries the chain's stand over its window). */
  frameChain?: ReadonlySet<BlockId>;
}) {
  const contextValue = useBlockContextValue(id, children, "surface");
  // The session's referential identity stands on the four inputs (a
  // pointermove over an idle canvas stands no context churn — the
  // per-line render reads it, the figures don't consume it).
  const session = useMemo<CanvasSession>(
    () => ({ movePreview, resizePreview, endpointDrag, endpointPreview }),
    [movePreview, resizePreview, endpointDrag, endpointPreview]
  );
  // The layer's rendered children (the excluded's stand off — the window's
  // cycle guard); the siblings' context keeps the full list (the endpoint
  // resolution's stand).
  const rendered = excludedIds !== undefined ? children.filter((childId) => !excludedIds.includes(childId)) : children;
  const content = (
    <>
      <ConnectorArrowDefs id={id} />
      {rendered.map((childId) => (
        <CanvasItem
          key={childId}
          id={childId}
          pendingConnector={pendingConnector}
          movePreview={movePreview !== null && movePreview.ids.includes(childId) ? movePreview : null}
          resizeBox={resizePreview !== null && resizePreview.id === childId ? resizePreview.box : null}
          kbFocused={kbFocusId === childId}
          frameChain={frameChain}
        />
      ))}
      {showPorts && <PortDots id={id} snapped={endpointSnap} />}
    </>
  );
  if (inert) {
    // The inert stand (the frame window's copy): the zero-size anchor (the
    // world's origin — the caller's window's offset places it) + the whole
    // layer's pointer-transparent (the copies never stand the press); the
    // ports' dots stand off (the tool's chrome is not the copy's stand).
    return (
      <BlockContext.Provider value={contextValue}>
        <CanvasSessionContext.Provider value={session}>
          <div className="pointer-events-none relative" style={{ width: 0, height: 0 }}>
            {content}</div>
        </CanvasSessionContext.Provider>
      </BlockContext.Provider>
    );
  }
  return (
    <BlockContext.Provider value={contextValue}>
      <CanvasSessionContext.Provider value={session}>{content}</CanvasSessionContext.Provider>
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
  const surface = useBlock(id);
  // The dots' boxes stand over the children's geometry: the chrome digest
  // keys the dots memo (a text-only change stands no dots re-render).
  const chromeKey = useStore(store, (state) =>
    surfaceChromeKey(state.blocks, surface !== undefined && "children" in surface ? (surface.children ?? []) : [])
  );
  const dots: ReactNode[] = useMemo(() => {
    if (surface === undefined || surface.type !== "surface") return [];
    const blocks = store.getState().blocks;
    const next: ReactNode[] = [];
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
        next.push(
          <circle
            key={`${childId}-${port}`}
            data-canvas-port={port}
            data-canvas-port-snapped={isSnapped || undefined}
            cx={p.x}
            cy={p.y}
            r={isSnapped ? 3.5 : 2.5}
            fill={isSnapped ? "var(--docblocks-canvas-connect-color, #16a34a)" : SURFACE_BG}
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
    return next;
  }, [chromeKey, snapped, store, surface]);
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
