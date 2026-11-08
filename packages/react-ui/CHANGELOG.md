# docblocks-react-ui

## 0.1.1

### Patch Changes

- The README stands the `styles.css`'s import's ambient `*.css` declaration's
  note and the `DocHeader`'s stand over the `viewer`'s level.

## 0.1.0

### Added

- The initial release of the React rendering + editing layer (peer
  dependencies: `docblocks-core`, `react`, `react-dom`; the optional
  peers `framer-motion`, `mermaid`, and `pdfjs-dist` stand behind the
  optional subpaths; the package builds strictly on the core's public
  API — it never imports `yjs`).
- `EditorProvider` + `Editor`: the page view (the block flow over the
  flat model) and the canvas view (`view: "canvas"` — the page
  miniature plus the root-level surfaces), and the per-instance store
  with the reference-stability re-render contract (the `useBlock`
  re-renders only for the changed blocks).
- The editing layer: the text blocks (the contenteditable inner managed
  from the store runs, the single-transaction input commits), the
  selection (gutter / mouse / cross-block text range), the slash menu,
  the floating format toolbar, the markdown + multi-block `text/html`
  paste, the gutter quick-insert, the keyboard and clipboard
  conventions, the undo / redo with the selection re-seat, and the `@`
  mention picker (the consumer's `mentionProvider`).
- The block-renderer registry — the consumer extension point: a custom
  renderer per block type stands over the built-in renderers (which
  cover every v1 block type).
- The canvas: the five block types, the zoom / pan viewport + the
  bottom dock, the move / resize / nudge / fit / connector-draw /
  copy-paste sessions, the connectors (the endpoint system, the ports,
  the orthogonal avoidance, the labels, the style), and the explicit
  `zIndex` (the arrange menu). The frame stands the viewport window —
  moving the frame pans the window, not the content, and the frame
  renders behind the other surface elements; the page frame block
  stands the inline live window into the referenced canvas frame (the
  `/frame` slash picker). The canvas-text stands the ghost double-click
  entry and the shape-parity press contract (the press selects and
  moves, the double-click edits).
- The native `table` block: the cells as the mini-docs, the row and
  column commands, the handles and menus, the seam resize, and the
  add-row / add-column chips.
- The `database` block: the inline form and the external form over the
  versioned `DatabaseBridge` contract — the ordered row wire, the
  snapshot → subscribe → replay → live bootstrap, the append-only
  per-table envelope stream (one transaction → one `seq` / `prevSeq`),
  the idempotent writes (the fresh `operationId` per op), the atomic
  mixed `batchRows`, the structured `BridgeError` codes, and the
  protocol negotiation (`describeProtocol` + the capability gate). The
  package ships the contract and the UI only — the in-memory reference
  bridge is the consumer's own implementation (the playground harness's
  `memory-bridge` directory is the reference stand); without a
  `databaseBridge` prop the external-form block renders the
  not-connected placeholder and the `/database` slash command is
  hidden. `TEXT_TYPES` (the set of the bridge column types that hold
  text) is exported from the package root.
- The `embed` / `sync-embed` blocks: the consumer's `syncEmbedResolver`
  mounts a nested `EditorProvider` over the master doc (its own
  selection and undo; the cycle guarded by the ancestor-doc chain +
  the depth limit), and the `image` block over the blob bridge (the
  consumer's `BlobStore`, the opaque `src` key, the subtype from
  `resolve.meta` — never guessed; the legacy view-only `blobResolver`
  is wrapped as a store).
- The optional subpaths with the optional peer dependencies:
  `./motion` (`framer-motion` — the drag-reorder and the row
  animations), `./mermaid` (the mermaid preview over the `code`
  blocks), and `./pdf` (`pdfjs-dist` — the first-page PDF preview, the
  worker bundled to `dist/pdf/`).
- `DocHeader` — the consumer-placed panel (rendered in the consumer's
  chrome, outside the editor): the page / canvas switcher, the
  document mode's switcher (Edit / View / Published — consumer-
  controlled over the `mode` + `onModeChange` props), the avatar, and
  the title (the inline edit commits one core command each).
- The consumer-controlled access modes and publishing: `accessLevel`
  (`viewer` / `editor`, default `editor`), `mode` (`edit` / `view` /
  `published`, default `edit`), and `publishedDoc` (the hydrated
  snapshot) on the `EditorProvider` — the consumer session state,
  never document data, never on the wire. The `viewer` stands the
  security model: the reader's browser receives only the published
  snapshot (passed as the `doc` — no live document, no sync
  transport), and an absent stand renders the "not published yet"
  placeholder; `view` is the read-only live document (the sync stays
  live); the editor's `published` renders the snapshot read-only (its
  own store and selection, static over the live edits; a new snapshot
  is a remount via `key`). Over the read-only modes the editing
  surfaces are off (the text inners, the gutter / drag / hotkeys / the
  format toolbar, the table and database chrome, the canvas sessions
  and dock, the attribute menus) and the observing gestures keep
  (scroll, the embed pan / zoom, the canvas wheel zoom / pan); the
  consecutive empty text blocks render as one (the document data
  untouched).
- The theming: the `--docblocks-*` custom properties mapped onto the
  optional shadcn standard tokens on the editor root (a themed consumer
  themes the editor automatically, dark included; the fallbacks equal
  the unthemed literals — zero visual diff without a theme), the
  optional seed `docblocks-react-ui/theme.css`, and the self-hosted
  `Inter` UI font.

### Patch Changes

- Updated dependencies
  - docblocks-core@0.1.0
