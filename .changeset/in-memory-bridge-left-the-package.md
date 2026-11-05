---
"docblocks-react-ui": minor
---

## The in-memory database bridge left the package

The `docblocks-react-ui` package ships the `DatabaseBridge` contract and
the UI only. The in-memory reference bridge is the consumer's own
implementation — a stand for the consumer's backend — and now lives in the
consumer's code, not in the package.

**Breaking**:

- `createMemoryDatabaseBridge` is no longer exported.
- `getDefaultDatabaseBridge` (the page-level default instance) is no
  longer exported, and `EditorProvider` no longer falls back to a default
  bridge when `databaseBridge` is not passed.

**Additive**:

- `TEXT_TYPES` (the set of bridge column types that hold text) is exported
  from the package root — the reference bridge's consumer-side logic needs
  it, and it was previously package-internal.

**No-bridge behavior**:

- An external-form `database` block (`tableId`) without a `databaseBridge`
  provider renders a placeholder card ("database not connected") instead of
  a live grid. The inline form is unaffected (it has no bridge surface).
- The `/database` slash command is hidden from the menu when no bridge is
  provided.

A consumer that previously relied on the package's default bridge must now
create its own in-memory bridge (the playground harness's `memory-bridge`
directory is a complete reference implementation) and pass it via the
`databaseBridge` provider prop.
