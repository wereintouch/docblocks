---
"docblocks-react-ui": patch
---

The `./mermaid` subpath's entry now stands in the package's `sideEffects`
list (as the `./pdf`'s entry does): the entry runs the module-scope
mermaid's configuration, and a tree-shaking bundler over the absent
entry could drop its side effects.
