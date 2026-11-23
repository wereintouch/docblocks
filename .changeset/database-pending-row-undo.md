---
"docblocks-react-ui": patch
---

The external-form database grid's write-tails over a pending row (the row
filtered out of the page) build their undo entries over the pre-operation
state seeded from the pending stand: the pending row's edit and its removal
are undoable (the removal's inverse is the row-restore over the `rowRestore`
capability), and the insert's entry no longer strands over a removed pending
row — undoing such a removal restores the row, and the following undo deletes
it over the restored row.
