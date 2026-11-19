---
"docblocks-react-ui": minor
---

The canvas's drill-down reaches the objects covered by another one: the Alt
press steps the stack of the objects under the point (from its top, wrapping)
and the plain repeat press steps the same way over a click — a drag still
moves the pressed object. The session is positional (the stack is recomputed at
each press, the clicks near the previous point step on), a camera or tool move
drops it, and a transient `i / N` chip at the click point names the selected
candidate's position (the touch tap steps over the wider radius). The Alt
press suppresses the double-click's inline entries, and on touch the inline
edit's entry stands off right after a step.
