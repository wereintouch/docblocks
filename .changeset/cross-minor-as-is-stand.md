---
"docblocks-core": patch
---

The cross-minor as-is stand reaches the KNOWN block types: an additive
top-level field (a future minor's data) on a known type no longer stands
dropped on `fromJSON` — the layout writer keeps it with the generic
storage semantics (the opaque writer's parity) and the snapshot reader
passes it through (sorted keys, the `Y.Text` field reads as runs), so a
load → save cycle never loses unknown data.

The mark value's as-is stand completes too: an unknown mark with a
non-boolean primitive value (string / number) is preserved on read —
the reader previously kept only the `true` and the object value shapes,
silently dropping the primitive ones on save.
