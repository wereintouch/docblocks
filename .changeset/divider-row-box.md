---
"docblocks-react-ui": minor
---

The divider's block box: the line stands centered over the block's box
(`min-height: 2 × --docblocks-divider-margin + the line's width`) instead
of the collapsed margin's 1px row — the row's hover zone stands the full
box, and the row's gutter controls (the grip, the plus, the delete) center
over the box's axis (the line's axis) instead of the first line's box.
The slotted element (`docblocks/divider`) stands the box — the line is
the inner `<hr>` (the former slotted `hr`). The `--docblocks-divider-margin`
token stands a single length (the spacing over the line, the default
16px → 20px) — the former two-value's shorthand stands removed.
