# docblocks

Headless CRDT document engine built on Yjs, designed to be reused across
projects. The document is a flat block map with explicit ordering; the
engine is a set of typed commands over a `Y.Doc`, and the editing surface
is a separate React package that builds strictly on the headless core.

**Status:** the schema, engine, and React editing layer are feature-complete
(v1, the v1.1 block extensions, canvas, the flat page model); the packages
are 0.x pre-release.

## Packages

| Workspace           | npm name             | Purpose                                                                                                                                     |
| ------------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/core`     | `docblocks-core`     | Headless engine: `schema` (format/types/validator), `core` (`Doc`, commands, transactions, undo, reactivity), `sync` (providers, `attach`). |
| `packages/react-ui` | `docblocks-react-ui` | React rendering + editing layer: provider + hooks, block renderers, caret/selection, keyboard, clipboard, presence.                         |
| `apps/playground`   | (private)            | Dev harness for visual and sync testing: A/B clients on a local ws relay, inspectors, chaos controls.                                       |

Dependency budget of `docblocks-core`: `yjs` + `y-protocols` + `lib0`
only. `docblocks-react-ui` peers: `docblocks-core`, `react`,
`react-dom`; optional peers used only by their subpaths (`framer-motion`,
`mermaid`, `pdfjs-dist`). The consumer-facing contracts of the React layer
are documented in `packages/react-ui/README.md`.

## Requirements

- Node.js `^22.22.2 || ^24.15.0 || >=26.0.0` (the `.node-version` file
  pins the development runtime) and npm (npm workspaces; no other
  toolchain requirements)
- For the E2E suite only: a Playwright browser, installed once with
  `npx playwright install chromium`

## Building

```sh
npm install        # install all workspaces
npm run build      # tsdown builds, core first (the dist is ESM)
```

The `dist/` output is the consumer view of the packages: the unit tests
(sibling workspaces resolve each other from `dist/`) and the playground +
E2E suite (which consume `docblocks-react-ui` from its built `dist/`) all
need it, so run `npm run build` after a fresh clone and after any change
in `packages/`.

## Running the playground

```sh
npm run dev -w apps/playground
```

The command starts the Vite dev server on `http://localhost:5173` and,
in-process with the server, a standard y-protocols WebSocket relay on
`ws://localhost:5199`. Open the page in two browser tabs (the second with
`?client=b`): each tab is a full client, the two panes of one room render
the same document, and edits from either pane reach the other over the
relay. The right-hand panel per pane carries the connection status, the
relay's per-room chaos controls (drop / delay), and live
inspectors for the document JSON, the wire traffic, and the presence
peers.

Query flags (combined freely):

| Flag           | Effect                                                                                                                                         |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `?client=a\|b` | The pane's letter (the A/B clients of one room)                                                                                                |
| `?syncUrl=…`   | The relay room url (default `ws://localhost:5199/doc-1`)                                                                                       |
| `?catalog=1`   | Seed the deterministic v1 catalog document (the visual-regression fixture)                                                                     |
| `?canvas=1`    | Seed the canvas demo (a page + a surface with shapes, a canvas text, a connector) in its own room (`canvas-demo`) and start in the canvas view |
| `?cycle=1`     | Seed the pane's master doc with a sync-embed referencing the outer doc                                                                         |
| `?ds=1`        | Render the design-system preview panel instead of a pane                                                                                       |

`docblocks-react-ui` is consumed by the playground from its built `dist/`
(consumer view, including the `./motion` subpath): rebuild the packages
first after a source change, or the playground runs the stale build.

## Commands (run from the repo root)

| Command                           | Purpose                                                         |
| --------------------------------- | --------------------------------------------------------------- |
| `npm install`                     | Install all workspaces                                          |
| `npm run build`                   | tsdown builds for both packages (core first)                    |
| `npm run typecheck`               | `tsc --noEmit` in every workspace + the e2e project             |
| `npm test`                        | Vitest unit tests per workspace (run after `npm run build`)     |
| `npm run test:e2e`                | Playwright E2E (starts the playground dev server itself)        |
| `npm run lint` / `lint:fix`       | ESLint (flat config, includes the boundary gates)               |
| `npm run format` / `format:check` | Prettier                                                        |
| `npm run check`                   | Full local gate: lint → format → build → typecheck → test → e2e |

The `Makefile` wraps the npm scripts for the daily loop: `make dev` (the
playground), `make check` (lint + typecheck), `make full` (the full gate),
`make unit` / `make unit-f F=<test file>` (all unit tests / a single file),
`make e2e-file F=<spec>` (a single e2e spec).

## Boundaries (enforced by ESLint)

- `packages/react-ui` must not import `yjs` / `y-protocols` / `lib0` or deep
  `docblocks-core/*` paths — it builds strictly on core's public API
  (`import ... from "docblocks-core"`).
- Inside `packages/core`, layers import only downward: `schema` ← `core` ←
  `sync` (no upward or cross-layer relative imports).
- Core has zero UI dependencies; the React layer is a separate package with a
  peer dependency on core, so consumers keep a single core copy.

## Layout

```
docblocks/
├─ packages/core          # npm: docblocks-core
├─ packages/react-ui      # npm: docblocks-react-ui
├─ apps/playground        # Vite + React 19 dev harness
└─ test/e2e               # Playwright specs
```

## Compatibility

Documents carry the format major version (`v`). Additive changes within a
major — new block types, new marks, new optional attributes — never break
readers of the same major: a reader tolerates unknown block types, marks,
and attributes. Semantic changes introduce a new major version plus a
migration helper.

## Releases

Independent versions via changesets (`npx changeset`, `npx changeset
version`).
