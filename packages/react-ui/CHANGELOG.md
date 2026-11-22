# docblocks-react-ui

## 0.18.1

### Patch Changes

- 2d9c34a: The database grid's data-keyed cell writes now build their cell maps over
  the null-prototype's map everywhere the keys stand the bridge's column ids
  (the enum column form's option cells, the multi-cell paste, the keyboard's
  clear, the write's inverse / clean / batch restore): a hostile column id
  (`__proto__`) stands the inert own entry, not the prototype's write —
  the cell keeps its value over the write instead of standing silently
  dropped.
- c71c306: The download-href gate stands the core's shared `normalizeHrefInput`
  (the duplicated WHATWG normalization regexes stand removed — the link
  href's parity). The data-keyed writes (the enum option's cell maps over
  the bridge column ids, the persisted viewport's map over the doc id)
  stand the null-prototype's maps (a hostile id stands the inert own entry,
  not the prototype's write). The table stream's at-least-once dedup set
  stands bounded (the stale check — the seq at or below the head's drop —
  protects the pruned seqs; the long session's growth is bounded).
- 28b8f34: The download-href gate over the consumer's `BlobStore` url now normalizes the
  browser's WHATWG control handling (the mid-string U+0009/U+000A/U+000D strip +
  the leading / trailing C0 / space trim) before the scheme check, in parity with
  the link-href's classifier — a `downloadUrl` carrying a control-split
  `javascript:` scheme no longer stands an anchor.
- d32aeee: The slash Frame picker's ref-cached list now tracks the root's child blocks' refs alongside the frame blocks' refs: a frame added (or reordered) into an existing surface invalidates the cache — the list re-renders over the live change while the picker stands open.
- 461e4fc: The provider hooks' misuse now throws the typed `HookMisuseError` (the
  `DocBlocksUiError` family, exported over the entry point) instead of a
  raw `Error`: an editor hook rendered outside the `EditorProvider`, or a
  block hook outside its block context, is catchable by class. The
  `./motion` subpath's references in the shipped comments stand replaced
  over the current stand (the base entry's row layer — framer-motion the
  required peer).
- 46e525a: The imperative mention chip's renderer now falls back to the `doc`'s icon
  geometry over an out-of-enum `mention` kind (the lenient reader keeps the
  wire's value as-is; the kind's mark data is stored over the write's
  validation, so a peer-written kind outside the enum stands the data). The
  block no longer crashes to its error placeholder over such a run — the
  chip renders with its label, the React's path's parity.
- 89004ef: The `./mermaid` subpath's entry now stands in the package's `sideEffects`
  list (as the `./pdf`'s entry does): the entry runs the module-scope
  mermaid's configuration, and a tree-shaking bundler over the absent
  entry could drop its side effects.
- 6c49e41: The ref-table data provider (`useRefTables`) now coalesces its live
  refreshes per entry: a bridge envelope that arrives over a running full
  page-set load marks the entry pending instead of firing a parallel load,
  and the pending re-run stands over the running load's write — a burst of
  envelopes runs the running load plus one trailing load, and overlapping
  loads never interleave their states.
- d751449: The page sequence's structural stamp (`seqStamp`) now sources a block's
  `type` change over the entry sequence: a `changeBlockType` of a root
  block (the `surface`'s filter input over the page children's derivation)
  stands the stamp's bump, so the sequence re-derives its membership
  instead of standing the stale row set until the next structural change.
- 691c46c: The `sideEffects` field now covers the base entry's top-level chunks
  (`dist/*.mjs`): the module-scope initialization (the package's own i18next
  instance + the legacy `<html lang>`'s runtime observer) stands declared
  over the tree-shaking's bundlers instead of standing reachable only over
  the subpath entries.
- Updated dependencies [2cd7f10]
- Updated dependencies [772a8a0]
- Updated dependencies [1a77fa3]
- Updated dependencies [a7610aa]
- Updated dependencies [ebe7313]
- Updated dependencies [f1f3679]
  - docblocks-core@0.8.1

## 0.18.0

### Minor Changes

- d89891d: The editor stands a top-level render boundary: a throw of the editor's
  chrome outside a block's renderer (the attributes panel, the canvas chrome,
  the row list) is contained to the editor's content with a failure note and a
  retry, so the consumer's application stays mounted. The boundary is exported
  for the consumer's own wrappers (`fallback` and `resetKey` props); a block's
  renderer keeps its narrower per-block boundary.

### Patch Changes

- dea90e3: The add-column form surfaces a failed commit's cause over its own error line:
  the bridge's refusal (an in-use enum option's delete, a failed table or column
  creation) no longer stands only in the console while the form shows nothing.
- ab7a859: The database table's row and column writes drop their late tail after the
  block's table changes: a rollback, an error note or a post-commit refetch of
  the previous table no longer overwrites the relinked grid's rows or leaves it
  loading.
- 7e0e7c5: The markdown frontmatter drops a `__proto__` key: the entries live in plain
  objects, where the assignment wrote the prototype chain instead of a value,
  so a pasted or imported header could poison the parse's record. The key never
  reaches the document's meta, and the rest of the header parses as usual.
- 16b251a: The react-ui layer stands a typed error family (`DocBlocksUiError` base +
  the `EditorProviderError`, `BlobNotFoundError`, `PdfFetchError`,
  `CanvasPasteError`, `UnknownSlashCommandError`, `UnhandledValueError`
  conditions, all exported from the base entry): the former raw `Error`
  throws of the provider's prop contract, the blob store's missing-id
  rejections, the PDF fetch's non-ok response, and the internal invariant
  guards now throw the named class — the messages are unchanged, so a
  consumer can catch by class.

## 0.17.0

### Minor Changes

- 05bd9d1: A protocol-relative link opens in a new tab with `noopener,noreferrer` (the
  `web` class — it was treated as a relative path before), and the address
  popover stores the typed protocol-relative form as an explicit `https://`
  URL. The link popover parks the editor root's focus on the commit's effect,
  so a fast gesture right after the close is not lost.

### Patch Changes

- Updated dependencies [348f4ad]
  - docblocks-core@0.8.0

## 0.16.0

### Minor Changes

- 1ca3796: The `DocHeader` avatar slot is customizable: `renderAvatarContent` stands
  the consumer's content in place of the built-in emoji / "+" render (the
  wrapper, the emoji picker, and the accessible names stay the library's; the
  read-only stands pass `editable: false`), and `hideAvatar` removes the slot
  for consumers that render the document avatar elsewhere. Without the new
  props the render is unchanged.
- c1b519d: Link editing: the format toolbar's link button and mod+k open an address
  popover over the selection (an existing uniform link prefills and can be
  edited or removed), a bare address resolves by form — a domain becomes an
  https URL, an email a `mailto:`, a number a `tel:` — and an invalid address
  stands the error. A link opens on a plain click (web URLs in a new tab with
  `noopener,noreferrer`, `mailto:` / `tel:` / relative ones in the same tab)
  and takes a context menu (open, copy the address, edit, remove). A
  plain-text paste links the bare URLs and the email addresses it carries.

### Patch Changes

- Updated dependencies [ad563a8]
  - docblocks-core@0.7.0

## 0.15.1

### Patch Changes

- f91f895: A press over a non-editable island (the mention chip, an image figure, the
  table's chrome) no longer parks the editor root's focus over the press:
  the mousedown's default (the browser's focus's move over the shared page
  editable + the scroll's pull to the press's point) is suppressed, and the
  focus stands where it stood — the parked root's focus scrolled the port to
  the editor's top over the press (the press's point moved under the pointer
  and the island's own click's handlers — the consumer's
  `mentionInteractions.onClick` — could lose the click). A self-contained
  editable inside the island (a table cell's inner, the empty cell's
  activation layer) keeps its native default.

## 0.15.0

### Minor Changes

