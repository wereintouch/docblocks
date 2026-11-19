/** The canvas view's pointer sessions' shared context: the refs (the
 * session, the last pointer, the card-press flag, the connector press's
 * client point), the deps (the viewport's store, the block map, the doc,
 * the selection, the surfaces, the resize handle's target), and the stand
 * helpers (the center-relative point, the chrome / the page card's
 * containment, the stand item under the cursor, the port-proximity pick).
 * The context is created per render (the handlers stand the render's deps,
 * the parity with the former per-hook closures). */
import type { RefObject } from "react";

import type { Block, BlockId, Doc } from "docblocks-core";

import type { CanvasViewportState, CanvasViewportStore } from "../../canvas";
import type { SelectionRef } from "../../editor-provider";
import { effectiveGeometry, portsOf } from "../geometry";
import { PORT_PICK_RADIUS_PX } from "./constants";
import type { CanvasPointerSession } from "./models";

interface CanvasSessionDeps {
  containerRef: RefObject<HTMLDivElement | null>;
  sessionRef: RefObject<CanvasPointerSession | null>;
  lastPointerRef: RefObject<{ x: number; y: number } | null>;
  cardPressRef: RefObject<boolean>;
  connectorPressClientRef: RefObject<{ x: number; y: number } | null>;
  viewport: CanvasViewportState & { store: CanvasViewportStore };
  spacePan: boolean;
  blocks: Record<BlockId, Block>;
  doc: Doc;
  rootBlockId: BlockId;
  selection: SelectionRef;
  isEditingSurface: (target: EventTarget | null) => boolean;
  surfaces: { id: BlockId; children: BlockId[] }[];
  handleTarget: { id: BlockId; box: { x: number; y: number; w: number; h: number } } | null;
  /** The read-only stand (the view / published's modes): the selection's / the move's / the resize's / the placement's / the connector's sessions stand off — the pan's gesture keeps (the view's gesture, no data). */
  viewMode: boolean;
}

interface CanvasSessionContext extends CanvasSessionDeps {
  /** The press's point in the container's center-relative space (the pan's / the marquee's / the place's start). */
  centerRelativePoint: (event: { clientX: number; clientY: number }) => { x: number; y: number };
  /** The canvas chrome (the toolbar's / the dock's / the palette's zone): the press belongs to the chrome, not the canvas. */
  isChrome: (target: EventTarget | null) => boolean;
  /** The page miniature's card (the content keeps the caret; the card's move stands off the content). */
  isPageCard: (target: EventTarget | null) => boolean;
  /** The canvas item under the target — EXCEPT the connector's own wrapper (a press on the line's hit band stands no stand on the line: the connector carries no box — the band is the line's hit aid, and the stand falls to the port / the free stand under the band, the pre-wrapper contract). */
  standItemAt: (target: EventTarget | null) => HTMLElement | null;
  /** The port-proximity pick (the connector's press / release): the canvas point stands within the pick radius of a canvas item's PORT (the edge strip falls to the page card / the background under the item — the exact-edge press misses the item's fill). The port's shape stands the block stand; the commit's snap stands the port itself. */
  portBlockAt: (point: { x: number; y: number }) => string | null;
}

function createCanvasSessionContext(deps: CanvasSessionDeps): CanvasSessionContext {
  const centerRelativePoint = (event: { clientX: number; clientY: number }) => {
    const container = deps.containerRef.current;
    if (container === null) return { x: 0, y: 0 };
    const rect = container.getBoundingClientRect();
    return {
      x: event.clientX - rect.left - rect.width / 2,
      y: event.clientY - rect.top - rect.height / 2,
    };
  };

  // The editing surfaces keep the pointer: the canvas-text inners and the
  // page miniature's content (the caret / the text selection).
  const isChrome = (target: EventTarget | null) =>
    target instanceof Element && target.closest('[data-slot="docblocks/canvas-chrome"]') !== null;

  // The page miniature's content keeps the pointer too (no marquee/pen from
  // the page: the page blocks are not canvas items).
  const isPageCard = (target: EventTarget | null) =>
    target instanceof Element && target.closest('[data-slot="docblocks/page-card"]') !== null;

  const standItemAt = (target: EventTarget | null): HTMLElement | null => {
    const item = target instanceof Element ? target.closest<HTMLElement>('[data-slot="docblocks/canvas-item"]') : null;
    if (item !== null && item.querySelector("[data-connector-hit]") !== null) return null;
    return item;
  };

  const portBlockAt = (point: { x: number; y: number }): string | null => {
    for (const { children } of deps.surfaces) {
      for (const childId of children) {
        const block = deps.blocks[childId];
        if (block === undefined || block.type === "connector") continue;
        const ports = portsOf(effectiveGeometry(block));
        if (
          (Object.keys(ports) as ("north" | "east" | "south" | "west")[]).some(
            (port) => Math.hypot(ports[port].x - point.x, ports[port].y - point.y) <= PORT_PICK_RADIUS_PX
          )
        ) {
          return childId;
        }
      }
    }
    return null;
  };

  return { ...deps, centerRelativePoint, isChrome, isPageCard, standItemAt, portBlockAt };
}

export { createCanvasSessionContext };
export type { CanvasSessionContext, CanvasSessionDeps };
