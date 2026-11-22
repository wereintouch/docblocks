---
"docblocks-react-ui": patch
---

The slash Frame picker's ref-cached list now tracks the root's child blocks' refs alongside the frame blocks' refs: a frame added (or reordered) into an existing surface invalidates the cache — the list re-renders over the live change while the picker stands open.
