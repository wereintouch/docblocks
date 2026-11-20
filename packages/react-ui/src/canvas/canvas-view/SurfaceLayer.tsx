/** One surface's layer on the document canvas (the canvas view): its
 *  children (the canvas elements) under the surface's own block context —
 *  the connector endpoints resolve against this siblings list. The Z-ORDER
 *  stand (the explicit zIndex): the children's DOM order IS the
 *  paint order — the connector's line stands inside its own wrapper (the
 *  CanvasItem's content), interleaved with the figures, not in a single
 *  overlay over everything. The surface's hidden arrowhead defs stand
 *  once (the per-line SVGs reference them by the url fragment), and the
 *  ports' dots stand the tool's chrome (always over the paint order). The
 *  context providers are not DOM nodes, so several surfaces merge onto
 *  the same canvas in root order (the later surface paints on top: the
 *  DOM order is the z-order).
 *
 *  The re-render contract (the big-canvas performance stand): the layer
 *  renders its children over the STABLE props only (the children list,
 *  the pending stand) — the in-flight session's previews are NOT props.
 *  The CanvasItems and the ConnectorLines subscribe to the viewport's
 *  store's narrow slices themselves (the per-item / per-line preview
 *  stand), so a pointermove over the drag re-renders the moved items and
 *  the touched lines only — the layer (and its resting children) stands
 *  their memo.
 *
 *  The culling's keep set (`visibleIds`) thins the RENDERED wrappers only:
 *  the siblings' context stands the surface's FULL children list — the
 *  connector's endpoint resolution must not depend on the viewport (the
 *  off-viewport endpoint's line stands drawn over its visible spans). */
import { useStore } from "zustand";

import { type ReactNode, useMemo } from "react";

import type { BlockId } from "docblocks-core";

import { useEditorContext } from "../../editor-provider";
import { useBlock } from "../../hooks";
import { BlockContext, useBlockContextValue } from "../../shared/providers/block-context";
import { CanvasItem } from "../CanvasItem";
import { ConnectorArrowDefs } from "../ConnectorArrowDefs";
import { effectiveGeometry, portsOf } from "../geometry";
import { CanvasViewportStoreContext, EMPTY_VIEWPORT_STORE, usePortSnap, useShowPorts } from "../viewport";
import { SURFACE_BG } from "./constants";

