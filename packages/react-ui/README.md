# docblocks-react-ui

React rendering and editing layer for the docblocks headless document
engine. The data model, the editing commands, and the sync live in
[`docblocks-core`](https://www.npmjs.com/package/docblocks-core); this
package renders the document and provides the editing surface
(caret/selection, keyboard, clipboard, block renderers, presence overlay).

## Install

```sh
npm i docblocks-react-ui docblocks-core
```

Peer dependencies: `docblocks-core`, `react` (19), `react-dom`, and the
required peers `framer-motion` (the Editor's page view is the motion row
layer — the drag-reorder + the layout animations), `mermaid` (the
`./mermaid` subpath's renderer), and `pdfjs-dist` (the `./pdf` subpath's
preview) — the install must carry all of them (npm enforces the required
peers). The package's own runtime dependencies (zustand, the Radix
primitives, the shared ui runtime set) are declared, so a plain `npm i`
is the whole install.

The package is ESM-only (`import`, not `require`); it stands Node
`^22.22.2 || ^24.15.0 || >=26.0.0` (the `engines` field).

## Quick start

The minimum is a core `Doc` wrapped in an `EditorProvider` and the
stylesheet import:

```tsx
import { DocHeader, Editor, EditorProvider } from "docblocks-react-ui";
import "docblocks-react-ui/styles.css";

import { useState } from "react";

import { createDoc } from "docblocks-core";

const doc = createDoc({ id: "my-doc-id" });

function App() {
  const [view, setView] = useState<"page" | "canvas">("page");
  return (
    <>
      <DocHeader doc={doc} view={view} onViewChange={setView} />
      <EditorProvider doc={doc}>
        <Editor view={view} />
      </EditorProvider>
    </>
  );
}
```

The `styles.css` side-effect import stands the standard bundler's ambient
`*.css` module declaration (shipped with the Vite / CRA / Next.js templates);
a bare `tsc`-only setup needs a one-line `declare module "*.css"` shim.

- `EditorProvider` owns the per-instance editor state (the store projection
  of the doc, the selection view, the subscriptions). Multiple providers may
  coexist, each with its own doc.
- `Editor` renders the entry list. `view: "page"` (default) is the page;
  `view: "canvas"` renders the page miniature plus the root-level surfaces'
  elements on the canvas.
- `DocHeader` is a consumer-placed panel rendered in the consumer's chrome
  (outside the editor, so it takes the core `Doc` directly): the
  page/canvas switcher, the document mode's switcher (Edit / View /
  Published — consumer-controlled over the `mode` + `onModeChange` props,
  rendered over the `editor`'s access level and the callback's presence;
  the `Published` option is disabled while the `publishedDoc` prop is
  absent), the avatar, and the title — inline-editable in the edit mode
  only (the read-only modes stand the title/avatar display-only), the
  title/avatar commits are one core command each (one undo step each),
  the Escape cancels without a write. Over the published's stand the
  header stands the snapshot's meta (the live's meta stands off — the
  `viewer`'s `doc` is the snapshot itself; the no-snapshot stand renders
  the neutral meta, never the live one). It
  stands the standard theme tokens
  (not the `--docblocks-*` ones), since it renders outside the editor root.
- The `Doc` holds the document state, and the package holds no
  persistence — how to store and restore it: the Persistence section
  below.

## The consumer contract

Everything the editor needs from the consumer is injected as an
`EditorProvider` prop; every prop except `doc` is optional. The only
built-in default is the blob store (a shared in-memory stand — the
uploads resolve as data urls for the JS session, cleared on reload); the
other props degrade gracefully over their absence (the external-form
database block stands the not-connected placeholder and the `/database`
slash command is hidden without a bridge; the `sync-embed` block stands
its broken state without a resolver; the `@` stays plain text without a
mention catalog). The full props list:

