---
"docblocks-react-ui": minor
---

The view mode's text stands selectable and copyable: the read-only live
document keeps the native selection over the page (the editing surfaces
stay off — no caret, no write), and the editor's copy payload serves it —
the same to-html/to-text serialization as the edit mode's (the marks, the
`@label` mentions, the cross-block ranges). The published stand keeps the
selection's ban: no range, no copy (the reader's stand on the rendered
page only). The editor root carries the resolved mode over the new
`data-mode` structural hook (`data-readonly` stays for both read-only
stands); the canvas world keeps the no-select stand over the view mode
(the native range would fight the pan's drag).

A native table block now copies as a spreadsheet's grid: the html flavor
carries a real `<table>` (the rows and the columns in the table's own
order, a cell's line breaks as `<br>`) and the plain flavor the TSV — the
pasted cells land in a spreadsheet's grid instead of a column of lines.
The table's covered cells stand the copy's unit (a partially covered
endpoint cell is included whole), the block's own selection (the row's
gutter press) copies the whole grid, and the table pieces stand in place
over a cross-block range (the surrounding blocks keep their lines).
