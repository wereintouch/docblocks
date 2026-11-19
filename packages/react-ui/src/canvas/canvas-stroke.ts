/** The canvas's world-space strokes' min-screen stand: the data's stroke
 * width over the 1/zoom's compensation — the line / the shape's border
 * stands at least 1 screen-px wide over the zoom's < 1 (the dark data
 * color's sub-pixel thinning's fix), the zoom's > 1 stands the data's
 * verbatim (the line's thickening's parity).
 *
 * The `max()` + the world's inverse-zoom's CSS variable resolve natively
 * over the zoom's flip: the world's container re-styles the variable over
 * the zoom (the transform's stand), the strokes' values stand the stable
 * strings (the no per-item re-render's stand over the zoom's ticks). */
function minScreenStrokeOf(width: number): string {
  return `max(${width}px, calc(var(--docblocks-canvas-inv-zoom, 1) * 1px))`;
}

export { minScreenStrokeOf };
