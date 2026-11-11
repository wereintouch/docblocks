---
"docblocks-react-ui": patch
---

The canvas connector's line is clickable in webkit (Safari): the wide
invisible hit path renders in its own svg sized to the path's bounding
box over the 1x1 center-anchor draw layer. The webkit hit-tests only
inside an svg's own box (the overflow-visible content of the 1x1 layer
is draw-only there), so the line was not selectable by a click over
there. The chromium and the firefox reach the overflow, so the box
change alters no behavior over them.
