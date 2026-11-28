---
"docblocks-react-ui": patch
---

fix(database): the Columns popover's mouse reorder commits from the pointer's
true release position (the native event's coordinate hit-tested against the
rows' midpoints) instead of the framer's cascade draft — the draft lags the
pointer over the slow engine's input batching (a last-slot miss), and the
drag-start order's reference stands rewritten over the reorder's mid-drag
remount (a spurious no-op). The commit's previous is the committed order (the
hidden's columns keep their committed positions over the visible slots).