function SurfaceLayer({
  id,
  children,
  pendingConnector,
  inert = false,
  excludedIds,
  visibleIds,
}: {
  id: BlockId;
  /** The surface's full children — the siblings' context's list (the
   *  connector's endpoint's resolution's stand). */
  children: BlockId[];
  pendingConnector: string | null;
  /** The inert stand (the frame window's copy): the whole layer stands
   *  pointer-transparent (the copies' stand is the render only — the
   *  interaction stands on the originals) and the ports' dots stand off.
   *  The layer's content stand at the world's origin (the zero-size box
   *  anchor — the caller's window's offset places the origin). */
  inert?: boolean;
  /** The children the layer does not render (the frame window's excluded's
   *  stand — the referenced frame stands out of its own page window). The
   *  siblings' context keeps them (the endpoint's resolution stands the
   *  full list). */
  excludedIds?: readonly BlockId[];
  /** The culling's keep set (the viewport's stand): the children out of
   *  it stand no DOM of their own. The siblings' context keeps the full
   *  list (the culling is the render's stand, not the structure's stand —
   *  the line's endpoint's resolution stands the off-viewport blocks
   *  over the committed geometry). `null` = no cull. */
  visibleIds?: Set<BlockId> | null;
}) {
  const contextValue = useBlockContextValue(id, children, "surface");
  // The layer's rendered children: the culling's keep set's stand off (the
  // off-viewport items' DOM's stand), then the excluded's stand off (the
  // window's cycle guard). The siblings' context keeps the full list over
  // every stand (the endpoint's resolution's stand — the culling must not
  // thin it: the line's drop over the off-viewport endpoint's regression).
  // The DOM order is the children's order (the explicit zIndex's mirror —
  // the paint order over every canvas type, the frame included: the frame
  // stands a first-class z-order element).
  const rendered = useMemo(() => {
    const kept =
      visibleIds !== null && visibleIds !== undefined
        ? children.filter((childId) => visibleIds.has(childId))
        : children;
    return excludedIds !== undefined ? kept.filter((childId) => !excludedIds.includes(childId)) : kept;
  }, [children, visibleIds, excludedIds]);
  // The ports' visibility (the connector's tool / the endpoint's drag):
  // the point boolean — the layer re-renders only on the tool's press /
  // release (the pointermove stands the owning surface's dots only).
  const showPorts = useShowPorts();
  const content = (
    <>
      <ConnectorArrowDefs id={id} />
      {rendered.map((childId) => (
        <CanvasItem key={childId} id={childId} pendingConnector={pendingConnector} interactive={!inert} />
      ))}
      {!inert && showPorts && <PortDots id={id} />}
    </>
  );
  if (inert) {
    // The inert stand (the frame window's copy): the zero-size anchor (the
    // world's origin — the caller's window's offset places it) + the whole
    // layer's pointer-transparent (the copies never stand the press); the
    // ports' dots stand off (the tool's chrome is not the copy's stand). The
    // EMPTY viewport store's re-provide: the copies' items' subscriptions
    // stand the stable stand (the in-flight preview does not ride the copy
    // — the committed geometry's render only).
    return (
      <BlockContext.Provider value={contextValue}>
        <CanvasViewportStoreContext.Provider value={EMPTY_VIEWPORT_STORE}>
          <div className="pointer-events-none relative" style={{ width: 0, height: 0 }}>
            {content}
          </div>
        </CanvasViewportStoreContext.Provider>
      </BlockContext.Provider>
    );
  }
  return <BlockContext.Provider value={contextValue}>{content}</BlockContext.Provider>;
}

/**
 * The four edge ports of every canvas item (the connector's snap
 * targets): the small circles at the edge midpoints. They stand only
 * while the connector tool is active or a connector's endpoint is being
 * dragged (the ports are the tools' affordance, not the resting chrome).
 * Pure view state: no data, no awareness. The dots stand in the surface's
 * center-anchor space (the 1x1 overflow-visible svg, the ConnectorLayer's
 * parity), pointer-events none — the press passes through to the canvas
 * (the snap reads the port's coordinates, not a dot press). The SNAPPED
 * dot (the endpoint drag's live port snap) stands the connect green (the
 * "the point is connected" indicator, the badge's parity).
 */
function PortDots({ id }: { id: BlockId }) {
  const { store } = useEditorContext();
  const surface = useBlock(id);
  // The dots' boxes stand over the children's geometry: the chrome stamp
  // keys the dots memo (a text-only change stands no dots re-render).
  const chromeStamp = useStore(store, (state) => state.chromeStamp);
  // The live snap within this surface's own children (the owning-surface
  // filter): the endpoint's drag re-renders the owning surface's dots
  // only — the other surfaces stand the stable null (no frame).
  const children = surface !== undefined && surface.type === "surface" ? (surface.children ?? []) : [];
  const snapped = usePortSnap(children);
  const dots: ReactNode[] = useMemo(() => {
    if (surface === undefined || surface.type !== "surface") return [];
    const blocks = store.getState().blocks;
    const next: ReactNode[] = [];
    for (const childId of surface.children ?? []) {
      const block = blocks[childId];
      // The connector stands no ports of its own (its ends are the ports'
      // users; a line's box would stand phantom squares over its spans);
      // the group's box is DERIVED (the flat marker) — its default-size
      // box would stand phantom dots at the surface's center.
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
  }, [chromeStamp, snapped, store, surface]);
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
