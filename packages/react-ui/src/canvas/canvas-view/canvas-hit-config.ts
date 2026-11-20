/**
 * The canvas hit model's shared constants: the screen-px tolerance the press
 * zones and the drill-down's stack stand over (translated to the world's px
 * by the zoom — a band's on-screen width stays the same at any zoom), the
 * container / frame border's hit band width, and the connector's hit path's
 * stroke width (the invisible band the pointer hovers and the browser
 * hit-tests; the press's own reach stands the tolerance).
 *
 * The border's band straddles the box's edge by half (the half in, the half
 * out), so a press on the edge stands the container / the frame's selection
 * while the interior stays pointer-transparent.
 *
 * The drill-down's session: the click radius (screen px — a wider one for the
 * touch pointer, whose 8 px stand out of reach) and the plain repeat-click's
 * window (the Alt press is positional — the session lives while the clicks
 * stay inside the radius). The stack wraps from its last candidate back to
 * the top.
 */
const BORDER_HIT_PX = 6;
const HIT_TOL_PX = 6;
const HIT_STROKE_WIDTH = 12;
const CYCLE_RADIUS_PX = 8;
const CYCLE_RADIUS_TOUCH_PX = 18;
const CYCLE_WINDOW_PLAIN_MS = 900;
const CYCLE_PRESS_GAP_MS = 500;
const CYCLE_INDICATOR_FADE_MS = 1000;
const CYCLE_DOUBLE_TAP_MS = 400;
const CYCLE_WRAP = true;

export {
  BORDER_HIT_PX,
  CYCLE_DOUBLE_TAP_MS,
  CYCLE_INDICATOR_FADE_MS,
  CYCLE_PRESS_GAP_MS,
  CYCLE_RADIUS_PX,
  CYCLE_RADIUS_TOUCH_PX,
  CYCLE_WINDOW_PLAIN_MS,
  CYCLE_WRAP,
  HIT_STROKE_WIDTH,
  HIT_TOL_PX,
};