- a8559ae: The inline meta editors (the header's title, the attributes panel's rows,
  the key's rename) follow the incoming value while the field stands: a
  pristine field reseeds over a value change from the reader (the document's
  write, a peer's edit, the consumer's own state) with the caret kept in
  place, and a typed draft stands over it — the user's text is never
  clobbered mid-edit. The commit and the Escape's cancel are unchanged.
- fb2eef9: The diagram preview's load-time view is the FIT: over the settled geometry
  (the svg's async render, the page's post-mount layout) a diagram without a
  persisted view stands whole in the frame, centered, scaled down only —
  never up. The persisted zoom / pan is the explicit gesture's state only:
  it is restored on reload and written back to the document on the wheel,
  the drag-pan, the toolbar's zoom / fit / reset presses, and it is never
  written by the load default, the peer's adopt, or the geometry's
  re-computation. A wrapper resize re-fits the diagram while no explicit
  view stands (and re-clamps the pan once it does).

### Patch Changes

- 5020597: Grouping the selected canvas figures leaves their earlier containers: the
  engine used to add the members to the new group while the old group kept
  them, so a figure stood in two containers and both markers moved it. The
  new group's creation and the leave are one transaction (one undo step, one
  wire update); an earlier group left without members stands in place (the
  empty container is a legal marker).
- fb02998: The cover tint's border stands the plain border until the cover's average
  color resolves: the tint variable lands only once the blob's read and the
  image's decode settle, and an undefined variable inside the color mix
  invalidated the whole border-color — the dark theme flashed its near-white
  text color as the frame's border over that window.
- 6d5ab1c: A press over a non-editable island inside the text (the mention chip, an
  image figure, the table's chrome) starts no cross-drag caret session: the
  session used to seat the selection on the island's line and focus the
  editable with it, which pulled the scroll port to the chip and left the
  caret away from the pressed point. A self-contained editable inside the
  island (a table cell's inner, the empty cell's activation layer) keeps its
  session.

## 0.14.0

### Minor Changes

- cdb165c: The mention chip's hover stands the link's affordance when the consumer
  supplies `mentionInteractions`: the pointer cursor and a light neutral
  background over the chip's rounded rect (3px radius, a 2px offset from
  the letters) with a 120ms fade. The editor root marks the interactive
  stand over `data-mention-interactive`, so a chip without the interactions
  stays inert (no cursor, no highlight) and the consumer's own CSS can key
  on the same hook. The chip carries the padding over the interactive stand
  only, so the hover stands no layout jump; the row keeps its plain-text
  height and the read-only modes keep the same hover (the observing
  gesture's parity). The hover background reads the new
  `--docblocks-mention-hover-background` token (the standard `--muted`'s
  mapping, light and dark fallbacks).

### Patch Changes

- 1872604: The diagram preview's viewport re-clamps over the settled geometry: a
  ResizeObserver over the wrapper and the transform layer stands the
  diagram's centering when the boxes change after the mount — the page's
  layout settles post-mount, and the mermaid svg lands asynchronously, so
  the mount-time clamp measured the loading skeleton's box and left the
  view unclamped (a diagram narrower than the column stood against the
  wrapper's left edge; a tall one kept the same stand until an unrelated
  change re-ran the clamp). The re-clamp stands the canonical view, so
  nothing lands on the wire on load (the identity's attrs stay the null
  idiom); the gestures, the fit, the reset, and the persisted view's
  restore are unchanged. A tall diagram now stands centered from the first
  settled frame, with no gesture or scroll.
- c6a123b: The text surfaces carry the long word's break themselves
  (`overflow-wrap: break-word`): the editable region gets the browser's
  editing default, and the read-only modes inherit nothing of it, so a long
  word in a fixed-width table cell wrapped in the edit mode and spilled
  across the cell's edge onto the neighbor over the view and published
  modes. The break now stands on the text block's inner, the cell's own
  content layer, and the cell's activation layer — the same wrap in every
  mode. User content only: the chrome is untouched.

## 0.13.0

### Minor Changes

- 8c597ab: The canvas's created and pasted figures join their container: a shape or a
  canvas-text whose centre stands inside a container's box becomes a member of
  the top-most such container in the same transaction as the insert — one undo
  step — and leaves every earlier owner, so a figure never stands in two
  containers. The dock's placement tools, the ghost text block's entry, the pen
  stroke, and the paste path stand it; the container, the frame and the
  connector never join automatically, and a pasted fragment's own members keep
  the fragment's membership (only the fragment's top-level figures join the
  target container).
- 916a2a4: The canvas's drill-down reaches the objects covered by another one: the Alt
  press steps the stack of the objects under the point (from its top, wrapping)
  and the plain repeat press steps the same way over a click — a drag still
  moves the pressed object. The session is positional (the stack is recomputed at
  each press, the clicks near the previous point step on), a camera or tool move
  drops it, and a transient `i / N` chip at the click point names the selected
  candidate's position (the touch tap steps over the wider radius). The Alt
  press suppresses the double-click's inline entries, and on touch the inline
  edit's entry stands off right after a step.
- c5d44f6: The canvas's Escape drills up: a single selected member stands its parent
  container selected — the top-most owner by the paint order, the innermost over
  a tie — one level per press, a local view state's step (no write, no wire
  update). The active states cancel first: an in-flight tool, session or
  drill-down step stands off, and only the clean state walks the containers.
- b8e3dc9: The canvas's frame stands a first-class z-order element: the `frame` type
  joins the surface's canvas elements' z-order (the explicit `zIndex` over
  the frame's registry spec, the `setZOrder`'s reorder over the frames, the
  dense mirror's normalization / the strict validation's parity), and the
  frame's render's view-back's pin stands off — the paint order is the
  surface's children's order over every canvas type (the frame stands its
  data's slot; the legacy documents' frames stand their existing slots — no
  migration). The selection's toolbar stands unified over the canvas's types:
  the single `group` (the container) / the single `frame` selection renders
  the standard arrange's toolbar (the z-order's menu — the bring-forward /
  to-front / send-backward / to-back's picks, one `setZOrder` each, the edge
  states disabled) — the same mechanism over the shapes (the container and
  the frame carry no style attrs of their own, so the menu is the toolbar's
  whole content). The strict validator's all-or-nothing invariant now spans
  the frame (the load's path is unchanged — the snapshot's normalization
  runs before the validation; a pre-upgrade snapshot validated directly
  stands the frame's index's gap over the strict's read).
- ddf1773: The canvas's block press stands on one hit resolver over the geometry instead
  of the DOM's paint order. The press zones are the shape's box (a figure set to
  no fill stands its outline's band, an invisible figure its box), the
  canvas-text's box, the container's and the frame's border band — their
  interiors pass the press through — and the connector's stroke band along the
  rendered route (the straight / orthogonal / curved variants over the resolved
  endpoints, the same geometry the label's inline edit reads). The tolerance is
  screen px, so the bands keep their on-screen reach at any zoom, and the
  drill-down's candidate stack follows the paint order with a member lifted above
  every container that lists it.
- d8e22ce: The canvas container / frame title chips stand over the screen layer above
  the world's paint order: a filled figure painted over the box — the chip's
  own seat above the box's top edge included — no longer takes the chip's
  press, so the covered container and the frame stay selectable and movable
  by their chips. The chip keeps its on-screen size at any zoom (the seat is
  the live box's screen projection: it rides the in-flight move / resize
  preview and the camera) and renders only over the viewport's culled-in
  items; the read-only modes render it inert. The chip's press keeps the
  item's contract (the shift toggle, the multi-selection's group drag, the
  focus park, the pointer capture), and its double-click enters the title's
  inline edit through the chip's own block identity.
- bd6a97a: The consumer-owned description contract (the `docDescription` provider
  prop): the description stands out of the document's data — the
  consumer's store is the source (the document never stores or syncs it),
  and the panel's `description` row displays the passed value and reports
  the user's edit over the `onEdit` callback (the panel's inline editor's
  commit — the entered string verbatim; the empty string stands the
  removal's stand — the consumer clears its store over the callback; the
  row's removal's affordance stands over the non-empty's value and commits
  the empty string's stand). Without
  `onEdit` the row stands display-only (over the edit mode too). Over the
  prop's presence the row stands out of the `renderAttribute`'s reach
  (the consumer's value is the source). Without the prop the row keeps the
  built-in stand (the value over the doc's `attributes.description`
  record); the legacy's stored `attributes.description` stands inert over
  the prop's presence (the migration's read over `doc.meta.attributes`),
  and the frontmatter's import keeps writing it (the data's stand — the
  panel is decoupled).
- 2c001eb: The canvas shape tools' dock placement creates shapes with the neutral
  default fill (`#e9ecef`): a new figure has a modest body (the
  Miro/Figma look) instead of a stroke-only figure, and the fill palette
  is the override (the explicit "none" entry keeps the stroke-only
  annotation frame). The pen's stroke (the `points` path) is created
  without a fill (its path renders the stroke only); the hit model is
  unchanged (an absent fill is a normal figure, the explicit "none"
  keeps the outline zone). Existing documents are untouched (no
  migration — the default applies to the placement only), and the dark
  theme applies the hex's dark neutral value at render (the data keeps
  the source hex).
