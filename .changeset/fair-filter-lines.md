---
"docblocks-react-ui": minor
---

Rebuild the database filter menu over the library's field style: the
condition's field / operator / value stand a single line over styled
controls in a widened popover, the conditions and the nested group cards
are bound by the group's left connector line, the AND/OR logic's labels
stand the UI's locale, and the footer's apply/clear keep the standard
button size and gap. The grid toolbar's undo/redo/columns/filter buttons
stand the standard toolbar height and rounding, and the standalone
`DatabaseTable` renders no table name (the consumer's own visual element
stands the name — the document block's grid keeps the live name and the
rename).
