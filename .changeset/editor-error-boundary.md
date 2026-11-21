---
"docblocks-react-ui": minor
---

The editor stands a top-level render boundary: a throw of the editor's
chrome outside a block's renderer (the attributes panel, the canvas chrome,
the row list) is contained to the editor's content with a failure note and a
retry, so the consumer's application stays mounted. The boundary is exported
for the consumer's own wrappers (`fallback` and `resetKey` props); a block's
renderer keeps its narrower per-block boundary.
