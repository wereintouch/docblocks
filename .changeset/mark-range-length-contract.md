---
"docblocks-core": patch
---

The mark commands stand the Y.Text format's length contract: `setMark`
(the exclusive path) and `unsetMark` passed the range's end offset as
the format's length argument (the Yjs `format(start, length)` signature).
Over a range whose `from + to` exceeds the text's length the command
extended the block's text with line breaks (the overhang's characters
got the mark or the drop) — the ghost empty lines over the mark's
toggle. The mark now stands the exact `[from, to)` bounds (the length is
`to - from`); the text is byte-stable over the toggle.
