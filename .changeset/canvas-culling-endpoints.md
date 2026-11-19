---
"docblocks-react-ui": patch
---

The canvas view's culling no longer thins the surface's siblings' block
context: the off-viewport items' keep set stands the rendered wrappers
only, and the connector's endpoint resolution stands the surface's full
children over their committed geometry. A connector whose endpoint block
is off-viewport (out of the culling's margin's band) stood dropped
(`data-missing`, the line's no render) with the label chip orphaned —
the line now stands drawn over its visible spans (the line's own cull
box over its endpoints' boxes' union still decides its mount), and the
label chip's midpoint's read stands the full list (no culling-induced
drop).
