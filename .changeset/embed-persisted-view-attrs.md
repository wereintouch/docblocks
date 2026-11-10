---
"docblocks-core": minor
---

The `embed` block gains the persisted view attrs: the optional `zoom`
(the scale factor, positive) and `panX` / `panY` (the pan offsets, px).
Absent or `null` stand the identity view (the attrs' null idiom — the
values are never removed, `null` = the view cleared). The reader stands
the unknown attrs over the older data (absent = the identity); the
validator stands the finite-number / positive-zoom rules over the
strict's path.
