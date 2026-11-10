---
"docblocks-react-ui": minor
---

The `embed` block's slash form stands the URL input only (the kind's
selector stood removed — the kind's default stands the `iframe`, the
renderer's hint over the single-iframe stand). The `data:text/html`
snippet's stand (the former `html` kind's purpose over the form) is no
longer reachable over the form; the `html` kind stands a valid data
kind over the direct insert / the wire.

The default embed sandbox's stand changes: it now grants
`allow-same-origin` (with the `allow-scripts`), so the embedded app
boots with its own origin's storage / cookies (the real-app's
requirement — the dashboards' class stands). The frame's document stands
a separate document either way (a cross-origin's embed cannot reach the
parent's DOM or state); the posture's consequence stands the same-origin
URL's reach over the parent's state. The consumer's `embedSandbox`
policy stands the restriction (the opaque-origin's stand, the
`allow-same-origin`'s refuse).

The embed's pan/zoom stands the block's persisted attrs (the `zoom` /
`panX` / `panY` over the core's new attrs): the reload / the new tab's
embed restores the view, and the panes share the persisted view over
the wire (a pane's gesture writes over the doc, the other's adopt it).
The write's debounce stands over the gesture's bursts (one doc write
per rest); the values stand the wire's precision (the 1% zoom, the
0.1 px pan — the floating-point's residue's guard).
