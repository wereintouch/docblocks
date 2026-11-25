---
"docblocks-core": minor
---

The table's cells merge and split. A `table-cell` carries the optional
`colspan`/`rowspan` attrs (default 1) and stands the anchor of a merged
region: the cells the region covers are absent from their rows, so a row is
legitimately shorter than the table's column set. `mergeTableCells` folds
the rectangle between two grid corners into its top-left cell (its content
stands, the covered cells and their content drop) and `splitTableCells`
restores empty single cells over the region while the anchor keeps its
content; both are one transaction (one undo step, one wire update).

`resolveTableGrid(doc, tableId)` (and the pure `buildTableGrid`) resolve the
grid — the anchors, their spans and the coordinate lookups — from the cells'
column bindings; the strict validator checks the spans' bounds and overlaps
instead of counting cells, and the read path re-derives a stale span
(`normalizeMerges`) before validation, the same way the canvas z-order mirror
is re-derived.
