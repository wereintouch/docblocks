---
"docblocks-react-ui": patch
---

The standalone `DatabaseTable` now anchors the package's `--docblocks-*`
token scope over its own root (the `data-slot="docblocks/editor"` stand).
The token mapping is declared on the editor root over the shipped CSS,
and the standalone table renders outside any document — without the
scope the grid's token-driven utilities (the borders, the paddings, the
row's heights) stood unresolved over the consumer's page. The
`readOnly` stand sets the root's `data-readonly` attribute (the page
mode's `user-select`'s suppression parity).
