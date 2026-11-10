---
"docblocks-react-ui": patch
---

The callout's management moves from the format toolbar to the block's own
affordance: the marker-zone icon stands a button (edit mode only) whose
click opens the block's management menu (the type presets, the background
palette, the icon catalog) beside the icon. The menu manages the block's
attrs, not the selection's marks, so it stands for an empty callout (no
text selection needed). The format toolbar over a callout's text range
keeps the shared text marks and the alignment only (the callout's section
is removed). The background palette gains the custom swatch: the `ColorPicker`
primitive (the native `input type="color"` + the strict `#rrggbb` hex
field) commits one `updateBlock({ color })` per pick (one undo step, one
wire update); the close without a commit discards the draft. The read-only
stands (view / published) render the icon without a button (no pointer
events, the editing-surface parity).
