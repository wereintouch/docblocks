// Assembles the single shipped stylesheet (dist/styles.css) from the build
// inputs, in the documented section order:
//   1. the header (the file map, below)
//   2. the compiled utility layer (dist/.tmp/ui-layer.css — the tailwindcss
//      CLI output of ui.entry.css: the layered preflight, the primitives'
//      utilities, the enter/exit animation utilities)
//   3. the standard token seed (theme.css: :root light + .dark)
//   4. the --docblocks-* mapping + the structural rules (styles.css)
//
// The package build runs the tailwindcss CLI first (to
// dist/.tmp/ui-layer.css), then this script. The output is plain CSS
// (no build-tool at-rules), so a consumer needs no Tailwind tooling.
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// The package root (one level up from this script's directory).
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path) => readFileSync(path, "utf8");

const HEADER = `/*
 * docblocks-react-ui shipped stylesheet — the single style import.
 *
 * Sections, top to bottom:
 * 1. The compiled utility layer: Tailwind's layered preflight (@layer
 *    base) + the utilities the package's design-system primitives use
 *    (@layer utilities) + the enter/exit animation utilities. The
 *    utilities map to the standard tokens at the use site (var(--…) in
 *    the class), so they follow the active theme and the .dark flip.
 * 2. The standard (shadcn) token seed: :root (light) / .dark. These are
 *    DEFAULTS for the standard tokens, not fixed values: an application
 *    that defines the same tokens on :root / .dark after this import
 *    wins by cascade (same specificity — the later declaration wins),
 *    and the editor and the primitives follow it at once.
 * 3. The --docblocks-* mapping, declared on the editor root
 *    ([data-slot="docblocks/editor"]): each token reads its standard
 *    counterpart with the shipped literal as the fallback. On the
 *    editor root, not on :root — a :root-level var() indirection
 *    resolves at computed-value time on :root and would pin the light
 *    value, never following the .dark flip of the inputs. The dark
 *    block re-declares the theme-dependent tokens under the same class.
 * 4. The structural rules: the flat-row list markers, the list-style
 *    suppression, the empty-block hint, the imperative drag-session
 *    rules.
 *
 * Dark theme: the dark class on the editor root or any ancestor
 * (typically <html>, the shadcn convention).
 *
 * Override model: (1) define the standard tokens after this import —
 * the whole theme follows; (2) override individual --docblocks-* on a
 * selector matching the editor root. The pure token seed (without the
 * utility layer) ships separately as docblocks-react-ui/theme.css.
 *
 * Structural hooks (the DOM surface consumers can target): the
 * data-slot attributes plus data-block-type / data-list / data-depth /
 * data-state and the per-state attributes — the full list is in the
 * source stylesheet's header.
 *
 * User content styling (run color / highlight) is data, not theme: the
 * renderers apply it inline.
 */

`;

// A previous build's artifact (the dropped ./ui.css subpath) must not
// leak into the published dist.
rmSync(`${root}/dist/ui.css`, { force: true });

writeFileSync(
  `${root}/dist/styles.css`,
  HEADER +
    read(`${root}/dist/.tmp/ui-layer.css`) +
    "\n" +
    read(`${root}/theme.css`) +
    "\n" +
    read(`${root}/styles.css`) +
    "\n"
);
