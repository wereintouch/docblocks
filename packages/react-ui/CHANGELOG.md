# docblocks-react-ui

## 0.3.0

### Minor Changes

- 5f5ab54: The presence selection's visibility over the room stands grant-gated (the
  privacy stand): the `EditorProvider`'s additive `presence` prop carries
  the local user's identity (`userId` / the optional `name`) and the
  optional `PresenceCrypto` cipher; the new `usePresenceSharing()` hook
  drives the local grant — the session-state default is **off** (the
  selection does not publish, only the light identity frame the roster
  needs), and the consumer flips it to `everyone` (the plaintext wire
  shape, the legacy stand) or to a targeted user-id list (the selection
  publishes as opaque ciphertext entries, one per grant member — the
  entries carry no target id, a recipient opens only the entry addressed
  to it, an unaddressed peer sees the sharer's identity but never the
  selection). The library orchestrates the publish gating, the receive's
  decrypt, and the per-peer sequence guard over the async decrypt; the
  cryptography and the sharing's UI are the consumer's stand (the package
  ships no built-in control). A provider without the `presence` prop keeps
  the legacy stand (the anonymous plaintext selection over the room).

### Patch Changes

- Updated dependencies [5971d30]
  - docblocks-core@0.1.3

## 0.2.0

### Minor Changes

