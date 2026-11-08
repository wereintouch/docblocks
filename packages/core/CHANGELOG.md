# docblocks-core

## 0.1.1

### Patch Changes

- The README's `createDoc`'s contract stands the actual initial state (only
  the root block — no auto first paragraph).

## 0.1.0

### Added

- The initial release of the headless CRDT document engine
  (dependencies: `yjs`, `y-protocols`; no UI dependencies — the server,
  the blob resolution, and the persistence are consumer-side concerns).
- The document data format (JSON `v: 1`): the document meta (`id`,
  `title`, the optional `avatar`, `createdAt`) + the flat block map
  (`id → block`) with the explicit order via `children: [blockId]`; the
  JSON ↔ Yjs layout is isomorphic (every JSON field has exactly one Yjs
  image — the root's `children` live in the registered `rootOrder` array,
  and each non-root block carries a Yjs-layout-only `parent` field that
  never reaches the JSON).
- The block and mark registry as the single source of truth, with the
  generated discriminated-union types (an invalid attribute is a type
  error at the call site) and the typed command errors (the
  `UnknownBlockError`, the `InvalidRangeError`, the `DetachedBlockError`, ...).
- The v1 block types: `root`, `paragraph`, `quote`, `heading` (levels
  1–6), `list-item` (`bullet` / `number` / `task`, the nesting over the
  `indent` attribute), `callout` (the `variant` + the additive
  `color?` / `icon?` overrides), `code`, `divider`, `image` (the opaque
  `src` key), `embed`, the `table` / `table-row` / `table-cell` triple
  (the cells are the mini-docs; the column set is the shared
  `columnOrder` id array + the cell's `columnId` binding), the
  `database` block (the inline `columns` + `rows` form and the external
  `tableId` form), and the five canvas types (`surface`, `shape`,
  `connector`, `frame`, `canvas-text`) with the optional `geometry`.
- The text model: a single `Y.Text` per text block with the
  character-attribute marks (`bold`, `italic`, `strike`, `underline`,
  `code`, `link`, `color`, `highlight`, `mention`) and the JSON run
  array (`content: [{ text, marks }]`); the formatting is a pure
  attribute op, so the character identity survives the concurrent
  formatting and deletion.
- The semantic command API (the only path for the normal editing): the
  block commands (`insertBlock` / `updateBlock` / `moveBlock` /
  `removeBlock` / `changeBlockType`), the text commands (`insertText` /
  `deleteText` / `setMark` / `unsetMark`), the document meta
  (`setTitle` / `setAvatar`), the geometry and the z-order
  (`setGeometry`, `setZOrder`), the database row commands, and the table
  row / column commands; `transact` batches the commands into one undo
  step and one wire update.
- The selection view (points and ranges, the rebase rules over the
  concurrent edits) and the per-document undo / redo history; the
  selection is the client / view state, never document data (the other
  clients' selections travel only in the ephemeral awareness).
- The CRDT-level power-user API: `encode` / `encodeUpdate` /
  `applyUpdate` / `toJSON` / `fromJSON`, and the explicit `doc.raw:
  Y.Doc` escape hatch (not guaranteed across versions).
- The transport layer: the `SyncProvider` interface + the
  `WsSyncProvider` (the standard y-protocols over WebSocket,
  wire-compatible with `y-websocket` / `pycrdt`) and the `attach(doc,
  provider)` glue (the origin guard + the full-state bootstrap; the
  send buffers over the not-open socket); the presence over the
  y-protocols awareness (the selection + the `updatedAt` per peer, the
  ~30 s staleness TTL).
- The frame as the viewport window into its own surface (no children,
  no content, no `zIndex`) + the page frame block (the `frameId?` weak
  reference); the canvas z-order stands the derived dense 1..N mirror
  (`derivedZIndex`, re-derived on load).
- The complementary reader / validator postures: the strict validator
  (only the known types and marks) and the lenient reader (the unknown
  type → the placeholder fallback, the unknown mark → ignored, the
  unknown attribute → ignored) — the forward-compatibility across the
  minor versions of the major data format.
