---
"docblocks-react-ui": patch
---

The selector's escape stand: the three block-content lookups (the range
extend's target, the gesture's stale-restore focus, the format
toolbar's type-change exclude) build the `data-block-id` selector over
`CSS.escape` — the full parity with the package's other lookup points,
where a crafted block id (a quote / bracket) would otherwise stand a
`SyntaxError` from `querySelector` in the keyboard / gesture handlers.
