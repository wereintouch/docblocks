---
"docblocks-react-ui": patch
---

The blob placeholder's box stays inside the page column and its content
stands centered. A figure whose intrinsic ratio is far wider than the
column (a 26:1 banner) let the loading placeholder outgrow the row on
Chromium — the box took its width from the inline `aspect-ratio` alone and
the document scroller grew a horizontal overflow; the shared placeholder
class now clamps the card to the row width. The placeholder's content (the
spinner + the label) is centered on both axes inside the reserved height
instead of sitting at the top edge — centered with auto margins, so a
reserved box shorter than the content keeps its top edge rather than
spilling above it.
