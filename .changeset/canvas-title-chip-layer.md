---
"docblocks-react-ui": minor
---

The canvas container / frame title chips stand over the screen layer above
the world's paint order: a filled figure painted over the box — the chip's
own seat above the box's top edge included — no longer takes the chip's
press, so the covered container and the frame stay selectable and movable
by their chips. The chip keeps its on-screen size at any zoom (the seat is
the live box's screen projection: it rides the in-flight move / resize
preview and the camera) and renders only over the viewport's culled-in
items; the read-only modes render it inert. The chip's press keeps the
item's contract (the shift toggle, the multi-selection's group drag, the
focus park, the pointer capture), and its double-click enters the title's
inline edit through the chip's own block identity.
