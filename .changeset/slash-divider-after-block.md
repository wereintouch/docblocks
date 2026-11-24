---
"docblocks-react-ui": patch
---

The divider picked from the slash menu over a block with text no longer does
nothing: it lands right after the caret block (the trigger phrase strips, the
block keeps its text, the caret stays in it). A phrase-only block without
followers still takes the divider's slot.
