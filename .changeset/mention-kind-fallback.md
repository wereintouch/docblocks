---
"docblocks-react-ui": patch
---

The imperative mention chip's renderer now falls back to the `doc`'s icon
geometry over an out-of-enum `mention` kind (the lenient reader keeps the
wire's value as-is; the kind's mark data is stored over the write's
validation, so a peer-written kind outside the enum stands the data). The
block no longer crashes to its error placeholder over such a run — the
chip renders with its label, the React's path's parity.
