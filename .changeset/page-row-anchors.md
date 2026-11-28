---
"docblocks-react-ui": minor
---

Every page row now stands `data-block-id` and `data-block-type` on its own
element (`data-slot="docblocks/row"`), in addition to the block's wrapper —
the block's DOM anchor for navigating to it by id (a table of contents
scrolling to a heading). The stand holds over the edit's, the view's, and
the published's renders. The row's anchor is not a block element: the
selection mapping and the remount's re-seat resolve the block from the
wrapper (the row's zone — e.g. a form control's focus residue — stands no
blocks selection over the block).
