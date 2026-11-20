/** The canvas view's Escape chain: the active states cancel first — the
 * placement tool's stand, the in-flight move / connector endpoint / resize,
 * and the drill-down's step — and the clean state walks the drill-up: a
 * single selected member stands its parent container selected (a local view
 * state's step — no write, no wire update). The chain answers the event's
 * stand: `prevent` (the default and the propagation stand off), `stop` (the
 * propagation only — the browser's default keeps), or `null` when nothing
 * was consumed (the editor's own clear takes the key). */
import type { RefObject } from "react";

import type { Doc } from "docblocks-core";

import type { CanvasViewportState } from "../../canvas";
import type { SelectionRef } from "../../editor-provider";
import { parentContainerOf } from "./canvas-parent";
import type { CanvasPointerSession } from "./models";

interface CanvasEscapeDeps {
  viewport: CanvasViewportState;
  selection: SelectionRef;
  doc: Doc;
  sessionRef: RefObject<CanvasPointerSession | null>;
}

function handleCanvasEscape({ viewport, selection, doc, sessionRef }: CanvasEscapeDeps): "prevent" | "stop" | null {
  if (viewport.activeTool !== null || viewport.pendingConnector !== null || viewport.pendingFree !== null) {
    // The canvas tools' cancel (the page's Escape clears the selection —
    // the tool cancels first, the selection stands).
    viewport.setActiveTool(null);
    viewport.setPendingStand(null);
    viewport.setPenPoints([]);
    viewport.setPlacePreview(null);
    viewport.setConnectorPreview(null);
    sessionRef.current = null;
    return "stop";
  }
  if (viewport.movePreview !== null) {
    // The in-flight move's cancel: the preview is dropped, nothing is
    // written, the selection stands.
    viewport.cancelMove();
    return "stop";
  }
  if (viewport.connectorEndpoint !== null) {
    // The in-flight endpoint drag's cancel (the same contract as the
    // move's: the preview is dropped, nothing is written).
    viewport.cancelConnectorEndpoint();
    return "stop";
  }
  if (viewport.resizePreview !== null) {
    // The in-flight resize's cancel (the same contract as the move's: the
    // preview is dropped, nothing is written).
    viewport.cancelResize();
    return "stop";
  }
  if (viewport.cycleIndicator !== null) {
    // The drill-down's step's session's cancel (the indicator marks the
    // stood step): the state's first step — the selection stands, the next
    // Escape takes its own step.
    viewport.setCycle(null);
    viewport.setCycleIndicator(null);
    return "stop";
  }
  // The drill-up: a single selected member stands its parent container
  // selected (the top-most owner by the paint order).
  const sel = selection.view?.get();
  if (sel?.kind !== "blocks" || sel.ids.length !== 1) return null;
  const parentId = parentContainerOf(doc, sel.ids[0]!);
  if (parentId === null) return null;
  selection.view?.set({ kind: "blocks", ids: [parentId], anchorId: parentId });
  return "prevent";
}

export { handleCanvasEscape };
export type { CanvasEscapeDeps };
