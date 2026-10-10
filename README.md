# docblocks

Headless CRDT document engine — a data-layer analog of BlockSuite built on
Yjs, designed to be reused across projects.

**Status:** monorepo scaffold (package manifests, tooling, boundary gates);
engine implementation in progress.

## Packages

| Workspace           | npm name             | Purpose                                                                                                                                     |
| ------------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/core`     | `docblocks-core`     | Headless engine: `schema` (format/types/validator), `core` (`Doc`, commands, transactions, undo, reactivity), `sync` (providers, `attach`). |
| `packages/react-ui` | `docblocks-react-ui` | React rendering + editing layer: hooks, block renderers, caret/selection, keyboard, clipboard.                                              |
| `apps/playground`   | (private)            | Dev harness for visual and sync testing: A/B clients on a local ws relay, inspector, chaos controls.                                        |

Dependency budget of `docblocks-core`: `yjs` + `y-protocols` only (lib0
transitively). `docblocks-react-ui` peers: `docblocks-core`, `react`.

## Commands (run from the repo root)

| Command                           | Purpose                                                         |
| --------------------------------- | --------------------------------------------------------------- |
| `npm install`                     | Install all workspaces                                          |
| `npm run lint` / `lint:fix`       | ESLint (flat config, includes boundary gates)                   |
| `npm run format` / `format:check` | Prettier                                                        |
| `npm run typecheck`               | `tsc --noEmit` in every workspace                               |
| `npm test`                        | Vitest unit tests per workspace                                 |
| `npm run test:e2e`                | Playwright E2E (starts the playground dev server)               |
| `npm run build`                   | tsdown builds for both packages (core first)                    |
| `npm run check`                   | Full local gate: lint → format → build → typecheck → test → e2e |

E2E needs a Playwright browser once: `npx playwright install chromium`.

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
