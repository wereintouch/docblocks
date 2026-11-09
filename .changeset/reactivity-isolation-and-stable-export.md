---
"docblocks-core": patch
---

The reactivity's handler isolation: a subscription handler's throw (the
handlers fire inside the Yjs transaction, the afterTransaction hook) no
longer rolls back the caller's committed batch (the `transact`'s rollback
guard would catch the listener's throw otherwise) and no longer aborts the
remaining handlers of the emission — the throw stands the logged error,
the emission continues, and the batch stays committed and undoable.

The export's stable key order: `toJSON` assembles the blocks in sorted id
order — the Y.Map's iteration order depends on the creation history, so
converged peers stood the same data in different key orders before. The
converged peers' exports are byte-identical now (the `JSON.stringify`'s
bytes stand the convergence's check, not just the deep equality); the JSON's
object order is semantically irrelevant — the children's arrays carry the
document order.
