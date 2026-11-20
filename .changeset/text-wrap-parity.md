---
"docblocks-react-ui": patch
---

The text surfaces carry the long word's break themselves
(`overflow-wrap: break-word`): the editable region gets the browser's
editing default, and the read-only modes inherit nothing of it, so a long
word in a fixed-width table cell wrapped in the edit mode and spilled
across the cell's edge onto the neighbor over the view and published
modes. The break now stands on the text block's inner, the cell's own
content layer, and the cell's activation layer — the same wrap in every
mode. User content only: the chrome is untouched.
