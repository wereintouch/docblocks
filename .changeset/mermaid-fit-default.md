---
"docblocks-react-ui": minor
---

The diagram preview's load-time view is the FIT: over the settled geometry
(the svg's async render, the page's post-mount layout) a diagram without a
persisted view stands whole in the frame, centered, scaled down only —
never up. The persisted zoom / pan is the explicit gesture's state only:
it is restored on reload and written back to the document on the wheel,
the drag-pan, the toolbar's zoom / fit / reset presses, and it is never
written by the load default, the peer's adopt, or the geometry's
re-computation. A wrapper resize re-fits the diagram while no explicit
view stands (and re-clamps the pan once it does).