| Prop                         | Contract                                                                                                                                                                                                                                                                                                                               |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `doc`                        | The core `Doc` to render. Must not change after mount (a throw on change is the contract). Required for the `editor` stand; over the `viewer`'s level the doc IS the published snapshot (the security model — the reader's browser never receives the live document), and an absent stand renders the "not published yet" placeholder. |
| `provider?`                  | A core `SyncProvider` for the wire + presence. Without it the editor is a single-client document (local edits stand, nothing syncs).                                                                                                                                                                                                   |
| `blockRenderers?`            | Per-type renderer overrides (see below).                                                                                                                                                                                                                                                                                               |
| `blobStore?`                 | The blob bridge for image / pdf / file blocks (see below).                                                                                                                                                                                                                                                                             |
| `blobResolver?`              | Legacy view-only resolver (key → src string). Wrapped as a store: no upload, subtype `image`. Prefer `blobStore`.                                                                                                                                                                                                                      |
| `databaseBridge?`            | The table operations behind external-form database blocks (see below).                                                                                                                                                                                                                                                                 |
| `syncEmbedResolver?`         | `(ref) => Doc \| null` — resolves a `sync-embed` block's ref to the master doc (see below).                                                                                                                                                                                                                                            |
| `pdfPreview?`                | A first-page preview component for `pdf`-subtype image blocks (see below).                                                                                                                                                                                                                                                             |
| `mentionProvider?`           | The `@` mention picker's search catalog (see below).                                                                                                                                                                                                                                                                                   |
| `rootBlockId?`               | Render the entry list of this block instead of the document root (the subtree view). Must not change after mount.                                                                                                                                                                                                                      |
| `commandPalettePlaceholder?` | The empty-block hint text (default `Type '/' for commands`).                                                                                                                                                                                                                                                                           |
| `accessLevel?`               | The consumer's user access level (default `editor`): `viewer` forces the `published` mode (the current state is never rendered to a reader).                                                                                                                                                                                           |
| `mode?`                      | The document mode (default `edit`): `view` is a read-only live document; `published` renders the `publishedDoc` snapshot read-only.                                                                                                                                                                                                    |
| `publishedDoc?`              | The published snapshot (a hydrated core `Doc`; must not change after mount — remount over `key` for a new snapshot). The consumer owns the publish action and the snapshot storage.                                                                                                                                                    |

Two rules for the optional props:

- **Stable references.** The values are read into the provider context per
  render; a fresh inline object re-creates the context value on every
  render and re-renders every context consumer. Module-level or memoized
  values are the contract.
- **Nested inheritance.** A provider nested inside another inherits the
  enclosing renderers, resolvers, and bridges when it supplies none of its
  own — a sync-embed's nested editor resolves its own content against the
  enclosing catalog.

### Persistence

The package holds no persistence — the document state lives in the core
`Doc`, and the snapshot / update storage is a consumer-side concern (the
non-goal list in the core README). The canonical loop: restore the doc
from your stored state, and save it on every transaction:

```tsx
import { useEffect, useState } from "react";

import { loadDoc } from "docblocks-core";

function useDocument(id: string) {
  // Restore: loadDoc over your stored encoded state (fromJSON over a
  // stored JSON snapshot).
  const [doc] = useState(() => loadDoc(readStoredState(id)));
  useEffect(() => {
    // onChange fires for every transaction (local and remote) — encode
    // the full state after each and hand it to your storage.
    const off = doc.onChange(() => {
      writeStoredState(id, doc.encode());
    });
    return off;
  }, [doc]);
  return doc;
}
```

(`doc.toJSON()` / `fromJSON` is the JSON path, `doc.encode()` /
`loadDoc` the encoded path — the core README's Doc section; a consumer
that stores incremental updates can encode them with
`doc.encodeUpdate(stateVector)`.)

### Access modes and publishing

The access level and the document mode are consumer session state (never
document data, never on the wire):

