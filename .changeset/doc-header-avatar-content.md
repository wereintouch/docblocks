---
"docblocks-react-ui": minor
---

The `DocHeader` avatar slot is customizable: `renderAvatarContent` stands
the consumer's content in place of the built-in emoji / "+" render (the
wrapper, the emoji picker, and the accessible names stay the library's; the
read-only stands pass `editable: false`), and `hideAvatar` removes the slot
for consumers that render the document avatar elsewhere. Without the new
props the render is unchanged.
