---
"docblocks-react-ui": patch
---

A dragged canvas item (and the page card) now gets its own composited layer
while the move or resize session is live: the WebKit family repaints the moved
item's selection ring unreliably over a transform-only change, leaving the ring
trailing behind the drag.
