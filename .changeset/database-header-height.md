---
"docblocks-core": minor
"docblocks-react-ui": minor
---

The external-form database grid's header row is resizable: dragging the strip
over its lower edge sets the height of every header cell at once, with the
live preview and one commit on the release. The height lands in the block's
`headerHeight` attr (document data — undoable, synced, restored on reload) or,
over the `EditorProvider.databaseTableSection` contract, in the consumer's
per-table value (one height over every block referencing the table; the
block's own attr wins). The auto height is the drag's floor and read-only
modes render no handle. The standalone `DatabaseTable` takes the same
`tableSection` contract.
