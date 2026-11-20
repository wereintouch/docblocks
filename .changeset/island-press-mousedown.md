---
"docblocks-react-ui": patch
---

A press over a non-editable island (the mention chip, an image figure, the
table's chrome) no longer parks the editor root's focus over the press:
the mousedown's default (the browser's focus's move over the shared page
editable + the scroll's pull to the press's point) is suppressed, and the
focus stands where it stood — the parked root's focus scrolled the port to
the editor's top over the press (the press's point moved under the pointer
and the island's own click's handlers — the consumer's
`mentionInteractions.onClick` — could lose the click). A self-contained
editable inside the island (a table cell's inner, the empty cell's
activation layer) keeps its native default.
