---
"docblocks-react-ui": patch
---

**fix:** the HTML paste and the whole-document import keep a bare `br`
between the block's text nodes as the soft line break (the `htmlToBlocks`'
edge whitespace drop no longer erases the line break — the non-browser
serializers stand the `<br>` between the blockquote's text nodes without
the `p`'s wrapper).