```tsx
// The editor's stand: the live document + the publish's snapshot.
<EditorProvider doc={doc} mode={mode} accessLevel={role} publishedDoc={snapshot}>
  <Editor />
</EditorProvider>

// The viewer's stand (the security model): the published snapshot is the
// only document the reader's browser receives — pass it as `doc`.
<EditorProvider doc={snapshot} accessLevel="viewer">
  <Editor />
</EditorProvider>
```

- `accessLevel: "viewer" | "editor"` (default `editor`) decides which
  modes are available: a `viewer` is always in the `published` mode (the
  current state is never rendered to a reader); an `editor` switches
  freely.
- **The security model — the reader never receives the live document.**
  The consumer hands the viewer exactly the minimum needed to render the
  published state: the published snapshot as `doc` and nothing else (no
  live document, no sync transport, no `publishedDoc` — over the viewer
  the `doc` is the snapshot). A document that was never published is no
  stand at all: the provider renders the "not published yet" placeholder
  over the absent `doc`.
- `mode: "edit" | "view" | "published"` (default `edit`): `edit` is the
  full editor over the live document; `view` is a read-only render of the
  live document (it keeps syncing — the state stays current); `published`
  renders the `publishedDoc` snapshot read-only (a nested read-only editor
  over the snapshot: its own selection, no sync transport, the snapshot
  stands static over the live edits).
- A published mode without a `publishedDoc` renders the
  "not published yet" placeholder in place of the content (the current
  state is not shown).
- Over the read-only modes the editing surfaces are off (the text inners
  are not editable, the gutter / drag / hotkeys / format toolbar / the
  table and database editing chrome / the canvas sessions and dock stand
  off); the read-only gestures keep (scroll, the embed pan / zoom, the
  canvas wheel zoom / pan). Consecutive empty text blocks render as one
  over the read-only modes (the document data is untouched).
- Publishing is a consumer action: snapshot the doc state (`doc.encode()`
  or `doc.toJSON()`), persist it where the reader loads it from, and
  hydrate it (`loadDoc` / `fromJSON`) — for the `editor`'s `published`
  mode into the `publishedDoc` prop, for the `viewer`'s stand as the `doc`
  itself. The package ships no publish API and stores no publish state; the
  external database form's rows live in the consumer's table (they are not
  part of the snapshot — the inline form is document data and is). A new
  snapshot is a remount (pass it under a changing `key`).
- The `DocHeader` stands over the viewer's stand too: pass the snapshot as
  its `doc` (the viewer's switcher stays off — the `accessLevel` stands no
  `mode` stand over the `viewer` level).

### Sync and presence

The transport is a core concern: create the doc, build a provider, attach
them, and pass both to the provider:

```tsx
import { Editor, EditorProvider } from "docblocks-react-ui";

import { useEffect, useMemo } from "react";

import { WsSyncProvider, attach, createDoc } from "docblocks-core";

const doc = createDoc({ id: "room-1" }); // or restore it (the Persistence section)

function App() {
  const provider = useMemo(() => new WsSyncProvider("ws://my-server:5199/room-1"), []);
  useEffect(() => {
    void provider.connect();
    const session = attach(doc, provider);
    return () => {
      session.detach(); // detach before the transport closes
      provider.disconnect();
    };
  }, [doc, provider]);
  return (
    <EditorProvider doc={doc} provider={provider}>
      <Editor />
    </EditorProvider>
  );
}
```

- `attach` bootstraps the session (it sends the full local state first,
  then routes local transactions out and remote updates in); detach it on
  unmount.
- `WsSyncProvider` speaks standard y-protocols over WebSocket (the
  y-websocket wire, wire-compatible with a standard y-websocket server);
  `options: { token?, webSocketImpl? }`. Any object implementing the core
  `SyncProvider` interface (connect / disconnect / sendUpdate / onUpdate /
  getLocalStateVector / setAwareness / onAwareness) works in its place.
