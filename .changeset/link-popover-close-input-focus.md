---
"docblocks-react-ui": patch
---

The link editor's popover closes on an outside press (the document's
pointerdown over the popover's own press's exclusion) and on the document's
Escape (the input's no-focus's stand) — the stands the anchor's right-click
menu already kept. A press on the popover's input keeps the mousedown's
default (the input's focus + the caret's seat over the click), so the
address's edit works after the input lost the focus — the typing lands in
the input, not in the document. The popover's chrome keeps the default's
suppression (the document's selection's life over the edit).