- 531a656: The view mode's text stands selectable and copyable: the read-only live
  document keeps the native selection over the page (the editing surfaces
  stay off — no caret, no write), and the editor's copy payload serves it —
  the same to-html/to-text serialization as the edit mode's (the marks, the
  `@label` mentions, the cross-block ranges). The published stand keeps the
  selection's ban: no range, no copy (the reader's stand on the rendered
  page only). The editor root carries the resolved mode over the new
  `data-mode` structural hook (`data-readonly` stays for both read-only
  stands); the canvas world keeps the no-select stand over the view mode
  (the native range would fight the pan's drag).
  
  A native table block now copies as a spreadsheet's grid: the html flavor
  carries a real `<table>` (the rows and the columns in the table's own
  order, a cell's line breaks as `<br>`) and the plain flavor the TSV — the
  pasted cells land in a spreadsheet's grid instead of a column of lines.
  The table's covered cells stand the copy's unit (a partially covered
  endpoint cell is included whole), the block's own selection (the row's
  gutter press) copies the whole grid, and the table pieces stand in place
  over a cross-block range (the surrounding blocks keep their lines).

### Patch Changes

- 803c2be: The canvas view's culling no longer thins the surface's siblings' block
  context: the off-viewport items' keep set stands the rendered wrappers
  only, and the connector's endpoint resolution stands the surface's full
  children over their committed geometry. A connector whose endpoint block
  is off-viewport (out of the culling's margin's band) stood dropped
  (`data-missing`, the line's no render) with the label chip orphaned —
  the line now stands drawn over its visible spans (the line's own cull
  box over its endpoints' boxes' union still decides its mount), and the
  label chip's midpoint's read stands the full list (no culling-induced
  drop).
- 9b16229: The canvas culling's margin stands the screen px over every zoom (the
  1/zoom's world's conversion in the visible world rect's math): the
  band's on-screen width stands constant (300 px), so the off-viewport
  items pop in over the pan's edge at a constant on-screen distance
  instead of shrinking over the zoom (the 75px stand over the 25% fit).
  The tradeoff: the band stands wider over the world at the low zooms —
  the heavy canvas's mounted DOM grows over the zoom-out (the culling's
  performance stand's documented cost).
- a8a7bdc: The canvas frame's interior stands pointer-transparent: a press inside the
  frame's box reaches the figure under it (the page miniature over the empty
  region), so the region marker no longer shields the figures it covers. The
  frame keeps its own press targets — the boundary's border's hit band and
  the title chip — which select the frame and start its move, the container's
  idiom's parity.
- 754a210: The canvas's world-space strokes stand the min-screen stand: the
  connector's line and the shape's border read the data's width over the
  1/zoom's compensation (the CSS `max()` over the world's inverse-zoom's
  variable), so they stand at least 1 screen-px wide over the zoom's < 1
  (the dark data color's sub-pixel thinning's fix — the dark line over the
  dark canvas no longer falls below the visibility threshold at the fit's
  zoom). The zoom's >= 1 stands the data's verbatim (the line's
  thickening's parity), and the data's stand stands the `stroke-width`
  attribute (the render's compensation is the style). The stand resolves
  natively over the zoom's flip (the no per-item re-render's stand).
- 2f51dfa: The canvas view's entry stands the fit over the stale stored viewport:
  the restored zoom / pan's rect over the content's box — the empty's
  intersection (the off-document's pan's stand: the storage's drift over
  the content's / the container's size's change) stands the fit (the fit
  button's stand), the partial's intersection stands the restore (the
  zoomed-in's stand — the visible's rect over the content's box — is
  kept). The empty canvas's stand (no content) stands the restore (the
  fit's no-op's parity).
- Updated dependencies [b8e3dc9]
  - docblocks-core@0.6.0

## 0.12.0

### Minor Changes

- 086e514: The canvas figure's fill stand over the themes (the render-time's transform,
  no document data change): the light theme stands the fixed-hex fill verbatim
  (import fidelity), the dark theme stands the light fixed fill darkened (the
  dark corridor — the hue kept, the lightness over the dark, the saturation
  reduced; dark fills pass through; palette-token fills are unchanged in both
  themes). The figure text without an explicit `textColor` resolves the
  contrast against the effective fill (black or white by the better WCAG
  contrast; an explicit `textColor` always wins). The dark-class flip
  re-renders the figures with no wire writes and no document-state mutation;
  the strokes pass through unchanged.
- 43e2183: The canvas figure's stroke and the connector's line color stand the same
  themes' transform as the fill (the render-time's dark corridor): over the
  dark theme a light fixed-hex `stroke` (the shape's border) and `strokeColor`
  (the connector's line, the arrowheads, and the label chip's frame) stand the
  darkened's value; dark values and the theme tokens pass through, and the
  light theme stands the data verbatim. The document keeps the source hex (no
  wire writes, no persistence).
- d97a429: The floating format toolbar's color palette (the text's `color` / the
  background's `highlight` target) stands the reset's affordance: a cross
  button after all the palette's swatches clears the active target's mark
  (`unsetMark`). The other palettes (the callout's background, the table's
  handles, the canvas's fill / stroke) keep the transparent's "no color"
  swatch.
- acb03c6: The mermaid diagram preview's viewport (the `./mermaid` subpath): the diagram now renders over a pan/zoom viewport — the `ctrl`/`cmd` + wheel's zoom at the cursor (0.25–4x), the plain wheel's vertical pan, the drag's pan, and the hover toolbar (zoom in / out, the percent label, the fit-to-view button, the reset) over the diagram. The fit stands the diagram into the visible viewport (capped at 100% — the small diagram stands its natural size, centered); the reset restores the default view. The view persists over the code block's new optional `zoom` / `panX` / `panY` attrs (the null idiom — the reload restores the view, the panes share it over the wire; the persisted coordinate stands the clamped stand — the sub-wrapper content's centering offset is the identity's canonical coordinate, so the peer's adopt stands the no-write parity). The bottom-edge's resize (the editing mode's stand) stretches / clips the diagram's height over the new optional `height` attr (absent = the diagram's natural's height — the auto's stand; the drag's linear stand over the pointer delta, the keyboard's step per press). The attrs are additive over the `code` block's schema; the code mode stands the attrs inert.

### Patch Changes