- Presence rides the provider's awareness channel: the editor publishes its
  own selection automatically (debounced) and renders the remote peers'
  carets. `usePresence()` reads the per-peer state (peer id, selection,
  `updatedAt`); staleness (dropping stale peers) is a consumer concern —
  the payload's `updatedAt` (Unix ms) is the only input.

### Blobs

The document holds only an opaque blob key (`image.src`); the bytes live
where the consumer stored them. `BlobStore` (the `blobStore` prop) is the
only path key → url and file → key, in both directions:

```ts
interface BlobStore {
  resolve(key: string): Promise<{
    url: string;
    meta: { subtype: "image" | "pdf" | "file"; name?: string; type?: string; size?: number };
  }>;
  upload(file: File | Blob, meta?: Partial<BlobMeta>): Promise<string>;
  remove?(key: string): Promise<void>; // optional gc
}
```

- `resolve` rejects an unknown key — the block stands its structural
  placeholder card until the promise resolves.
- The UI renders from `meta.subtype` and never guesses: `image` is an
  `<img>`, `pdf` the first-page preview (the `./pdf` subpath, or the native
  iframe without it), `file` the download card. The consumer decides the
  subtype on both directions (`upload` may override the mime-derived
  default via `meta.subtype`).
- Without `blobStore` / `blobResolver`, the editor uses a shared
  in-memory store (uploads stand data urls for the JS session, cleared on
  reload), so the upload path works out of the box. `createMemoryBlobStore`
  and `blobSubtypeOf` are exported for consumers who want the same
  behavior under their own prop.

### Database

The `database` block has two forms. The **inline** form keeps its columns
and rows in the document. The **external** form keeps only a `tableId`
reference; the schema and the rows live in the consumer's database behind
the `DatabaseBridge` (the `databaseBridge` prop) — all methods are async,
errors reject as the structured `BridgeError` (the closed `code`
vocabulary — `BRIDGE_ERROR_CODES` — + the `message` + the optional
`details`), and the package neither swallows nor
retries:

- protocol: `describeProtocol` (the version + the capabilities + the
  limits) — the client negotiates it before any use; a version /
  baseline-capability mismatch stands the `protocol_mismatch`, not a
  silent downgrade
- catalog: `listTables`, `createTable`, `renameTable`, `describeTable`
- schema: `createColumn`, `updateColumn`, `renameColumn` (the `name` key
  of `updateColumn`), `deleteColumn`, `restoreDeletedColumn` (the
  soft-delete posture)
