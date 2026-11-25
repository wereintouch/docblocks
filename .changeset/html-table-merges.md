---
"docblocks-react-ui": minor
---

An HTML table's `colspan` / `rowspan` survives the import: `importDocument`
with `kind: "html"` and the rich `text/html` paste land the merged regions as
the data model's own merged cells — the anchor cell carries the spans, the
cells a region covers stand absent from their rows, and the grid matches the
source table. The cells are placed by the browser's table model (a cell takes
the first free column of its row, a row span reserves the coordinates below),
so a row shifted by a span above keeps its columns.

A malformed span degrades to the span the grid fits — a non-integer or a value
below 1 stands 1, a span running onto a covered coordinate or past the last
row is clamped — so the parse never throws on arbitrary markup and the same
payload always imports the same document. The markdown kind carries no merged
cells (GFM cannot express them).
