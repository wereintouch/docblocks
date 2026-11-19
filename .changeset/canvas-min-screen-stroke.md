---
"docblocks-react-ui": patch
---

The canvas's world-space strokes stand the min-screen stand: the
connector's line and the shape's border read the data's width over the
1/zoom's compensation (the CSS `max()` over the world's inverse-zoom's
variable), so they stand at least 1 screen-px wide over the zoom's < 1
(the dark data color's sub-pixel thinning's fix — the dark line over the
dark canvas no longer falls below the visibility threshold at the fit's
zoom). The zoom's >= 1 stands the data's verbatim (the line's
thickening's parity), and the data's stand stands the `stroke-width`
attribute (the render's compensation is the style). The stand resolves
natively over the zoom's flip (the no per-item re-render's stand).
