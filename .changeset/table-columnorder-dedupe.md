---
"docblocks-core": patch
---

The table's `columnOrder` is now deduplicated (first occurrence) on the read
path, in parity with the database's `rowOrder`. Two concurrent
`moveTableColumn` calls of the same column used to converge to a duplicate
column id in the raw order, which made the converged document fail
`validateDoc` in both postures and throw `InvalidSnapshotError` on
re-import; the raw residue stays reachable through `doc.raw`.
