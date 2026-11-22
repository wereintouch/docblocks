---
"docblocks-react-ui": patch
---

The page sequence's structural stamp (`seqStamp`) now sources a block's
`type` change over the entry sequence: a `changeBlockType` of a root
block (the `surface`'s filter input over the page children's derivation)
stands the stamp's bump, so the sequence re-derives its membership
instead of standing the stale row set until the next structural change.
