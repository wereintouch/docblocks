---
"docblocks-react-ui": patch
---

The column seam at a merged region's interior boundary stands and resizes
its covered column: a drag over the seam of a column a `colspan` region
covers commits that column's width (the region's width follows the
columns' sum). The region's reorder handles stay hidden (the core's
move/insert guards stand).
