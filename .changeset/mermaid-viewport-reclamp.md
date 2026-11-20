---
"docblocks-react-ui": patch
---

The diagram preview's viewport re-clamps over the settled geometry: a
ResizeObserver over the wrapper and the transform layer stands the
diagram's centering when the boxes change after the mount — the page's
layout settles post-mount, and the mermaid svg lands asynchronously, so
the mount-time clamp measured the loading skeleton's box and left the
view unclamped (a diagram narrower than the column stood against the
wrapper's left edge; a tall one kept the same stand until an unrelated
change re-ran the clamp). The re-clamp stands the canonical view, so
nothing lands on the wire on load (the identity's attrs stay the null
idiom); the gestures, the fit, the reset, and the persisted view's
restore are unchanged. A tall diagram now stands centered from the first
settled frame, with no gesture or scroll.
