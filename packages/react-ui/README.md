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

For apps without a theme, the shipped stylesheet carries the standard
token seed (light + the `dark` set), so the single import above renders
the editor and the primitives with the canonical shadcn palette. The
pure seed (without the utility layer) also ships as
`docblocks-react-ui/theme.css` — import it for the tokens alone, or copy
its values into your own theme.

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
`--docblocks-selection-background`, the callout warning colors, shadows,
sizes, and the presence tokens) are package defaults and override the same
way.

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
