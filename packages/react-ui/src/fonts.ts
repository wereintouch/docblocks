/**
 * The package's font subsystem — the single place for the package's fonts.
 *
 * One self-hosted set (the woff2 in `fonts/`; the @font-face declarations in
 * the assembled stylesheet's last section, `fonts/shape-fonts.css`) — a file
 * is fetched only for the used family / weight / subset via `unicode-range`.
 *
 * Three roles share the set:
 * - The UI default font (the editor's chrome + the page text) — `Inter`,
 *   the `--docblocks-font-family` token's default (the consumer's
 *   `--font-sans` override takes priority — the token contract is unchanged).
 * - The shape text's font options (`SHAPE_FONT_OPTIONS` — the shape
 *   `fontFamily` attr's catalog; a consumer's own loaded font is addressable
 *   by its raw name — the absent / an unrecognized name falls to the raw name).
 * - The mono font (the code / latex blocks) — the `--docblocks-mono-
 *   font-family` token's default (the consumer's `--font-mono` override takes
 *   priority).
 *
 * Adding a font:
 * 1. Drop the woff2 in `fonts/` under the `<family>-<weight><i?>-<l|c>.woff2`
 *    naming (l = latin, c = cyrillic).
 * 2. Add the @font-face declarations to `fonts/shape-fonts.css` (a
 *    unicode-range per subset, so a subset is fetched only when used).
 * 3. If the font is a shape option, add it to `SHAPE_FONT_OPTIONS` — the
 *    `SHAPE_FONT_STACKS` map derives from it.
 * The build (`scripts/assemble-styles.mjs`) copies `fonts/` to `dist/fonts/`
 * and appends the @font-face section to the shipped stylesheet.
 */

/** The UI default font's name (self-hosted — the shape set's own Inter). */
const UI_FONT_ID = "Inter";

/**
 * The UI default font's stack: the self-hosted Inter first, then the system
 * fallbacks (a consumer without the package's stylesheet degrades to the
 * system font, not to nothing). Stands the `--docblocks-font-family` token's
 * default.
 */
const UI_FONT_STACK = "'Inter', system-ui, -apple-system, 'Segoe UI', sans-serif";

/**
 * The mono default's stack (the code / latex blocks). Stands the
 * `--docblocks-mono-font-family` token's default.
 */
const MONO_FONT_STACK = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";

export { MONO_FONT_STACK, UI_FONT_ID, UI_FONT_STACK };
export { SHAPE_FONT_OPTIONS, SHAPE_FONT_STACKS } from "./canvas/text-fonts";
