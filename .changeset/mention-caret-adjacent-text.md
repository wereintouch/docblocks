---
"docblocks-react-ui": patch
---

The caret seat at a mention chip's boundary now prefers the adjacent editable
text node over the chip's parent element slot: the WebKit family places a caret
next to a `contenteditable="false"` inline island unreliably and collapsed the
pick's caret to the block's end. The element slot stays the fallback when no
text stands on that side.
