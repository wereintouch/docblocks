---
"docblocks-core": patch
"docblocks-react-ui": patch
---

The redo of a remounting step (a type change) restores the pre-change
selection seat: the redo's stack item carries the pre-undo snapshot,
which over a remount is the lost-caret residue (none/blocks) rather
than the pre-change seat. The redo falls back to the seat the matching
undo restored when the item's own snapshot is not a text selection and
the undo itself restored a text seat (the remount's case); a non-text
undo restoration (the canvas' blocks selection) is a legitimate
pre-undo selection and the redo restores its own snapshot. The view's
history reseat window suppresses the remount's transient selection loss
over the undo/redo, and the reseat re-runs when the restoration's
emission lands.
