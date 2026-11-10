---
"docblocks-react-ui": patch
---

The Enter's split over the empty LAST line stands the exit's parity: the
caret on an empty line at the text's end (the block's text ends with a
soft line break) consumes that break with the gesture — the first block
stands without the ghost empty line, the new sibling (the same type and
attrs) stands empty. Before the fix the break survived the split in the
first block as a rendered empty line that the line-boundary gestures
(Home / End / the selection's deletes) do not reach. The quote /
callout / code gesture family's exit stand (the same block over its
own Enter handler) was the reference; the mid-text split's stand is
unchanged (the new block's leading break is the caret's new line).
