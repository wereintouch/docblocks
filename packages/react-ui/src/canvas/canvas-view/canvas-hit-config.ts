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
 */
const BORDER_HIT_PX = 6;
const HIT_TOL_PX = 6;
const HIT_STROKE_WIDTH = 12;

export { BORDER_HIT_PX, HIT_STROKE_WIDTH, HIT_TOL_PX };
