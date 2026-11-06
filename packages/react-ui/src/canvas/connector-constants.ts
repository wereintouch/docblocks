/** The canvas connector's render constants: the v1 connector stroke (the
 * shape token), the selected connector's stroke (the canvas selection's
 * cyan — the token stands in both themes; the page `--accent` is a hover
 * surface, not a line color), the connect badge's green (the endpoint
 * drag's port snap indicator), the line's stroke width bounds (canvas px;
 * the data stand is 1–4, the absent stand is 1 — the registry spec's
 * parity), the selection's width emphasis, the invisible hit path's
 * width, the arrowhead's length (the marker's coordinate space), the
 * circle endpoint's radius, the connect badge's radius + its offset from
 * the snapped port along its outward normal. */
const CONNECTOR_STROKE = "var(--docblocks-canvas-shape-stroke, currentColor)";
/** The selected connector's stroke (the canvas selection's cyan — the
 *  token stands in both themes; the page `--accent` is a hover surface,
 *  not a line color). */
const CONNECTOR_SELECTED_STROKE = "var(--docblocks-canvas-selected-stroke)";
/** The connect badge's green (the endpoint drag's port snap indicator). */
const CONNECT_COLOR = "var(--docblocks-canvas-connect-color, #16a34a)";
/** The line's stroke width bounds (canvas px; the data stand is 1–4,
 * the absent stand is 1 — the registry spec's parity). */
const MIN_STROKE_WIDTH = 1;
const MAX_STROKE_WIDTH = 4;
const DEFAULT_STROKE_WIDTH = 1;
/** The selection's width emphasis over the line's own width. */
const SELECTED_WIDTH_BUMP = 1;
/** The invisible hit path's width (a wide enough stroke to click the line). */
const HIT_STROKE_WIDTH = 12;
/** The arrowhead's length (canvas px, the marker's coordinate space). */
const ARROW_SIZE = 11;
/** The circle endpoint's radius (canvas px, the marker's coordinate space). */
const CIRCLE_ENDPOINT_RADIUS = 4;
/** The connect badge's radius (canvas px, beside the snapped port). */
const SNAP_BADGE_RADIUS = 10;
/** The connect badge's offset from the snapped port along its outward
 * normal (canvas px — the badge stands outside the box, beside the port). */
const SNAP_BADGE_LIFT = 16;

export {
  CONNECTOR_STROKE,
  CONNECTOR_SELECTED_STROKE,
  CONNECT_COLOR,
  MIN_STROKE_WIDTH,
  MAX_STROKE_WIDTH,
  DEFAULT_STROKE_WIDTH,
  SELECTED_WIDTH_BUMP,
  HIT_STROKE_WIDTH,
  ARROW_SIZE,
  CIRCLE_ENDPOINT_RADIUS,
  SNAP_BADGE_RADIUS,
  SNAP_BADGE_LIFT,
};
