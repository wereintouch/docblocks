---
"docblocks-react-ui": patch
---

The table's row/column drag preview now applies the transform over the
dragged row/column's cells instead of the row element (the `<tr>` is not
a CSS transformable element — the engine may ignore the row's
transform, leaving the preview dead while the handle follows the
pointer). The dragged cell reads as a lifted card (a `--card`
background + a `--docblocks-table-drag-shadow` box shadow over the
uncolored cells, behind the cell's own row/column color), so the
preview is visible over an empty table. The read-only modes render an
empty table cell's placeholder (one line, matching the activation
layer's footprint), keeping the edit mode's minimum row height in the
view/published views.