- reads: `snapshotTable` (the sole initial load: the schema + the first
  page from one read), `queryNextPage` (the opaque keyset cursor — the
  cursor is signed by the server), `resolveRowDisplay` (the row-link
  cells' join)
- writes: the atomic mixed `batchRows` (the ordered `ops[]` commit as one
  transaction — the insert / update / remove / move / append stand the
  op's kinds), `undeleteRows` (one atomic operation, independent of the
  batch) — every mutation carries the `MutationContext` (the
  client-issued `operationId` idempotency key + the issue time + the
  optional CAS `expectedRevision` — its absence selects the LWW default)
- live feed: `subscribeTable(tableId, { afterSeq }, observer)` → the
  handle — the push channel (the consumer's transport: WS / SSE /
  polling); the observer stands the `commit` envelope (one transaction →
  one `seq` / `prevSeq` over the append-only per-table stream) and the
  `invalidate` (the table's stream re-anchors — the grid refetches over
  the alive subscription); the bootstrap's replay covers the
  snapshot → subscribe gap (the `afterSeq` handoff)
- reconciliation: `getOperationStatus(operationId)` — the lost-response
  stand (the committed receipt or the pending)

Without a bridge, external-form database blocks render a "database not
connected" placeholder and the `/database` slash command is hidden; the
inline-form database block (columns + rows stored in the document) renders
and edits without a bridge. Supply your own `DatabaseBridge` implementation
for external-form tables. The bridge-side helpers are exported from the
package root: `BridgeError` (the structured error type) with
`toBridgeError` / `isBridgeError` / `isBridgeErrorCode`, `newMutationContext`
(the client-issued `operationId` per op), `PROTOCOL_VERSION` /
`BASELINE_CAPABILITIES` / `validateProtocolDescriptor` (the negotiation),
`isDatabaseBridge`, and `useDatabaseTable(bridge, tableId, filter?)` — the
grid controller for a consumer-owned grid over the bridge.

### Sync-embed

A `sync-embed` block references another document by an opaque ref. The
consumer holds the master docs and resolves them:

```tsx
const syncEmbedResolver = (ref: SyncEmbedRef): Doc | null => (ref.docId === "master-1" ? masterDoc1 : null);

<EditorProvider doc={doc} syncEmbedResolver={syncEmbedResolver}>
  <Editor />
</EditorProvider>;
```

The renderer mounts a nested `EditorProvider` over the master (subtree
mode), so the embedded content is a fully editable doc with its own
selection and undo. `null` renders the broken state; cycles are guarded by
the ancestor-doc chain (a doc cannot embed itself transitively).

### Block renderers

`blockRenderers` maps a block type to a consumer component that replaces
the built-in renderer for that type:

```tsx
import type { BlockRendererMap } from "docblocks-react-ui";

const blockRenderers: BlockRendererMap = {
  divider: ({ id, block }) => <div data-block-id={id} data-block-type="divider" className="my-divider" />,
};

<EditorProvider doc={doc} blockRenderers={blockRenderers}>
  <Editor />
</EditorProvider>;
```

- A type without an entry keeps its built-in renderer; a type with neither
  renders the placeholder (future block types keep working).
- Replacing a text-editable type replaces the whole block view, including
  the contenteditable and its editing affordance — a renderer that needs
  editing drives the core commands through the hooks (`useDoc`,
  `useText`, `useSelectionView`, …).
- Custom renderers should stamp `data-block-id` / `data-block-type` on their
  root: the drag and selection gestures key off these attributes.

### PDF preview

`pdfPreview` is a component that renders a `pdf`-subtype image block's
resolved blob as a client-side first-page preview. The `./pdf` subpath
provides one over `pdfjs-dist` (an optional peer):

```tsx
import { PdfFirstPage } from "docblocks-react-ui/pdf";

<EditorProvider doc={doc} pdfPreview={PdfFirstPage}>
  <Editor />
</EditorProvider>;
```

The renderer receives `{ id, url, name }` (`id` is the block id, `url` the
resolved blob url, `name` the blob's display name) and should stamp
`data-block-id={id} data-block-type="image"` on its rendered root, like the
other block renderers. Without the prop a `pdf`-subtype block stands the
native iframe viewer; a failed preview render falls back to it, so the
document always stays viewable.

### Mentions

The `mentionProvider` prop powers the `@` mention picker: typing `@` at a
word boundary in a page text block (paragraph, heading, list item, callout,
quote — a code block keeps `@` as plain text) opens a two-section picker
(people and documents) anchored at the `@`. The provider searches its own
catalog and returns `{ id, label }` entries:

```ts
const mentionProvider = {
  searchUsers: async (query: string) => [{ id: "u1", label: "Ada Lovelace" }],
  searchDocs: async (query: string) => [{ id: "d1", label: "API Reference" }],
};
```

A pick replaces the `@query` phrase with the label and stands the `mention`
mark (the `kind` `"user"` or `"doc"`, the `id`, and the `label` snapshot) in
one transaction — one undo step. The mention renders as an atomic,
non-editable chip; copying it stands the `@label` plain text. Without the
prop the `@` is plain text (no picker). The mark is non-exclusive (it
composes with the other marks).

### Canvas

`view: "canvas"` renders the page miniature plus the document's
root-level `surface` blocks — the shapes, the connectors, the frames,
and the canvas texts. The canvas content is document data (the `surface`
block with its child elements, each optionally carrying the `geometry`
— `x` / `y` / `w` / `h`), created in the editor (the bottom dock's
insert menu, the drag / resize / nudge / fit / draw sessions) or
programmatically through the core's block commands. The viewport's zoom
and pan are view state — they never reach the document.

### Subtree view

`rootBlockId` renders the entry list of one block instead of the document
root (the block itself plus its own subtree) — the editor renders the
subtree as its own page:

```tsx
<EditorProvider doc={doc} rootBlockId={someBlockId}>
  <Editor />
</EditorProvider>
```

### Hooks

The editor state is read through the hooks over the nearest
`EditorProvider`; every hook re-renders its consumer only when the read
value actually changes (the store's reference-stability contract):

- `useDoc()` — the core `Doc`.
- `useBlock(id)` — the block snapshot (`undefined` when the block is
  missing, e.g. removed by a peer).
- `useText(id)` — the block's flattened text.
- `useSelection()` — the local view selection (the caret / range / block
  selection).
- `useSelectionView()` — the selection view (set the selection, read the
  local state; `null` before the mount effect ran and after unmount).
- `usePresence()` — the remote peers' ephemeral state (the selection +
  the `updatedAt` per peer).
- `useMeta()` — the document meta (the reference is replaced only when
  the title changed).
- `useEditorContext()` — the whole provider context (the store, the
  resolvers, the access stand).
- `useDatabaseTable(bridge, tableId, filter?)` — the external database
  block's grid controller (a consumer-owned grid over the bridge).

### The `Editor` props

| Prop            | Contract                                                                 |
| --------------- | ------------------------------------------------------------------------ |
| `view`          | `"page"` (default) or `"canvas"` — the rendering the consumer switches   |
| `formatPalette` | The format toolbar's color swatches (default `FORMAT_PALETTE`, exported) |

The page view renders the flat page sequence — every page block is its
own row (the drag-reorder's pure framer `Reorder`, the insert/remove's
layout animation, the rendered list marker per row) — over the required
`framer-motion` peer.

## Subpath exports

| Subpath                         | What it is                                                                                                       |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `docblocks-react-ui`            | The editor, the provider, the hooks, the primitives (the entry)                                                  |
| `docblocks-react-ui/styles.css` | The compiled stylesheet: the utility layer + the token seed + the `--docblocks-*` mapping + the structural rules |
| `docblocks-react-ui/theme.css`  | The pure token seed (standard tokens + the radius scale), no utility layer                                       |
| `docblocks-react-ui/mermaid`    | The `mermaid` renderer above `code { language: "mermaid" }` blocks (peer: `mermaid`)                             |
| `docblocks-react-ui/pdf`        | `PdfFirstPage` (the first-page preview over `pdfjs-dist`; the worker is copied to `dist/pdf/` at build time)     |

The `./mermaid` and `./pdf` subpaths' wiring is opt-in (the `pdfPreview`
prop / the `code` block renderer): a consumer who skips a subpath imports
nothing of its module. The peers themselves are required installs (the
page view's framer import included).

## Theming

The editor carries no theme values in its component code: every theme-relevant
value — colors, radius, fonts, tints — is read from a CSS custom property
(a handful of structural micro-values — the drag-item shadow, small fixed
radii — are plain CSS). The token model is two-layer:

1. **Standard tokens (input).** The editor reads the standard shadcn tokens
   — `--foreground`, `--primary`, `--primary-foreground`, `--muted`,
   `--muted-foreground`, `--accent`, `--destructive`, `--border`, `--card`,
   `--popover`, `--radius`, `--font-sans`, `--font-mono` — when your
   application defines them on `:root` / `.dark` (your global stylesheet or
   a Tailwind v4 theme). All of them are optional.
2. **`--docblocks-*` tokens (mapping).** Each reads its standard counterpart
   with the shipped default as the fallback, so an app without a theme
   renders the unthemed look. The mapping is declared on the editor root
   element, which is what lets the editor follow your theme in both light
   and dark.

So a shadcn-based app needs no extra work: the editor follows the tokens
your app already defines, and the `dark` class on `<html>` flips it with
the rest of the app.

For apps without a theme, the shipped stylesheet carries the standard
token seed (light + the `dark` set), so the single import above renders
the editor and the primitives with the canonical shadcn palette. The
pure seed (without the utility layer) also ships as
`docblocks-react-ui/theme.css` — import it for the tokens alone, or copy
its values into your own theme.

**Fonts.** The default UI font (the editor's chrome + the page text) is the
self-hosted `Inter` — the `--docblocks-font-family` token reads `--font-sans`
first, so a `--font-sans` you define overrides it. The mono font (the code
block) — the `--docblocks-mono-font-family` token — defaults to the
system mono and reads `--font-mono` first. The package's self-hosted font set
(the UI font, the mono default, and the shape-text font options) is listed in
the `fonts` registry (`UI_FONT_ID` / `UI_FONT_STACK`, `MONO_FONT_STACK`,
`SHAPE_FONT_OPTIONS`).

The self-hosted font set (Inter, JetBrains Mono, Lora, Open Sans, PT Sans,
PT Serif) is licensed under the SIL Open Font License 1.1; the license text
ships with the fonts in `dist/fonts/OFL.txt`.

### Design system primitives

The package's design system primitives (Button, Checkbox, Card, Alert, … —
exported from the package entry) are styled with Tailwind utility classes.
Tailwind is a build-time concern, so the package compiles the utilities
itself and ships the result inside `styles.css` (the utility layer, plain
CSS) — no Tailwind tooling is needed on the consumer side. Three notes:

- The preflight lives in `@layer base`, so any unlayered consumer CSS
  wins over it (the `--docblocks-*` mapping and the structural rules own
  the editor area).
- The `dark:` utilities follow the `dark` class (any ancestor, the shadcn
  convention), not the `prefers-color-scheme` media query.
- The primitives reference the `z-modal` stacking utility, which is
  consumer-side: define it yourself (for example
  `@utility z-modal { z-index: var(--z-modal) }`); without it the popup
  content simply carries no z-index.

The seed section is the package's DEFAULT for the standard tokens, not a
fixed value: if you define them yourself, declare your definitions after
the `styles.css` import (same specificity — the later declaration wins) or
on a wrapper around the editor (an element declaration beats the inherited
`:root` value for everything inside it).

### Overriding individual values

Override a `--docblocks-*` token on a selector that matches the editor
element (or a higher-specificity wrapper), for example:

```css
[data-slot="docblocks/editor"] {
  --docblocks-radius: 10px;
  --docblocks-link-color: #0b6;
}
```

Tokens without a standard counterpart (`--docblocks-link-color`,
`--docblocks-selection-background`, the callout warning colors, the mention
chip colors, shadows, sizes, and the presence tokens) are package defaults
and override the same way.

The color palette's default swatches read the `--docblocks-palette-*`
tokens (red, orange, yellow, green, cyan, blue, violet) plus the theme's
`--background` token. Unlike the editor-scoped tokens, these stand on
`:root` / `.dark` (the seed ships a brighter light set and a more muted
dark set, so the swatch follows the theme flip). Override them on
`:root` / `.dark`, or pass the editor's `formatPalette` prop (a `string[]`
of hex or `var(…)` entries) to replace the swatches outright; a picked
swatch always commits a concrete hex to the document.

### Structure

Structural styling hooks are `data-slot` attributes (`docblocks/editor`,
`docblocks/block`, `docblocks/block-content`, `docblocks/quote-rule`, …) plus
`data-block-type`, `data-list`, `data-depth`, and the per-state attributes — see
the stylesheet header for the full list. User content styling (run color /
highlight) is document data, not theme, and is applied inline.
