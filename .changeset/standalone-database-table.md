---
"docblocks-react-ui": minor
---

Add the standalone's database's surface (the consumer's own page, not a
document block): the `DatabaseTable` component (the live grid over the
bridge's table id — the same `useDatabaseTable`'s data stand as the
document block) + the `useTableList` hook (the `listTables`'s catalog
read + the `createTable` / `renameTable` mutations over the fresh's
`operationId` per op; the catalog's auto-refresh stands over the own's
successful mutations + the manual's `refresh`). The `DatabaseTable`'s
view's settings (`filter`, the `columnOrder`, the `hiddenColumns`, the
`columnWidths`) stand the internal's state seeded from the optional
`view` prop + persisted over the `onViewChange`'s patch callback (the
controlled's mode stands absent — one patch per change, as the block's
`updateBlock` stand). The `readOnly`'s stand gates the editing's paths
(the block's read-only's parity). The grid's `GridBody` stands extracted
from the document's context (the view's attrs' write is the callback's
stand — the block's wrapper keeps one `updateBlock` per change, no
behavior's diff).
