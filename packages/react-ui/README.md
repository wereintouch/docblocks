# docblocks-react-ui

React rendering and editing layer for the docblocks headless document engine.
The data model, the editing commands, and the sync live in
[`docblocks-core`](https://www.npmjs.com/package/docblocks-core); this package
renders the document and provides the editing surface (caret/selection,
keyboard, clipboard, block renderers, presence overlay).

## Install

```sh
npm i docblocks-react-ui docblocks-core
```

Peer dependencies: `docblocks-core`, `react` (18 or 19), `react-dom`.
Optional peers, used only by their subpaths: `framer-motion` (`./motion`),
`mermaid` (`./mermaid`).

## Usage

```tsx
import { Editor, EditorProvider } from "docblocks-react-ui";
import "docblocks-react-ui/styles.css";

<EditorProvider doc={doc}>
  <Editor />
</EditorProvider>;
```

`EditorProvider` takes the core `Doc` (plus optional sync `provider`,
`blockRenderers` overrides, `blobResolver`, and the sync-embed props). The
`docblocks-react-ui/motion` subpath renders the editor with layout
animations and drag-reorder (requires `framer-motion`);
`docblocks-react-ui/mermaid` renders mermaid diagrams above
`code { language: "mermaid" }` blocks (requires `mermaid`).

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

For apps without a theme, the package ships a plain-CSS seed with the
standard token set (light + dark):

```css
@import "docblocks-react-ui/theme.css"; /* optional: the standard tokens */
@import "docblocks-react-ui/styles.css";
```

`theme.css` contains no build-tool syntax; in a Tailwind v4 app you
typically keep your own token definitions (in `@theme` / globals) and skip
the seed.

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
`--docblocks-selection-background`, the callout warning colors, shadows,
sizes, and the presence tokens) are package defaults and override the same
way.

### Structure

Structural styling hooks are `data-slot` attributes (`docblocks/editor`,
`docblocks/block`, `docblocks/block-content`, …) plus `data-block-type`,
`data-list`, `data-depth`, and the per-state attributes — see the stylesheet
header for the full list. User content styling (run color / highlight) is
document data, not theme, and is applied inline.