- The shape and canvas-text toolbars' text color section stands the reset's
  cross — the none's button over the row's tail (the after-all-the-colors'
  position, the page's format palette's parity): the active stand over the
  `textColor`'s set, the inert stand over the unset color (the pick is a
  no-op). The pick removes the `textColor` attr over the core's
  `removeBlockAttr` (one transact, one undo step) and returns the text to
  the no-color's stand — the contrast's resolution over the effective fill
  (or the theme's foreground when the fill stands none) — in the shape and
  the canvas-text alike. The color's sections keep the transparent swatch's
  none over the fill / stroke / line / label palettes (their data's "none"
  stand) — the cross is the text color's affordance only.
- 049735e: The canvas-text's figure stands the side insets from the box's edges
  (the shape's text's padding parity — the rect's 8 px x): the item's
  wrapper carries the horizontal padding inside the box (the border-box's
  stand — the selection's frame and the item's geometry are unmoved, the
  text's wrap width stands the inset's width). The double-click's ghost
  stands the same inset (the commit's visual continuity — the typed text
  stands where the committed text stands).
- 64abd94: Improved the canvas view's re-render contract for large canvases (several
  thousands of figures and connectors): the viewport state (the in-flight
  session's previews — the move / the resize, the connector endpoint's
  drag, the keyboard focus) stands in a per-view zustand store, and the
  canvas items / connector lines / port dots / label chips subscribe to
  their own narrow slices (a pointermove re-renders only the items and the
  lines the preview touches, never the resting surface). The surfaces'
  chrome re-render keys over a structural chrome stamp (a content-only
  change stands no re-render of the chrome). The off-viewport items stand
  no DOM of their own (the viewport's culling over the visible world rect
  + the 300px margin — the off-viewport figures / connectors mount / unmount
  over the pan's bring-in / take-out; the in-flight session's items stand
  un-culled). The canvas view's module set stands split by responsibility
  (the world assembly, the world-space overlays, the screen-space chrome,
  the selection's overlay, the per-line / per-item math).
- 9efe1d4: Fixed the code block's caption line losing the focus (and the empty line
  unmounting) over a press of the caption's button while a caret stood in
  the code: the page container's stranded-caret re-seat mistook the form
  control's focus residue (the document selection standing a collapsed caret
  at a container position while the input holds the focus) for a stranded
  caret and re-seated it into the block on every frame, blurring the
  just-seated input. The re-seat now stands no while a form control inside
  the container holds the focus (the control's landing stands a genuine
  one).
- de984b6: The code block's copy button now copies the `text/html` payload (the `PRE`
  over the code's child, the `language-*` class on the `code` element) plus
  the `text/plain` fallback — the paste into a text block materializes the
  code block verbatim through the rich pipeline (the plain payload's
  markdown pipeline stood the distortion: the newlines collapsed, the
  indentation lost, the markdown-flavored lines re-blocked — the `---` to
  the divider, the `# x` to the heading, …). The rich pipeline now reads
  the `language-*` class back over the `PRE`'s materialization (the
  language's round-trip's stand — over the `PRE`'s own class or the
  `code`'s child's, the producer's convention's positions); the paste into
  the code block keeps the plain payload's stand (the `plainWins`'s gate),
  and the external apps receive the plain fallback unchanged (the legacy
  engines without `ClipboardItem` stand the plain write).
