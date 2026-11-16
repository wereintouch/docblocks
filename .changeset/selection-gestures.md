---
"docblocks-react-ui": patch
---

**Editor selection gestures: the native stands.**

- **Ctrl/Meta+A now selects the whole document** over the page's nested
  editables, where the browser's own select-all degenerates (the Chromium's
  stand: a collapsed caret at the document's end instead of the full
  selection). The editor seats the whole-document selection itself (the
  first text block's start to the last text block's end, the cross-block
  range the copy/paste/delete's cross paths stand over); form controls and
  the canvas view keep their own select-all.
- **A click-then-Shift+click extends the selection across the blocks** —
  the browser's native shift+click extension stands (the former stand tore
  down the session and suppressed the default, which killed the native
  extension and let the focus fall to the document body).
