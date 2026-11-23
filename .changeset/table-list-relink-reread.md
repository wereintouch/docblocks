---
"docblocks-react-ui": patch
---

The standalone's `useTableList` catalog hook now re-reads the catalog over a
bridge identity change (a relink to a fresh bridge instance), in parity with
the `useDatabaseTable`'s re-bootstrap — the stale catalog over the previous
bridge no longer stands while mutations land on the new one.
