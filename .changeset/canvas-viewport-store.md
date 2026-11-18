---
"docblocks-react-ui": patch
---

Improved the canvas view's re-render contract for large canvases (several
thousands of figures and connectors): the viewport state (the in-flight
session's previews — the move / the resize, the connector endpoint's
drag, the keyboard focus) stands in a per-view zustand store, and the
canvas items / connector lines / port dots / label chips subscribe to
their own narrow slices (a pointermove re-renders only the items and the
lines the preview touches, never the resting surface). The surfaces'
chrome re-render keys over a structural chrome stamp (a content-only
change stands no re-render of the chrome). The off-viewport items stand
no DOM of their own (the viewport's culling over the visible world rect
+ the 300px margin — the off-viewport figures / connectors mount / unmount
over the pan's bring-in / take-out; the in-flight session's items stand
un-culled). The canvas view's module set stands split by responsibility
(the world assembly, the world-space overlays, the screen-space chrome,
the selection's overlay, the per-line / per-item math).
