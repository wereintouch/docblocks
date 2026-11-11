# docblocks-core

## 0.2.2

### Patch Changes

- 745f1d7: The redo of a remounting step (a type change) restores the pre-change
  selection seat: the redo's stack item carries the pre-undo snapshot,
  which over a remount is the lost-caret residue (none/blocks) rather
  than the pre-change seat. The redo falls back to the seat the matching
  undo restored when the item's own snapshot is not a text selection and
  the undo itself restored a text seat (the remount's case); a non-text
  undo restoration (the canvas' blocks selection) is a legitimate
  pre-undo selection and the redo restores its own snapshot. The view's
  history reseat window suppresses the remount's transient selection loss
  over the undo/redo, and the reseat re-runs when the restoration's
  emission lands.

## 0.2.1

### Patch Changes

- c0559db: The mark commands stand the Y.Text format's length contract: `setMark`
  (the exclusive path) and `unsetMark` passed the range's end offset as
  the format's length argument (the Yjs `format(start, length)` signature).
  Over a range whose `from + to` exceeds the text's length the command
  extended the block's text with line breaks (the overhang's characters
  got the mark or the drop) — the ghost empty lines over the mark's
  toggle. The mark now stands the exact `[from, to)` bounds (the length is
  `to - from`); the text is byte-stable over the toggle.

## 0.2.0

### Minor Changes

- 0791efb: The `embed` block gains the persisted view attrs: the optional `zoom`
  (the scale factor, positive) and `panX` / `panY` (the pan offsets, px).
  Absent or `null` stand the identity view (the attrs' null idiom — the
  values are never removed, `null` = the view cleared). The reader stands
  the unknown attrs over the older data (absent = the identity); the
  validator stands the finite-number / positive-zoom rules over the
  strict's path.
- 48ef4fb: The `embed` block's height stands the stretchable stand: the
  `--docblocks-embed-height` token (300 px) is the default — the minimum,
  and the block's bottom edge stands the resize handle (the hover reveal's
  grip bar, the `cursor-row-resize`'s stand, the keyboard's arrows over
  the 16 px's step — the slider's aria). The drag stretches the wrapper's
  height over the gesture (the live's stand), and the rest's commit stands
  the block's new `height` attr (px; absent or `null` = the token's
  default — the null idiom's stand, so the reload restores the stretched
  stand and the panes share it over the wire). The stretch only stands
  over the minimum (the drag over it clamps, the clear stands the `null`'s
  write); the read-only's stand gates the handle off.

## 0.1.3

### Patch Changes

- 5971d30: `PresenceState` now passes through the awareness payload's sharing
  contract fields — the consumer user identity (`userId` / `name`), the
  opaque ciphertext selection entries (`selections`), and the publication
  counter (`seq`). The ws-provider mapper validates them defensively; a
  legacy frame keeps its pre-sharing shape.

## 0.1.2

### Patch Changes

- bf92634: The README's snapshot shape stands the actual JSON form: the document
  fields (`id`, `title`, the optional `avatar`, `createdAt`) stand at the
  top level of the snapshot next to the `blocks` map — the former `meta` /
  `children` top-level description was wrong (the `children` order lives
  inside the blocks, the `meta` object does not exist in the JSON).
- b66e45e: The cross-minor as-is stand reaches the KNOWN block types: an additive
  top-level field (a future minor's data) on a known type no longer stands
  dropped on `fromJSON` — the layout writer keeps it with the generic
  storage semantics (the opaque writer's parity) and the snapshot reader
  passes it through (sorted keys, the `Y.Text` field reads as runs), so a
  load → save cycle never loses unknown data.
  
  The mark value's as-is stand completes too: an unknown mark with a
  non-boolean primitive value (string / number) is preserved on read —
  the reader previously kept only the `true` and the object value shapes,
  silently dropping the primitive ones on save.
- c5a38d2: The link href's gate mirrors the WHATWG URL parser's full input
  normalization: ASCII tab / LF / CR (U+0009–U+000D) are removed from ANY
  position (plus the edge C0 / space trim) before the scheme detection. A
  mid-string control could not hide the scheme before — `java\tscript:…`
  carried no scheme per the `^[a-z][a-z0-9+.-]*:` test, while the browser's
  URL parser strips the control and resolves the `javascript:` scheme, so a
  documented link executed as script. The gate is the single stand of the
  validator's link check, the renderer's href gate, and the paste's
  markdown link re-gate.
- 769c12a: The reactivity's handler isolation: a subscription handler's throw (the
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
- 72fdfd3: The block and mark registry lookups stand the own-property stand over the
  prototype-key values (`constructor`, `toString`, ...): the unknown block
  type named by a prototype key keeps its data over the `fromJSON` /
  `toJSON` round-trip (the opaque stand — the reader's lenient contract),
  the strict commands refuse the unknown type and mark, and the export's
  attr assembly writes own properties only (no prototype swap over a
  hostile attr key).
  
  The same stand over the remaining lookup points: the `changeBlockType`'s
  attrs merge (the target spec's whitelist membership over the own
  properties — the hostile key stands reset like the type-specific attrs,
  the patch's hostile key stands the strict rejection, the own writes keep
  the prototype's setters out), the strict mark-field validation (an
  unknown field named like an `Object.prototype` member stands the
  rejection — the strict posture rejects rather than preserves it), and the
  export's
  id-keyed assemblies (the own writes over the `blocks` / `rows`
  dictionaries — the wire's defense in depth).

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
