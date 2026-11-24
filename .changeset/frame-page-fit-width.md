---
"docblocks-react-ui": patch
---

A page-frame block whose canvas frame is wider than the page column is now
drawn uniformly downscaled to the column's width instead of being clipped at
its left and right edges; a frame that fits keeps its 1:1 scale.
