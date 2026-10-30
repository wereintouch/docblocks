/** The per-surface volatile canvas session (the move / resize previews +
 * the connector's endpoint drag): the per-line render reads it through
 * the context (the lines follow the items mid-drag — the preview stands
 * the endpoint resolution). The page view's surface stands the inert
 * session (no session there). The context is the viewport's props, not
 * the doc: a preview change stands the re-render, a block change stands
 * the line's own block / blocks subscription. */
import { createContext } from "react";

import type { BlockId } from "docblocks-core";

import type { Box, MovePreview } from "../canvas";
import type { CanvasPort } from "./canvas-geometry";

interface CanvasSession {
  movePreview: MovePreview | null;
  resizePreview: { id: BlockId; box: Box } | null;
  endpointDrag: { connectorId: BlockId; which: "start" | "end" } | null;
  endpointPreview: {
    point: { x: number; y: number };
    snap: { blockId: string; port: CanvasPort; t: number } | null;
  } | null;
}

const INERT_CANVAS_SESSION: CanvasSession = {
  movePreview: null,
  resizePreview: null,
  endpointDrag: null,
  endpointPreview: null,
};

const CanvasSessionContext = createContext<CanvasSession>(INERT_CANVAS_SESSION);

export { CanvasSessionContext, INERT_CANVAS_SESSION };
export type { CanvasSession };
