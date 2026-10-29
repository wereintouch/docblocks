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

Peer dependencies: `docblocks-core`, `react` (19), `react-dom`. Optional
peers, used only by their subpaths: `framer-motion` (`./motion`), `mermaid`
(`./mermaid`), `pdfjs-dist` (`./pdf`). The package's own runtime dependencies
(zustand, the Radix primitives, the shared ui runtime set) are declared, so
a plain `npm i` is the whole install.

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

- `EditorProvider` owns the per-instance editor state (the store projection
  of the doc, the selection view, the subscriptions). Multiple providers may
  coexist, each with its own doc.
- `Editor` renders the entry list. `view: "page"` (default) is the page;
  `view: "canvas"` renders the page miniature plus the root-level surfaces'
  elements on the canvas.
- `DocHeader` is a consumer-placed panel rendered in the consumer's chrome
  (outside the editor, so it takes the core `Doc` directly): the
  page/canvas switcher, the avatar, and the title — inline-editable, the
  title/avatar commits are one core command each (one undo step each),
  the Escape cancels without a write. It stands the standard theme tokens
  (not the `--docblocks-*` ones), since it renders outside the editor root.

## The consumer contract

Everything the editor needs from the consumer is injected as an
`EditorProvider` prop; every prop except `doc` is optional, and the
package ships a working default for most of them (the defaults are the dev / demo mode —
session-only, cleared on reload). The full props list:

| Prop                         | Contract                                                                                                                             |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `doc` (required)             | The core `Doc` to render and edit. Must not change after mount (a throw on change is the contract).                                  |
| `provider?`                  | A core `SyncProvider` for the wire + presence. Without it the editor is a single-client document (local edits stand, nothing syncs). |
| `blockRenderers?`            | Per-type renderer overrides (see below).                                                                                             |
| `blobStore?`                 | The blob bridge for image / pdf / file blocks (see below).                                                                           |
| `blobResolver?`              | Legacy view-only resolver (key → src string). Wrapped as a store: no upload, subtype `image`. Prefer `blobStore`.                    |
| `databaseBridge?`            | The table operations behind external-form database blocks (see below).                                                               |
| `syncEmbedResolver?`         | `(ref) => Doc \| null` — resolves a `sync-embed` block's ref to the master doc (see below).                                          |
| `pdfPreview?`                | A first-page preview component for `pdf`-subtype image blocks (see below).                                                           |
| `mentionProvider?`           | The `@` mention picker's search catalog (see below).                                                                                 |
| `rootBlockId?`               | Render the entry list of this block instead of the document root (the subtree view). Must not change after mount.                    |
| `commandPalettePlaceholder?` | The empty-block hint text (default `Type '/' for commands`).                                                                         |

Two rules for the optional props:

- **Stable references.** The values are read into the provider context per
  render; a fresh inline object re-creates the context value on every
  render and re-renders every context consumer. Module-level or memoized
  values are the contract.
- **Nested inheritance.** A provider nested inside another inherits the
  enclosing renderers, resolvers, and bridges when it supplies none of its
  own — a sync-embed's nested editor resolves its own content against the
  enclosing catalog.

### Sync and presence

The transport is a core concern: create the doc, build a provider, attach
them, and pass both to the provider:

```tsx
import { Editor, EditorProvider, usePresence } from "docblocks-react-ui";

import { WsSyncProvider, attach, createDoc } from "docblocks-core";

const doc = createDoc({ id: "room-1" });
const provider = new WsSyncProvider("ws://my-server:5199/room-1");
await provider.connect();
const session = attach(doc, provider); // session.detach() on unmount

<EditorProvider doc={doc} provider={provider}>
  <Editor />
</EditorProvider>;
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
errors reject, and the package neither swallows nor retries:

- catalog: `listTables`, `createTable`, `renameTable`, `describeTable`
- schema: `createColumn`, `updateColumn`, `renameColumn`, `deleteColumn`
- rows: `queryRows` (cursor pagination), `insertRow(s)`, `updateRow(s)`,
  `removeRow(s)`, `moveRow`, optional `undeleteRows` (only with soft-delete),
  `resolveRowDisplay` (the row-link cells' join)
- live feed: `subscribeTable(tableId, onEvents) → unsubscribe` — the only
  push channel (WS / SSE / polling with the same event shape: `row.created`
  / `row.updated` / `row.removed` / `row.moved` / `schema.changed` / …);
  events arrive for all rows, the client filters.

Without a bridge, the editor uses the shared default in-memory bridge
(tables and rows stand in the page's JS memory, cleared on reload) — the
dev / demo mode. `createMemoryDatabaseBridge` is exported.

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

### Subtree view

`rootBlockId` renders the entry list of one block instead of the document
root (the block itself plus its own subtree) — the editor renders the
subtree as its own page:

```tsx
<EditorProvider doc={doc} rootBlockId={someBlockId}>
  <Editor />
</EditorProvider>
```

### The `Editor` props

| Prop            | Contract                                                                 |
| --------------- | ------------------------------------------------------------------------ |
| `view`          | `"page"` (default) or `"canvas"` — the rendering the consumer switches   |
| `formatPalette` | The format toolbar's color swatches (default `FORMAT_PALETTE`, exported) |

`MotionEditor` (the `./motion` subpath) accepts the same props and adds the
layout animations and drag-reorder (requires `framer-motion`).

## Subpath exports

| Subpath                         | What it is                                                                                                       |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `docblocks-react-ui`            | The editor, the provider, the hooks, the primitives (the entry)                                                  |
| `docblocks-react-ui/styles.css` | The compiled stylesheet: the utility layer + the token seed + the `--docblocks-*` mapping + the structural rules |
| `docblocks-react-ui/theme.css`  | The pure token seed (standard tokens + the radius scale), no utility layer                                       |
| `docblocks-react-ui/motion`     | `MotionEditor` (layout animations, insert/remove, drag-reorder; peer: `framer-motion`)                           |
| `docblocks-react-ui/mermaid`    | The `mermaid` renderer above `code { language: "mermaid" }` blocks (peer: `mermaid`)                             |
| `docblocks-react-ui/pdf`        | `PdfFirstPage` (the first-page preview over `pdfjs-dist`; the worker is copied to `dist/pdf/` at build time)     |

The base entry imports none of the optional peers, so consumers who skip a
subpath ship no extra weight.

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
