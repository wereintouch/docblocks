---
"docblocks-react-ui": minor
---

The canvas's block press stands on one hit resolver over the geometry instead
of the DOM's paint order. The press zones are the shape's box (a figure set to
no fill stands its outline's band, an invisible figure its box), the
canvas-text's box, the container's and the frame's border band — their
interiors pass the press through — and the connector's stroke band along the
rendered route (the straight / orthogonal / curved variants over the resolved
endpoints, the same geometry the label's inline edit reads). The tolerance is
screen px, so the bands keep their on-screen reach at any zoom, and the
drill-down's candidate stack follows the paint order with a member lifted above
every container that lists it.
