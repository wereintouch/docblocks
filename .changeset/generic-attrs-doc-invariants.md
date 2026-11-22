---
"docblocks-core": patch
---

The generic attr commands (`updateBlock` / `removeBlockAttr`) now keep the
strict validator's doc-level invariants over the touched block: a
`table-cell`'s `columnId` write / removal must stand the column at the cell's
position in the table's `columnOrder` (a full row's stand), and a `database`'s
`columns` / `tableId` removal must keep the strict invariants against the
existing rows — the typed rejection instead of a state the strict validator
rejects.
