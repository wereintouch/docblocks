---
"docblocks-react-ui": patch
---

The `sideEffects` field now covers the base entry's top-level chunks
(`dist/*.mjs`): the module-scope initialization (the package's own i18next
instance + the legacy `<html lang>`'s runtime observer) stands declared
over the tree-shaking's bundlers instead of standing reachable only over
the subpath entries.
