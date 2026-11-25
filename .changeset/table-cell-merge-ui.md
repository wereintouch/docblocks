---
"docblocks-react-ui": minor
---

The table's merged cells over the editor: the anchor cell renders the
region's `colspan`/`rowspan` (the covered cells stand no `<td>`, the
browser's own table layout carries the geometry), and the cell's corner grip
drags a rectangular cell range — the new `tableRange` view-state slice,
never document data. The cell's right-click menu gains **Merge cells** over
a selected rectangle and **Split cells** over a merged cell (the anchor
keeps its content, the restored cells stand empty); the grid coordinates the
hover and the range read come from the resolver, not the DOM's
`cellIndex`/`rowIndex`, so a merged cell's drawn position never lies. The
read-only modes render the spans without the grip, the menu commands or the
resizing chrome.

The range's drag resolves the cell from the DOM boxes (never the top-most
element — the table's chrome overlays the grid), selects whole regions (a
rectangle never cuts a merged cell), stands no resize seam inside a region,
and clears on a press over the document's content outside the table.

A region's chrome offers nothing it cannot do: no resize seam inside the
region, no reorder handle over a spanned column / row, and the cell range
resets over a structural change (its rectangles were read from the cells'
positions).

The add-row chip's drag counts the rows the pointer actually travels: the
step is the last row's height (it was a fixed 24 px, so one row's worth of
drag removed two), the removal walks the real row heights from the last one,
the ghost rows stand the real row height, and the size stand spells the
delta out (`3 × 3 − 1`).

The rows a negative add-chip drag removes stand the columns' fill over the
last rows (the count rides the size stand), and the slash `/table` takes an
empty block's slot instead of leaving an empty paragraph above the grid.