- 7b7917c: The link's click over the edit's mode: the browser cancels the anchor's
  navigation default inside the contenteditable (the caret's seat stands),
  so a clicked link stood dead — the editor now opens the href itself over
  the new tab's stand (`noopener,noreferrer`, the `window.open`'s
  gesture's call) — the edit and the view's modes stand the same contract
  (the reader's same-tab's carry-away's off), the editor's state stands
  untouched (the caret's seat and the focus are the mousedown's default's
  work — preserved; no write, no navigation). A press-drag over the link
  (the selection's gesture) stands no open (the down/click distance's
  guard); the modified clicks and the middle-click stand the browser's
  native stands; the rendered anchor stands `rel="noopener noreferrer"`
  (the native open's security's parity).
- Updated dependencies [75e6caa]
- Updated dependencies
- Updated dependencies [acb03c6]
  - docblocks-core@0.5.0

## 0.11.0

### Minor Changes

- 14cf58a: The cover's frame's tint (the `coverTint`'s attribute — the absence's
  default's on, the explicit's `false`'s off over the attributes panel's
  checkbox's row, which stands over the cover's presence like the mode's
  row): the editor's card's border mixes the cover's alpha-weighted
  average color with the theme's border token (the `color-mix`'s 25%
  share — the light's theme's pale's stand, the dark's gray's stand over
  the same average's value; the theme's flip stands the re-mix without a
  re-read). The average's read decodes the cover's blob over the `img`'s
  element (the SVG's parity — the `createImageBitmap`'s SVG rejection's
  stand) and weighs the alpha's share per pixel (the transparent's stand
  no gray's pull). The `useCoverAverageColor()`'s hook exports the same
  average's color (the `rgb(...)`'s string or `null` over the absent's /
  the undecodable's stand) — the consumer's own chrome's data's source
  (e.g. the glow's stand over the editor's surroundings — the consumer's
  CSS, the package's DOM ends at the card).
- c4911e9: The cover's upload modal's preset gallery (the `coverPresets` provider
  prop): the consumer's ready-made cover's file ids (the consumer's blob
  store's ids — the same ids the store's `get` resolves) per placement
  mode (the `tile` / the `center`'s set, each optional). The modal
  renders the current mode's set over the 4-column's scrollable grid (the
  visible's 3 rows' cap — the overflow scrolls, the 4-column's width
  stands; a set over 12 ids scrolls, a shorter one stands the fewer
  rows). The mode's switch stands the set's switch over the same grid,
  and a pick commits the id over the mode WITHOUT an upload (the upload's
  gate never runs over a preset — the consumer's catalog's curation's
  stand; the thumbnails resolve over the store's `get`, the placeholder
  over the loading / the missing's stands). Without the prop the grid
  stands absent and the modal stands the enlarged's base's stand (the
  former's 400 px's width stands the 440 px's, the drop zone's height the
  112 px's over the 144 px's).
- d1cb23e: The cover's upload stands the modal's stand (the placement mode's selector
  over the tile / the centering, the drop zone's drag-and-drop + the click's
  picker over the strict's png/jpeg/webp's accept, the mode's rule's info,
  and the rejection's hint). The cover renders as a banner over the editor
  frame's top edge (the full frame width's bleed, the frame's top corner's
  clip, the bottom's 16 px's fade-out over the smooth's ease-out's curve — the
  fixed's package's stand; the image's slightly dimmed stand over the dark
  theme). The
  tile's mode stands the strip scaled to the fixed's 150 px's height (the
  width's proportional, the `repeat-x`'s horizontal glue over the narrow's,
  the centered's side crop over the wide's), and the centering's mode stands
  the width scaled to the frame's width (the height's proportional) over the
  centered's 150 px's vertical slice (the narrower's scaled height stands its
  own). The placement mode stores over the new `coverMode`
  document-attribute key (the "center"'s stand — the tile's stand is the
  key's absence), with the panel's mode toggle row over the `cover` row — the
  toggle's switch stands gated: an option stands disabled when its gate is
  known unmet over the current image (the centering's editor width's minimum,
  the tile's 150 px's minimum height). The upload's gate stands per mode: the
  150 px's minimum height over the tile, the editor width's minimum over the
  centering (the rejected file's bytes never reach the blob store).

### Patch Changes

- e4c240a: The cover's upload gate: the image's intrinsic height is checked over
  `createImageBitmap` before the upload — a cover shorter than 150 px is
  rejected (the upload never reaches the consumer's blob store; the inline
  hint stands the threshold, and the next attempt clears it), and an
  undecodable payload stands the fail-open (the upload proceeds).

## 0.10.1

### Patch Changes

- 9188b14: The attributes panel's polish: the label column stands the longest
  locale key (the Russian's published-date key — the `w-32`), the rows
  stand a 4 px gap over the former padding, the row's minimum height
  stands dropped (the rows hug the values' band), the "Not set"
  placeholder stands the values' font and the column's left edge over
  every row, and the `publishedAt` row is display-only (the value is
  consumer-owned — the panel's edit entry and the row's removal stand
  removed, like the `status` row; the
  `docblocks/attributes-published-at` slot now marks the display span).
- 985c50f: The color pickers stand one shared mechanism (the canvas's palette's
  parity): the circular swatches over the shared `ColorSwatches` with the
  custom rainbow's swatch + the hex's input, and the trigger's preview over
  the shared `ColorChip` (the current's color, the hollow's stroke over the
  stroke's attrs, the `X` over the absent).
  
  - The callout's menu: the native `input type="color"`'s picker stands
    removed. The custom color's commit stands over the hex's field (the
    Enter / the blur over the valid value); the close over the uncommitted
    draft discards it (the canvas's Esc's parity — the former's
    commit-on-close's scrub stands no stand). The
    `docblocks/callout-color-picker` slot now marks the hex's input.
  - The table's row / column background: the own square swatch's grid stands
    removed over the shared's palette (the subcontent's slot
    `docblocks/table-color-palette`); the conditional `Remove background`'s
    item stands removed — the shared's none's swatch
    (`docblocks/palette-none`) is the clear's mechanism. The handle's menu
    closes over a swatch's pick (the palette's buttons stand no Radix
    item's close of their own).
  - The page format toolbar's color trigger stands the current's color's
    chip (the mark's hex; the `X` over the absent / the mixed's range).
  - The `ColorChip`'s primitive (the `docblocks/color-chip`'s slot) is the
    shared's trigger's preview.

## 0.10.0

### Minor Changes

- d51bd43: **Consumer-owned tags: the `docTags` contract (the document's no-storage's
  stand).**
  
  The `tags` row of the document-attributes panel no longer reads or writes
  the document's `attributes.tags` record: the tags are never document data
  (a consumer that stores its tags in its own database no longer races the
  document's copy). The consumer passes the tags over the new `docTags`
  provider prop and the panel displays the passed list and reports the
  user's tag actions:
  
  - `docTags.tags` — the document's tags (`{ id, label }[]`; the
    consumer's type may extend it — the extra fields stay opaque);
  - `docTags.onTagAdd` — the add affordance's click (the consumer opens its
    own creation's UI — the tag's picker over its catalog, the creation's
    flow; the package opens nothing);
  - `docTags.onTagRemove(tag)` — the chip's removal (the consumer removes
    over its own store and passes the updated list back over `tags`);
  - `docTags.onTagClick(tag, event)` — the chip's click (the native
    `MouseEvent`; the package opens nothing and preventDefaults nothing —
    the navigation's stand is the consumer's); it stands over the read-only
    modes too (the observing gesture's parity).
  
  **Breaking (the 0.x's minor's stand)**: the `tagEditor` provider prop (and
  its `TagEditor` / `TagEditorProps` types, exported since 0.9.0) is removed
  — its contract committed the list into the document (the
  `onTagsChange`'s `setAttribute`), which the consumer-owned stand
  supersedes. A consumer on 0.9.x migrates over the `docTags`'s contract
  (the chips' display stands unchanged); the legacy's stored
  `attributes.tags` data stays readable over `doc.meta.attributes`
  (migration's read) and the markdown frontmatter's import keeps writing it
  (the data's stand — the panel is decoupled from the record).

## 0.9.1

### Patch Changes

- 942538d: **A paste over the full document selection replaces the selection instead
  of wiping the document.**
  
  Over the range the seam's absence (the whole-document delete stands no
  seam) previously dropped the paste payload and cleared the document of all
  blocks with no undo restore and an unplaceable caret. Now, when the
  selection's delete consumes the whole document and no seam remains, a
  fresh empty paragraph is inserted at the root as the paste seat and the
  payload materializes into it (one transaction, one undo step); a
  whitespace-only full paste leaves the editable empty seat. Partial
  cross-range pastes are unchanged.
- 19ba6b7: **Keyboard gestures over cross-block ranges: the continuation's stands.**
  
  - **Shift+ArrowUp/ArrowDown now chains over the cross-block range** — the
    former stand collapsed the selection on the second press (the browser's
    anchor read-back flips over the editor's backward cross seat, and the
    continuation re-based the range over the far end). The editor now owns
    the vertical extension over the cross range: the moving end stands the
    selection's direction (the user's anchor's identity), a single-line
    block's end crosses to the adjacent text block (the non-text siblings
    skipped, the empty blocks' stand), and a multi-line block's inner line
    keeps the browser's native line walk.
  - **Ctrl/Meta+Home and Ctrl/Meta+End seat the caret over the document's
    edges** (the first text block's start, the last's end) and scroll the
    caret into view — the browser's native stand degenerates over the
    page's nested editables (the Ctrl+Home's no-move's stand).
  - **Ctrl/Meta+A stands over the read-only modes too** (the view /
    published's document zone — the former stand let the browser's
    select-all take the consumer's whole page).
- d4e76ab: **Editor selection gestures: the native stands.**
  
  - **Ctrl/Meta+A now selects the whole document** over the page's nested
    editables, where the browser's own select-all degenerates (the Chromium's
    stand: a collapsed caret at the document's end instead of the full
    selection). The editor seats the whole-document selection itself (the
    first text block's start to the last text block's end, the cross-block
    range the copy/paste/delete's cross paths stand over); form controls and
    the canvas view keep their own select-all.
  - **A click-then-Shift+click extends the selection across the blocks** —
    the browser's native shift+click extension stands (the former stand tore
    down the session and suppressed the default, which killed the native
    extension and let the focus fall to the document body).

## 0.9.0

### Minor Changes

- 6b1f954: The collapsible document-attributes panel over the editor page column
  (collapsed by default, session-only state): the system rows (id /
  created / last updated, read-only — the dates stand the locale's
  medium date, the id over the monospace), the preset rows (description,
  tags, the `createdBy` creator reference (the id-only mention, display
  over the consumer's resolution), cover, the `status` stand
  (display-only — the consumer's own data, the panel's editor stands
  absent), published date) with the inline editors, the custom
  attributes (the add's flow over the list's tail's button — the popover's
  one-line sliding-pill type pick (the document view's selector's parity
  
  - the light bounce's animation) + the name's draft (the `Name`'s
    placeholder) + the commit's button over the input's right (the disabled
    over the empty name); the `ATTRIBUTE_TYPES` enum over the type's
    vocabulary; the mention's name stands the target's id; the custom
    value's edit over the row's zone — the string / number / mention inline
    inputs over the typed form's write-back (the invalid number's no-write),
    the list over the vertical's line editor (each item over its own line —
    the line's input + the ×'s removal + the "Add a line"'s input over the
    stack's tail; every discrete change commits the whole list over the
    value's form: plain `string[]` → plain, typed → typed; the read-only's
    stacked display; the row's key + the remove button stand opposite the
    first line over the stack (the row's center stand dropped)), the boolean over the project's checkbox (the checked's
    toggle — one write over the value's form: the plain's plain stand, the
    typed's typed stand; the read-only's disabled stand over the view /
    published's modes); the row's value zone centers its content vertically
    (the page's inherited line-height no longer stands the value's text
    above the label's center — the value's "jump" stand dropped) and the
    single value's rows stand the uniform height (the row's `min-h` — the
    checkbox's row's shorter stand dropped), the custom key's rename over
    the key's click (the inline input over the key's column — the
    select-all's mount stand, the Enter / the blur's commit over the
    `renameAttribute`, the Escape's cancel, the invalid target's (the
    reserved / the taken key) open stand over the `aria-invalid`'s
    destructive frame, the preset / the system rows' and the read-only's
    no-entry stand), the tags' add input stands the
    value column's font size (the placeholder's `text-xs` stand over the
    `text-sm`'s column's parity), the custom rows' display order
    (the preset rows' fixed order; the custom rows over `attributesOrder` —
    last-added last, drag-reorderable over the grip with the block's
    grip's offset parity: the hover's reveal, the framer's live slide's
    preview, the release's `reorderAttributes` commit over the wire, the
    undo's single step, the no-move release's no-op stand), and the
    consumer's `hiddenAttributes` + `tagEditor` + `renderAttribute` +
    `attributeTypePicker` provider props. The `renderAttribute` callback replaces a row's value
    zone over its key (the `null` / the absent stands the built-in); the
    `attributeTypePicker` component replaces the built-in type picker over
    the add flow. The panel's in-row fields (the tags' add input, the
    list's line / the new-line inputs, the key's rename input, the typed
    value's inline edits) all stand the shared `Input` primitive over its
    new flat `inline` variant (the frame / the background / the shadow
    stand off — the focus's border stand only), replacing the ad-hoc raw
    inputs; the custom key's text stands the label column's left edge
    (the preset's keys' parity — the key's button's padding stand
    dropped), and the list's row's drag grip stands opposite the first
    line (the key's line — the row's center stand dropped over the
    stack's rows); the rename's input's frame stands the text's edge's
    left (the text's position's keep over the display's parity — the
    frame's no-glue over the text's left stand; the label column's clip
    stands off over the edit mode — the frame's / the band's overhang's
    visibility stand, the display's truncate's parity untouched). The
    panel's hover stands one style and one height (the rows' bands — the
    key's, the value's, the description's, the published date's — stand the
    28px's band over the 6px's glyph's inset, the key's band's stand over
    the label column's edge's left (the text's column's edge's parity
    kept); the icon's buttons (the row's removal, the cover's) stand the
    same hover's stand). The
    `AttributesPanel` stands the composition over the unit's
    row files (the `CustomAttributeRow`'s custom row, the preset's
    editors, the add's popover, the value's pure reads). Markdown import and paste now read the YAML-frontmatter
    subset into the meta over the fresh documents (the title + the mapped
    attribute presets — the `author` / `created_by` keys map to the
    `createdBy` id-only reference) and strip it before the blocks parse; the
    HTML import keeps the frontmatter as a plain paragraph.
- f5d29df: The `@` mention's contract updates:
  
  - The mention mark is id-only (the pick writes the `{ kind, id }`
    mark; the `mentionInteractions` target stands the identity — the
    label is the consumer's resolution).
  - `MentionProvider` gains the optional `resolveLabel(kind, id)`: the
    chip's live label over the target's id (the rename's stand); the
    insertion-time label (the run's text) / the legacy snapshot stand
    otherwise.
  - The mention query is the whole `@`-to-caret phrase: the space is
    part of the query (`@my doc` searches `my doc`), and only Escape
    breaks the phrase (the former word-boundary close is removed).
  - The pick seats the caret after the chip: the chip is a
    `contenteditable=false` island, and a flat offset over it snaps to
    the adjacent slot (never the chip's text) — the type's
    continuation keeps the focus without a re-click.
  - `mentionInteractions` gains the optional `renderEmptyState(query)`
    (the picker's empty state; `null` stands the built-in "No
    matches").

### Patch Changes

- e0c7167: Fix the sliding-pill segment selector's stand over an ancestor transform:
  the active-button geometry now stands the scale factor (the
  `getBoundingClientRect`'s delta and size over the untransformed layout's
  factor), so the pill's measurement over a transformed container — the
  popover's `zoom-in-95` entry's frames — stands the list's local
  (untransformed) geometry. The pill no longer stands off (shifted toward
  the group's start, sized under) over the later options' stand when the
  selector's container mounts over an entry animation; the end position
  stands exact over the animation's frames.
- Updated dependencies [6b1f954]
- Updated dependencies [f5d29df]
  - docblocks-core@0.4.0

## 0.8.3

### Patch Changes

- e207327: The database grid's datetime cell commits the draft (the picked date + the
  typed time) on Enter over the open picker and closes it, and Escape cancels
  the in-flight draft without a write; the close over the outside press / the
  trigger press / the session's teardown keeps the deferred commit stand.
- d6d6c7a: The filter builder's date-and-time value picker (the shared
  `DateTimePicker`) stands the same key contract as the database grid's
  datetime cell: Enter commits the draft (the picked date + the typed time)
  and closes the picker, Escape cancels the in-flight draft without a
  write; the close over the outside press / the trigger press keeps the
  deferred commit stand.

## 0.8.2

### Patch Changes

- 94f3f9a: **fixed:** the 0.8.1's filter's date/datetime's pickers' entry's code
  lands — the filter value's `DatePicker` / `DateTimePicker`'s stand over
  the raw's native's inputs (the 0.8.1's published build stood the raw's
  inputs — the code's commit landed over the 0.8.1's release's cut).

## 0.8.1

### Patch Changes

- ce42093: **fix:** the HTML paste and the whole-document import keep a bare `br`
  between the block's text nodes as the soft line break (the `htmlToBlocks`'
  edge whitespace drop no longer erases the line break — the non-browser
  serializers stand the `<br>` between the blockquote's text nodes without
  the `p`'s wrapper).
- **changed:** the database's filter value's date / datetime stand over the
  house's `DatePicker` / `DateTimePicker` (the raw's native's `<input
  type="date">` / `<input type="datetime-local">`'s stands are gone — the
  commit stands the cell's same wire's format: the "YYYY-MM-DD" the
  midnight's zero, the "THH:MM"[:SS] over the time's; the datetime's
  commit stands on the popover's close).

## 0.8.0

### Minor Changes

- 4e4eb46: The headless whole-document import: `importDocument(doc, source, kind)`
  (`kind: "markdown" | "html"`) fills a FRESH document (the empty root) from
  a markdown or HTML payload — the consumer-side pre-attach write (the
  content stands in the first full-state bootstrap the attach sends, so the
  first wire sync persists it). The parsed blocks materialize over the paste
  parsers' shared insertion in ONE `doc.transact` (one undo step, one wire
  update). The indents stand the parser's absolute nesting (there is no caret
  to re-base to) over the sequence's jump-rule clamp (the first block anchors
  at indent 0; the rest are capped at the predecessor's +1 — the parser's
  dropped-parent gap cannot roll back the import). An empty (or
  whitespace-only) payload is a no-op (nothing is written, no transaction);
  a non-fresh document (the root already has children) throws the typed
  `ImportDocumentError`. The paste path is unchanged.

## 0.7.0

### Minor Changes

- 2b1fdb0: The blob store's meta-only stand: the two optional `BlobStore` members
  `getMeta(fileId)` (the metadata WITHOUT the bytes — the cheap head stand)
  and `downloadUrl(fileId)` (the direct download URL). With them, the
  built-in `file` / `image` blocks resolve the metadata first and fetch the
  bytes only for a MIME they render (the PDF preview / the `<img>`); any
  other MIME stands the download card without fetching the bytes (no `get`
  call, no object URL — the download's href stands the consumer's
  `downloadUrl`). Without `getMeta` (or without `downloadUrl`) the blocks
  keep the legacy stand exactly (the bytes over `get`, the object URL's
  href) — existing consumers and `createMemoryBlobStore` are unchanged.
- bad9923: The mention chip re-stands as plain text: the kind's inline icon (the
  `user`'s person, the `doc`'s exit arrow) over the semibold, underlined
  label — the rounded pill stands removed, so a mention row keeps its
  plain-text height. The chip gains the `data-mention-id` attribute (the
  target id for the consumer's live-label / "removed" stands), and the
  `--docblocks-mention-background` token stands removed (the chip no longer
  paints a background).

### Patch Changes

- 6ad393f: Filter popover fixes: the segment selector's active button no longer
  restyles its label over the pill's fill on hover (the ghost button's
  hover restyle washed the label to an unreadable color over the primary
  fill). The filter popover's condition/group add rows and the clear/apply
  footer keep a clear break (the popover's own 10px rhythm over both sides
  of the separator).
- 7b444ee: The new optional `mentionInteractions` provider prop
  (`{ renderCard, onClick? }`) stands the mention chip's interactions
  (independent of the `mentionProvider` — it works for any mention in the
  document): the hover card — the consumer's content and design over the
  package's portaled host (the position and the lifecycle are the
  package's: the hover's open delay, the exit / Escape / scroll's close, and
  the anchor chip's removal's close) — and the chip's click delivery (the
  native `MouseEvent` to the consumer's `onClick`; the package opens nothing
  on the click and stands no default behavior). The target stands the
  document's `mention` mark (the core's `MentionMark` — re-exported for the
  consumer's convenience). Without the prop the chip stands as before (no
  card, the click is the browser's stand).

## 0.6.6

### Patch Changes

- f730bec: The slash File command's pending upload stands the phrase block's skeleton (the spinner's rotation over the picker's open and the in-flight upload) over the closed popover instead of the menu's item stand; the refused upload's error line stands in the skeleton (the stand's click dismisses it) and a cancelled picker clears the stand over the page's focus.

## 0.6.5

### Patch Changes

- 7ebb9b4: The file and image blocks stand the placeholder's loading state (the spinner) over the in-flight blob resolution and the static placeholder over the rejected id; the slash File command stands the upload's spinner over the in-flight upload and the failed stand's error line over a refused one (the menu stays open on the phrase).

## 0.6.4

### Patch Changes

- b5af599: Resolve PDF worker and decoder assets from the consumer's `pdfjs-dist` peer so the API and worker versions stay aligned.

## 0.6.3

### Patch Changes

- 7bfbdff: Derive the PDF decoder directory without constructing a URL from a bundler-relative asset path, preserving compatibility with Turbopack's emitted URL objects.

## 0.6.2

### Patch Changes

- 631cdd4: Resolve the PDF worker and JBIG2 decoder through statically analyzable package asset URLs and fetch the decoder by its exact emitted URL, including hashed production bundles.

## 0.6.1

### Patch Changes

- 47a8334: Remove column drag, resize, menu, and add-column affordances from database grids in view and published modes.
- 2fd97ce: Block every database cell write in view and published modes, including direct boolean toggles.

## 0.6.0

### Minor Changes

- 8b0f589: Add a zoom bar to the PDF preview's fullscreen mode: a separate pill to the left of the page controls with the zoom in/out buttons (over the fitted scale, 25%-400% bounds), the scale indicator, the fit-width and the fit-height buttons (the page's width/height fills the viewport's width/height, the overflow scrolls). The fullscreen mode pages with the left/right arrow keys, locks the body's scroll while open (the wheel over the overlay no longer scrolls the page behind), and stands a fixed-width page indicator (a digit count change no longer shifts the page buttons). The preview chrome stands no text selection (the page indicator and the controls are not document content), so selecting the page numbers can no longer flag the block or pull up the format toolbar.
- 7f26c1a: Localize the empty-block command palette placeholder for Russian locales while preserving consumer overrides.
- 8f6a3d6: - Add first-class file blocks with consumer-owned file ids, live rename subscriptions, reader downloads, and PDF previews.
  - Replace URL-based blob resolution with Blob+metadata stores and remove the legacy `blobResolver` prop.

### Patch Changes

- 16e10af: Fix attachment insertion and deletion gestures: replace phrase-only slash blocks, keep removal and the trailing paragraph in one undo step, and seat the caret on a surviving text block.
- Updated dependencies [8f6a3d6]
  - docblocks-core@0.3.0

## 0.5.0

### Minor Changes

- 3d0b793: Add a database column manager for restoring hidden columns and reordering the full column list by mouse or keyboard while preserving visible column widths. Keep a newly inserted row visible with a themed orange outline when it does not match the active filter until editing loses focus.
- ca80cd1: Rebuild the database filter menu over the library's field style: the
  condition's field / operator / value stand a single line over styled
  controls in a widened popover, the conditions and the nested group cards
  are bound by the group's left connector line, the AND/OR logic's labels
  stand the UI's locale and the active pill takes the prominent `primary`
  token's fill (the white's stand over the neutral's dark theme), and the
  footer's apply/clear stand over a separator line. The grid toolbar's undo/redo/columns/filter buttons
  stand the standard toolbar height and rounding, and the standalone
  `DatabaseTable` renders no table name (the consumer's own visual element
  stands the name — the document block's grid keeps the live name and the
  rename).

### Patch Changes

- 87a2cc9: Preserve thin cell boundaries in native table drag previews with or without a cell background, and keep the dragged handle aligned with the moving row or column by removing its positional animation lag.

## 0.4.7

### Patch Changes

- e065e49: The `DocblocksI18nProvider` (exported from the package entry) accepts an
  optional `locale` prop: the controlled mode for server-rendered
  consumers, where the `<html lang>` read is unavailable on the server and
  the first client render would take a different language (the hydration
  mismatch). The passed locale is normalized over the existing rules
  (`ru*` → `ru`, `en*` / unknown / empty → `en`), the provider creates its
  own synchronously initialized `i18next` instance keyed by the normalized
  value (a locale change selects the new instance and re-renders the
  subtree), and a nested provider without a `locale` inherits the outer's
  instance. The controlled mode never mutates the legacy attribute-driven
  instance and never touches the consumer's global `i18next`, so
  concurrent subtrees over different locales stay isolated; the locale is
  UI state only. Outside a controlled provider, the attribute-driven
  behavior is unchanged.
- 3223722: The page view now edits over one shared `contenteditable` surface (the
  page's container), with each text block's inner a nested editable: the
  native selection crosses block boundaries in every engine, and the
  block's handlers receive the container-level events through a dispatch
  that resolves the active block from the live selection. The follow-up
  keys run in the shared surface's context, so the in-block range's
  Delete / Backspace commits as a command (the caret re-seats at the
  range's start), the empty cell's activation layer suppresses the
  line-backspace, and the Home / End over a page text block resolve the
  block's own line edges. The gutter-handle drag's release keeps the
  user's text seat: the browser's release over the drag's non-editable
  chrome would collapse the selection to the page container (and the
  release's click would stand a residual blocks selection), so the drag
  session suppresses the release's click over non-text chrome and
  restores the captured seat on the release (a drop over a text inner
  seats the caret at the drop point instead).
- aa7ffb3: The table's row/column drag preview now applies the transform over the
  dragged row/column's cells instead of the row element (the `<tr>` is not
  a CSS transformable element — the engine may ignore the row's
  transform, leaving the preview dead while the handle follows the
  pointer). The dragged cell reads as a lifted card (a `--card`
  background + a `--docblocks-table-drag-shadow` box shadow over the
  uncolored cells, behind the cell's own row/column color), so the
  preview is visible over an empty table. The read-only modes render an
  empty table cell's placeholder (one line, matching the activation
  layer's footprint), keeping the edit mode's minimum row height in the
  view/published views.

## 0.4.6

### Patch Changes

- 32128bf: The database grid's column-seam resize locks every column over its
  rendered width for the drag's duration: over a fresh grid (the columns'
  flexible tracks) the first drag's live preview no longer shrinks the
  untouched columns as the dragged column grows — only the dragged column
  moves. The preview's locked layout is exactly the release's commit (the
  untouched columns' start measurement), so the release stands no jump.

## 0.4.5

### Patch Changes

- 468f457: The callout's custom color picker commits the last scrubbed value when
  the picker section closes without an explicit commit (the former close
  discarded the draft); an untouched picker still commits nothing. The
  swatch grid's custom swatch carries the current color when it matches
  no preset (a small dot over the rainbow swatch).
- 55f51fc: A DOM selection outside a text-editable inside the canvas view maps to
  none over the page's selection mapping. The engine's focus move over a
  canvas item (the mousedown's default focuses the non-editable — the
  firefox's behavior) fires a selectionchange whose blocks mapping would
  flag the focused item: the stray selection tinted the picked shape
  over the canvas' own selection state (the two-click pick's first
  pick). The canvas manages its selection over the explicit press; the
  page card's editable keeps the mapping.
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
- 7bc9512: The shared popover's enter and exit animations now run: the classes were
  keyed on `data-open` / `data-closed` attributes that Radix does not set
  (it sets `data-state="open" | "closed"`), so the animations never applied
  and the content teleported in. The closed content now gets
  `pointer-events-none` for the exit animation, so a fading popover does
  not swallow the press landing over its area.
- 00d4596: The canvas connector's line is clickable in webkit (Safari): the wide
  invisible hit path renders in its own svg sized to the path's bounding
  box over the 1x1 center-anchor draw layer. The webkit hit-tests only
  inside an svg's own box (the overflow-visible content of the 1x1 layer
  is draw-only there), so the line was not selectable by a click over
  there. The chromium and the firefox reach the overflow, so the box
  change alters no behavior over them.
- 4e1bee5: The cross-block selection stands over the engines that clamp the DOM
  selection across contenteditable boundaries (webkit / Safari): the
  selection writes (the keyboard extension, the drag's seat) use a
  document-ordered Range instead of the Selection endpoint setters (the
  clamping writes), and the cross-block reads (the arrow at the text's
  edge, the range's extension) use the range's far endpoint when the
  selection's focus reads clamped into the anchor's editable. The
  selection's mapping reads the cross-editable range from its endpoints
  instead of the anchor / focus nodes.
- Updated dependencies [745f1d7]
  - docblocks-core@0.2.2

## 0.4.4

### Patch Changes

- ae88381: The motion drag's pointer-Y helper no longer tests the event against the
  global `TouchEvent` (the `instanceof` stand): the global is absent on the
  no-touch Safari (a desktop Safari on macOS), so every drag callback threw
  a `ReferenceError` and the block drag-reorder failed there. The touch's
  stand is duck-typed over the event's own `changedTouches` property.

## 0.4.3

### Patch Changes

- 0d75fe3: The callout's icon stands vertically centered over the block (the
  marker-zone zone's top-alignment is replaced by the block's vertical
  center); the icon catalog's "Preset" entry is removed — the icon's
  override is reset by the type preset (the current variant's re-pick
  stands the preset's reset: the variant + the overrides, one transact).
- Updated dependencies [c0559db]
  - docblocks-core@0.2.1

## 0.4.2

### Patch Changes

- 90b529c: The callout's management moves from the format toolbar to the block's own
  affordance: the marker-zone icon stands a button (edit mode only) whose
  click opens the block's management menu (the type presets, the background
  palette, the icon catalog) beside the icon. The menu manages the block's
  attrs, not the selection's marks, so it stands for an empty callout (no
  text selection needed). The format toolbar over a callout's text range
  keeps the shared text marks and the alignment only (the callout's section
  is removed). The background palette gains the custom swatch: the `ColorPicker`
  primitive (the native `input type="color"` + the strict `#rrggbb` hex
  field) commits one `updateBlock({ color })` per pick (one undo step, one
  wire update); the close without a commit discards the draft. The read-only
  stands (view / published) render the icon without a button (no pointer
  events, the editing-surface parity).
- f482152: The Enter's split over the empty LAST line stands the exit's parity: the
  caret on an empty line at the text's end (the block's text ends with a
  soft line break) consumes that break with the gesture — the first block
  stands without the ghost empty line, the new sibling (the same type and
  attrs) stands empty. Before the fix the break survived the split in the
  first block as a rendered empty line that the line-boundary gestures
  (Home / End / the selection's deletes) do not reach. The quote /
  callout / code gesture family's exit stand (the same block over its
  own Enter handler) was the reference; the mid-text split's stand is
  unchanged (the new block's leading break is the caret's new line).

## 0.4.1

### Patch Changes

- ddc068e: The standalone `DatabaseTable` gains a `className` prop: the consumer's
  sizing / layout classes merge over the component's root (the package's
  `--docblocks-*` token scope's anchor, merged with the consumer's own
  classes). The grid already stands the root's width (`w-full`); the
  `className` closes the height's stand — a height-constrained root (the
  consumer's `h-*` class) stands the grid's inner scroll over the toolbar
  
  - header + rows (the card / content / grid-region's flex plumbing:
    `flex-1 min-h-0`), and the unconstrained's stand is the content's height
    (as over the document's database block — the plumbing stands inert over
    the block's context).

## 0.4.0

### Minor Changes

- 1b15901: The `embed` block's hover toolbar gains a URL-edit affordance (the
  editing mode's stand): the pencil button opens a panel over the
  toolbar with the current `src` pre-filled — the Enter / check's
  commit writes the `src` over the block's attrs (the iframe's
  navigation over the new src; the unsafe-scheme's and the empty's
  no-commit stand the slash form's rule, the unchanged's no-op writes
  nothing), the Escape / x's cancel closes the panel without a write.
  The read-only's stand gates the button off.
  
  The slash `Embed` form's visual stands the check over the URL input's
  right end (one row — the input fills the width, the commit button
  sits at its right edge instead of a row below).
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
- 0791efb: The `embed` block's slash form stands the URL input only (the kind's
  selector stood removed — the kind's default stands the `iframe`, the
  renderer's hint over the single-iframe stand). The `data:text/html`
  snippet's stand (the former `html` kind's purpose over the form) is no
  longer reachable over the form; the `html` kind stands a valid data
  kind over the direct insert / the wire.
  
  The default embed sandbox's stand changes: it now grants
  `allow-same-origin` (with the `allow-scripts`), so the embedded app
  boots with its own origin's storage / cookies (the real-app's
  requirement — the dashboards' class stands). The frame's document stands
  a separate document either way (a cross-origin's embed cannot reach the
  parent's DOM or state); the posture's consequence stands the same-origin
  URL's reach over the parent's state. The consumer's `embedSandbox`
  policy stands the restriction (the opaque-origin's stand, the
  `allow-same-origin`'s refuse).
  
  The embed's pan/zoom stands the block's persisted attrs (the `zoom` /
  `panX` / `panY` over the core's new attrs): the reload / the new tab's
  embed restores the view, and the panes share the persisted view over
  the wire (a pane's gesture writes over the doc, the other's adopt it).
  The write's debounce stands over the gesture's bursts (one doc write
  per rest); the values stand the wire's precision (the 1% zoom, the
  0.1 px pan — the floating-point's residue's guard).

### Patch Changes

- c5d0360: The canvas frame stands a pure region boundary — it renders no content
  copy. The frame renders the boundary (the transparent box, the border, the
  optional title chip); the interior is transparent, so the canvas content
  that falls under the box stands once over the surface (no mirror, no
  inert copies, no nested frame windows). The page-frame block's window is
  the only mirror of the canvas content — the clipped, inert cut over the
  page.
  
  This changes the frame's visual contract: a frame no longer re-renders the
  surface's children inside its box (the former viewport-window behavior),
  and the page-frame block's window no longer carries the nested frame
  window's copies (a frame inside the referenced frame now stands its
  boundary over the window, not a second cut of the content).
- c8be627: Fix the caret's re-seat over a text block after the focus stood in an
  embedded iframe (the embed's click): the cross-block selection's
  mousedown suppression no longer stands over such a press — the
  mousedown's default is the browser's focus move out of the frame, and
  suppressing it left the editor's document unfocused (no visible caret,
  the keystrokes' no-stand; only a double-click recovered it). The
  press now lets the default stand (the native focus move + the caret's
  seat) and tears the selection session down.
- 14e72c1: The page row's delete affordance stands the gutter's right offset over
  every block type: the hover's trash icon stands at the row's right edge,
  the same offset from the block content as the grip (the gutter's left
  offset, mirrored to the right) — over the text rows (paragraph, quote,
  heading, callout, list-item, code) as the non-text rows. The icon no
  longer overlaps the block's content zone.
- 9f789c9: The PDF preview (the `./pdf` subpath's `PdfFirstPage`) gains page
  navigation + a fullscreen mode. The inline view stands a control bar under
  the canvas: the previous/next page buttons (disabled at the first/last
  page), the page indicator, and the fullscreen toggle. The fullscreen mode
  opens a portal overlay over the viewport (the page scaled to the
  viewport, the same page navigation; the control bar stands the inline's
  — the thin border + the rounded corners, the minimize icon the only
  difference). The Escape key, the close button, and a click over the
  overlay's own surface (the background around the page) exit the fullscreen
  mode; a click over the page or the control bar stands it. The inline +
  the fullscreen views share the page state, so a page switch in either
  re-renders both.
- b3f2e54: The slash `File` command's label resolves over the slash catalog (the
  missing key stood the raw `blocks.file` in the menu); the orphaned
  `Image` key stands removed. The embed form's hint stands the URL-only
  form's wording (the `html` kind's snippet is no longer the form's
  purpose — the kind's selector stood removed).
- Updated dependencies [0791efb]
- Updated dependencies [48ef4fb]
  - docblocks-core@0.2.0

## 0.3.1

### Patch Changes

- bb5df92: The standalone `DatabaseTable` now anchors the package's `--docblocks-*`
  token scope over its own root (the `data-slot="docblocks/editor"` stand).
  The token mapping is declared on the editor root over the shipped CSS,
  and the standalone table renders outside any document — without the
  scope the grid's token-driven utilities (the borders, the paddings, the
  row's heights) stood unresolved over the consumer's page. The
  `readOnly` stand sets the root's `data-readonly` attribute (the page
  mode's `user-select`'s suppression parity).

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