- bcc306e: The `Editor`'s page view is now the motion row layer (the former
  `MotionEditor`'s merge): every page block is its own `Reorder.Item` row —
  the drag-reorder (one drag = one range move of the dragged block's
  derived subtree), the insert/remove's layout animation, the rendered
  list marker per row. Consumers rendering `<Editor>` get the animated,
  draggable page without a code change; the `view` / `formatPalette` props
  stand. The `MotionEditor` export and the `./motion` subpath are removed
  (the base `Editor` is the motion editor — the previous split stood the
  base entry without any reorder path, so a consumer taking it got a
  non-reorderable editor).
  
  The three peers are now REQUIRED (pre-1.0 breaking): `framer-motion`
  (the page view's row layer), `mermaid` (the `./mermaid` subpath), and
  `pdfjs-dist` (the `./pdf` subpath) lose their `optional: true` — the
  install must carry all of them. The `./mermaid` and `./pdf` subpaths'
  wiring stays opt-in (the `pdfPreview` prop / the `code` block renderer);
  the required peers guarantee availability only. The static row rendering
  stands for the table cells and the canvas's page miniature (the
  `BlockGroups`'s stand); the `BlockView`/`BlockNodeView` renderers are
  unchanged.
- d62b662: The editor's UI strings stand localized (en + ru). The language is
  consumer-driven: the package reads the `<html lang>` attribute (the `ru*`
  prefix stands the Russian stand; the absent or unknown language falls
  back to English) and follows the attribute's change at runtime. There is
  no `locale` prop.
  
  The package runs its own `i18next` instance over the shipped catalogs —
  `i18next` and `react-i18next` are new runtime dependencies — under the
  `EditorProvider`'s subtree (and the consumer-placed `DocHeader`): the
  consumer's global `i18next` singleton stands untouched, and the editor's
  `useTranslation` never conflicts with it. The English's values keep the
  former's literals as-is (the zero visual diff over the English's
  language).
  
  Not localized (the technical stand): the code language's names, the font
  family's and weight's names, the avatar emoji picker's accessible names,
  and the technical glyphs. Parameterized strings use the `{param}`
  interpolation (the single braces' stand).
- 0e798be: The page row's delete affordance: the hover's trash icon at the row's
  right edge (every page type — the text rows' own wrapper, the non-text
  rows' row-level stand over the motion view; the edit's mode only).
  The deletion was previously discoverable only through the less obvious
  path (the gutter's select + the Delete key). The click is a true
  deletion (the Delete key's image special case — the in-place conversion
  to an empty paragraph — stands for the key gesture only), the row's
  whole blocks selection is deleted when the row is part of one (the
  Delete key's gesture parity), and the gesture stands the document
  root's trailing-paragraph guarantee + the focus's parking as the Delete
  key's path (the focus never drops to the document).
- 74e0abd: Add the standalone's database's surface (the consumer's own page, not a
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

### Patch Changes

- a89733e: The external-form database's history and boundary stands:
  
  - the undo / redo's in-flight window — a forward write that commits while
    the undo's inverse (or the redo's forward) is in flight stands the
    history's invariants: the undo's path consumes the undone op (popped from
    the undo stack, not moved to the redo stack — the fresh write cleared the
    redo side, and the re-commit over the newer entry would clobber it), and
    the redo's path re-enters the op on the undo stack at the call's position
    (below the window's writes, not on top — the undo order's inversion is
    closed, the first undo reverts the newest write).
  - the operation's rejections stand the structured `BridgeError` (the code's
    retry / the clear's decision stands the first-class property, not the
    `cause`'s dig): a rejection that carries no machine code stands the
    transport-level `unavailable` (the safe recovery is the same-operationId's
    reconciliation, not a blind new operation).
  - the cell-value equality stands the element-wise comparison over the
    composite value (the multi-select's array) — the identity stand committed
    the no-op over the same content and pushed the undo entry.
  - the enum's options catalog stands the full page set (the cursor's
    continuation to the tail) over the single page's `limit: 200` — the
    truncated catalog over 200 options stood the silent-ignored delete of the
    truncated option over the commit's diff.
  - the column form's commit failures stand the logged error + the catalog's
    re-read (the partial stand over the move's second commit), the silent
    catches are gone.
- ff90f80: The external-form database stand's hardening: the bridge tables' picker
  guards the `listTables` rejection (the unhandled rejection stands the
  logged error + the empty list stand), and the hook's undo / redo drops
  the replaced entry by identity (the in-flight inverse over the history's
  mutation no longer drops the fresh entry — the double-apply and the
  stale restore are closed). The database JSDoc stands the actual
  contract: the mixed paste's description is self-contained, and the lost
  response's reconciliation is the consumer's stand over the bridge's
  `getOperationStatus` (the UI's convergence is the rebaseline).
- 590f5e7: The editor root's focus-ring stand: the root is a focus park (the
  drag's release and the gutter's delete park the focus there so the
  keyboard's input stays scoped over the editor) and is reached
  programmatically only (tabIndex -1) — the browser's default focus ring
  stood the visible ring over the whole document after a drag's release.
  The ring is suppressed (`outline: none` on the focused root); the focus
  itself stays, and the individual controls keep their own focus styles.
- a1564a2: The embed and frame's render stands:
  
  - the sync-embed's stale's dynamic stand — the ref's block removed from the
    master over the embed's mount now stands the broken's transition (the
    master's change re-stands the block to the render-time's check; the
    master's undo of the removal stands the resolved's back stand).
  - the canvas frame's window references stand memoized (the frame's drag
    re-renders the frame on every pointermove — the fresh array / Set
    references broke the window's copies' memo and re-rendered every copy
    over the drag's pass; the page-frame block's window stands the same
    stand).
  - the pdf worker's asset stands the degradation's signal: the unreachable
    worker's asset (the bundler's rewritten reference, the hosting's dropped
    asset) stands the logged warning over the silent native-viewer's
    fallback.
  - the `docblocks-core`'s peer range stands `^0.1.0` (the required peer's
    version stand over the `*` — the packages stand lockstep over the 0.x
    case, the breaking core's minor stands the range's bump over the same
    release).
- ecb2a91: The paste's markdown link re-gate stands the mid-string control's
  degrade: an href with a tab / LF / CR between the scheme's letters
  (`java<tab>script:…`) no longer passes the gate — the check runs over
  the WHATWG URL parser's full input normalization (the control is
  removed from any position before the scheme detection, the browser's
  parity). The run degrades to plain text over the unsafe href (the core's
  gate is the single stand; this package's mirror passes it through).
- d162a1a: The paste surface's hardening: the markdown paste's link stand re-checks
  the href over the core's public `isSafeLinkHref` itself at both the raw
  parse and the entity-decode pass (the trimmed form — the browser trims
  the leading C0 controls before the scheme detection, so the parser's
  mirror stands the writer's contract: the `<a href>` tag, the exposed
  entity's scheme, and the entity-hidden leading C0 degrade the run to
  plain text instead of aborting the multi-block paste over the core's
  strict mark rejection); and the clipboard's HTML serializes the mark
  values escaped (the hostile remote data's stand — the attribute break
  over the third-party paste target is closed).
- f907ee1: The editor store and the flat page derivation stand the registry's
  own-property lookups (the `constructor`, `toString`, ... names are
  unknown types, not the inherited `Object.prototype` members): a hostile
  type named by a prototype key stands absent in the page sequence (the
  cross-minor's stand — no renderer lookup over the inherited member, no
  render-error stand, the data preserved in the export), and the seed and
  the diff share one reader's posture (the store's filter and the
  `getBlock`'s own-property stand agree on the block's presence).
- ab836e5: The selector's escape stand: the three block-content lookups (the range
  extend's target, the gesture's stale-restore focus, the format
  toolbar's type-change exclude) build the `data-block-id` selector over
  `CSS.escape` — the full parity with the package's other lookup points,
  where a crafted block id (a quote / bracket) would otherwise stand a
  `SyntaxError` from `querySelector` in the keyboard / gesture handlers.
- Updated dependencies [bf92634]
- Updated dependencies [b66e45e]
- Updated dependencies [c5a38d2]
- Updated dependencies [769c12a]
- Updated dependencies [72fdfd3]
  - docblocks-core@0.1.2

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
