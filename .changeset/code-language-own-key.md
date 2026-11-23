---
"docblocks-react-ui": patch
---

The code block's language lookup uses the own-key stand only: a language value
standing on an `Object.prototype` key (such as `constructor` — reachable over
`updateBlock`, a markdown fence, or a peer write, since the attr is a plain
string) renders plain (no highlight layer) instead of resolving to the
inherited non-grammar value that crashed the block's render to its error
placeholder.
