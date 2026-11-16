---
"docblocks-react-ui": patch
---

**Keyboard gestures over cross-block ranges: the continuation's stands.**

- **Shift+ArrowUp/ArrowDown now chains over the cross-block range** — the
  former stand collapsed the selection on the second press (the browser's
  anchor read-back flips over the editor's backward cross seat, and the
  continuation re-based the range over the far end). The editor now owns
  the vertical extension over the cross range: the moving end stands the
  selection's direction (the user's anchor's identity), a single-line
  block's end crosses to the adjacent text block (the non-text siblings
  skipped, the empty blocks' stand), and a multi-line block's inner line
  keeps the browser's native line walk.
- **Ctrl/Meta+Home and Ctrl/Meta+End seat the caret over the document's
  edges** (the first text block's start, the last's end) and scroll the
  caret into view — the browser's native stand degenerates over the
  page's nested editables (the Ctrl+Home's no-move's stand).
- **Ctrl/Meta+A stands over the read-only modes too** (the view /
  published's document zone — the former stand let the browser's
  select-all take the consumer's whole page).
