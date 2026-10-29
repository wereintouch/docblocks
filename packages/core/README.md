# docblocks-core

The headless CRDT document engine for docblocks — the data half: the
document model, the editing commands, the selection, and the sync
transport. There is no UI in this package; rendering and editing live in
[`docblocks-react-ui`](https://www.npmjs.com/package/docblocks-react-ui).

The engine is built on [Yjs](https://yjs.dev) (a CRDT): documents converge
across peers even when updates arrive out of order, duplicated, or with
losses. The only runtime dependencies are `yjs`, `y-protocols`, and `lib0`.

## Install

```sh
npm i docblocks-core
```

## Quick start

A document is created, edited with commands, and read back as plain JSON —
every read returns a **snapshot** (a plain object), never a live Yjs
reference, so mutating a returned block does nothing.

```ts
import { createDoc, fromJSON } from "docblocks-core";

const doc = createDoc({ id: "my-doc" });

const para = doc.insertBlock("paragraph");
doc.insertText(para, 0, "hello world");
doc.setMark(para, 0, 5, { type: "bold" });

const json = doc.toJSON(); // { v, meta, blocks, children }
// …persist or send `json` …
const restored = fromJSON(json); // a fresh Doc over the same data
```

Commands are `Doc` methods. Each command runs inside a transaction — one
undo step, one wire update. Batch several into a single step with
`transact`:

```ts
doc.transact(() => {
  const h = doc.insertBlock("heading", { level: 1 }, { afterId: para });
  doc.insertText(h, 0, "Title");
}); // one undo step, one wire update
```

The block and mark registries drive the command types: `doc.insertBlock`
accepts only a known block type, and its `attrs` are required exactly when
the type demands them — `doc.insertBlock("heading", { level: 7 })` is a
compile-time error. Unknown input throws a typed error
(`UnknownBlockError`, `InvalidRangeError`, …); commands never no-op
silently.

## The Doc

`createDoc(options?)` builds a document with a root block and an empty,
editable first paragraph. The other entry points:

- `fromJSON(json)` — build a `Doc` from a JSON snapshot.
- `loadDoc(bytes)` — build a `Doc` from an encoded full state (a base
  snapshot; apply diffs with `applyUpdate`).
- `doc.toJSON()` — the JSON snapshot (`{ v, meta, blocks, children }`).
- `doc.encode()` / `doc.encodeUpdate(stateVector?)` — the encoded full
  state / the incremental update.
- `doc.applyUpdate(bytes)` — apply an encoded update (the remote-apply path).

`doc.raw` exposes the underlying `Y.Doc`; it is an explicit escape hatch
and its shape is not guaranteed.

## Commands

Editing goes through the semantic API (the only path for normal editing).
The commands translate into `Y.Doc` mutations inside a transaction:

- **Blocks** — `insertBlock`, `updateBlock`, `moveBlock`, `removeBlock`,
  `changeBlockType`.
- **Text** — `insertText`, `deleteText`, `setMark`, `unsetMark`, and the
  range forms (`deleteTextRange`, `setMarkRange`).
- **Document meta** — `setTitle`, `setAvatar`, `setGeometry`, `setZOrder`.
- **Database rows** — the row commands (`insertRow`, `setCell`,
  `removeRow`, `moveRow`, …).
- **Table rows / columns** — `insertTableRow`, `removeTableRow`,
  `insertTableColumn`, `removeTableColumn`, the move / duplicate / color /
  width commands, and `setTableRowColor`.

Reads: `getBlock(id)`, `getChildren(id)`, `getRuns(id)`, `getText(id)`,
`getTextLength(id)`.

## Sync

`attach(doc, provider)` is the glue between a `Doc` and a
`SyncProvider`: it bootstraps the session (sending the full local state
first), then routes local transactions out and remote updates in. `detach()`
on the returned session tears the session down.

`WsSyncProvider` speaks the standard y-protocols wire over a WebSocket
(wire-compatible with a standard y-websocket / pycrdt server):

```ts
import { WsSyncProvider, attach } from "docblocks-core";

const provider = new WsSyncProvider("wss://my-server/ws/room-1", {
  token: "…",
});
await provider.connect();
const session = attach(doc, provider);
// … on teardown:
session.detach();
```

Reactivity: `doc.onChange(handler)` fires for every transaction;
`doc.onRemoteChange(handler)` fires for non-local-origin transactions only
(the feed a sync consumer's write-back guards hook into).

## Selection

Selection is client / view state, not document data — it is not in the JSON
and not in document updates. `createSelection(doc)` builds a `SelectionView`
over the doc; other clients' selections travel only in the ephemeral
awareness channel (the presence payload). `presenceSelectionOf(selection)`
projects a selection into the presence payload shape.

## Data format

The JSON format is `v: 1`: `meta` (the doc `id`, `title`, the optional
`avatar`) plus a **flat block map** (`id → block`) with explicit order via
`children: [blockId]`; nesting (lists, table cells) is `children`. The text
of a text block is `content: [{ text, marks }]` runs. JSON ↔ Yjs is
isomorphic — every JSON field has exactly one Yjs image.

The block and mark registries are the extension point. Adding a block type
or mark is additive (a minor): the registry entry plus a renderer; the
validator and the commands stay registry-driven. The reader tolerates the
unknown (an unknown block type renders a placeholder, an unknown mark is
ignored and its text stays); the validator is strict (`validateDoc` reports
only known types and marks — it protects the data you own). A breaking
change is a major: the reader rejects the unknown major, and a migration
helper converts the data. `flattenDoc(json)` normalizes the legacy nested
shape into the flat page model at load.

## Validation

`validateDoc(json, lenient?)` returns the list of validation errors (empty
is valid). Strict (the default) is the writer's contract — it checks the
known types and mark values. Lenient is the reader boundary — unknown types
and marks pass through (the reader preserves them), so a reader of `v1.0`
can safely load `v1.5` data.

## Non-goals

This package is deliberately headless. It does not ship a UI (that is
`docblocks-react-ui`), a server (any Yjs-compatible server is the receiving
side), or blob resolution (the consumer provides a `BlobStore`). It holds no
persistence — snapshot and update storage is a consumer-side concern.
