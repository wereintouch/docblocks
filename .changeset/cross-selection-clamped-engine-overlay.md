---
"docblocks-react-ui": patch
---

The cross-block text selection's highlight now stands continuous over the
engines whose DOM selection clamps to the selection's anchor
contenteditable (the WebKit engine — the branded Safari stands it: the
selection's highlight cannot cross a contenteditable boundary over any DOM
API). The package draws the engine's missed segments as highlight boxes
over the editor root (the presence overlay's geometry pipeline), decided
per live selection from the far endpoint's read-back (the crossing
engines' read-back stands no clamping — they stand no boxes, no double
highlight), skipping the anchor block the native highlight already
covers.
