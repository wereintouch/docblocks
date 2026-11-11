---
"docblocks-react-ui": patch
---

A DOM selection outside a text-editable inside the canvas view maps to
none over the page's selection mapping. The engine's focus move over a
canvas item (the mousedown's default focuses the non-editable — the
firefox's behavior) fires a selectionchange whose blocks mapping would
flag the focused item: the stray selection tinted the picked shape
over the canvas' own selection state (the two-click pick's first
pick). The canvas manages its selection over the explicit press; the
page card's editable keeps the mapping.
