/**
 * The canvas container / frame's border's shared hit band: the wide
 * transparent strip's width (px, both sides of the edge — the thin border's
 * press reach). Each strip straddles the box's edge by half (the half in,
 * the half out), so a press on the edge stands the container / the frame's
 * selection while the interior stays pointer-transparent.
 */
const BORDER_HIT_PX = 6;

export { BORDER_HIT_PX };
