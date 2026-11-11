---
"docblocks-react-ui": patch
---

The cross-block selection stands over the engines that clamp the DOM
selection across contenteditable boundaries (webkit / Safari): the
selection writes (the keyboard extension, the drag's seat) use a
document-ordered Range instead of the Selection endpoint setters (the
clamping writes), and the cross-block reads (the arrow at the text's
edge, the range's extension) use the range's far endpoint when the
selection's focus reads clamped into the anchor's editable. The
selection's mapping reads the cross-editable range from its endpoints
instead of the anchor / focus nodes.
