/** The canvas connector's stroke helpers: the arrowhead def's id over the
 * surface's id and the fill value (the per-value def — the token / the
 * selection's accent keep their legacy ids, the data color stands its own
 * id, the non-id characters are dropped — a hex's "#" would break the
 * url(#...) fragment), the line's effective width (the 1–4 data attr's
 * clamp stand + the selection's bump; the label chip's frame reads the
 * same stand), the connector's effective stroke (the selection's accent
 * wins, the data color (a hex) next, the token otherwise — the "none"
 * color stands the token, the line is still drawn, the paint is the
 * theme's). */
import type { BlockId, ConnectorBlock } from "docblocks-core";

import {
  CONNECTOR_SELECTED_STROKE,
  CONNECTOR_STROKE,
  DEFAULT_STROKE_WIDTH,
  MAX_STROKE_WIDTH,
  MIN_STROKE_WIDTH,
  SELECTED_WIDTH_BUMP,
} from "./connector-constants";

/**
 * The arrowhead def's id over the surface's id and the fill value (the
 * per-value def: the token / the selection's accent keep their legacy
 * ids, the data color stands its own id — the non-id characters are
 * dropped: a hex's "#" would break the url(#...) fragment).
 */
function arrowDefId(surfaceId: BlockId, fill: string): string {
  const key =
    fill === CONNECTOR_STROKE
      ? ""
      : fill === CONNECTOR_SELECTED_STROKE
        ? "-selected"
        : `-c${fill.replace(/[^a-z0-9]/gi, "")}`;
  return `docblocks-conn-arrow-${surfaceId}${key}`;
}

/** The line's effective width: the 1–4 data attr's clamp stand (the
 * lenient render over the raw write) + the selection's bump. The label
 * chip's frame reads the same stand (the frame stands the line). */
function connectorStrokeWidthOf(attrs: { strokeWidth?: number }, selected: boolean): number {
  const baseWidth = Math.min(
    MAX_STROKE_WIDTH,
    Math.max(MIN_STROKE_WIDTH, Math.round(attrs.strokeWidth ?? DEFAULT_STROKE_WIDTH))
  );
  return selected ? baseWidth + SELECTED_WIDTH_BUMP : baseWidth;
}

/** The connector's effective stroke: the selection's accent wins, the
 *  data color (a hex) next, the token otherwise (the "none" color stands
 *  the token — the line is still drawn, the paint is the theme's). */
function connectorStrokeOf(block: ConnectorBlock, selected: boolean): string {
  const attrs = block.attrs;
  if (selected) return CONNECTOR_SELECTED_STROKE;
  if (attrs === undefined || attrs.strokeColor === undefined || attrs.strokeColor === "none") {
    return CONNECTOR_STROKE;
  }
  return attrs.strokeColor;
}

export { arrowDefId, connectorStrokeOf, connectorStrokeWidthOf };
