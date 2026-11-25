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
