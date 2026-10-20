/**
 * The markdown paste parser (the `text/plain` paste branch): decomposes a
 * pasted markdown document or fragment into the v1 block set — headings,
 * paragraphs, lists (bullet/number/task, nesting via the flat `indent`
 * depth), quotes, fenced/indented code, dividers, GFM tables, standalone
 * images, and `$$` math — with the inline marks (bold, italic, strike,
 * code, link, math).
 *
 * The input is a pragmatic subset of CommonMark + GFM: block boundaries
 * are line-based (fences, the setext-vs-thematic `---` discriminator, the
 * 2–4-space list/quote depth, the GFM table shape), and the inline pass
 * resolves the standard emphasis/strike/code/link/math delimiters with
 * nesting and backslash escapes.
 *
 * Inline HTML tags share the same inline pass (a line resolves markdown
 * delimiters and `<tag>` at once): the standard inline tags map to the v1
 * marks (`b`/`strong`, `i`/`em`, `u`, `s`/`strike`/`del`, `code`, `mark`,
 * `a[href]`), `<br>` is the soft line break, and a line that OPENS with a
 * structural tag (`h1`–`h6`, `p`, `ul`, `ol`, `li`, `blockquote`, `pre`,
 * `table`, `hr`) keeps the tags as literal text (no structure). The `code`
 * span is exclusive (its content is raw and carries no other mark, the
 * backtick span's contract). Any other tag (unknown, wrappers, `img`,
 * `sub`/`sup`, unclosed) is dropped with its content kept plain; `style`
 * and the other attributes are ignored.
 * HTML entities are decoded once, AFTER the tag scan, so the decoded
 * `<`/`>` never re-enters the tag parsing.
 * Everything else the v1 registry cannot express (raw HTML blocks, reference-style links, the inline image in
 * the middle of a line, unbalanced delimiters) degrades to literal text —
 * the paste never fails on valid markdown.
 *
 * Line-join nuance: the paragraph soft break is a space (the CommonMark
 * rendering), while the multi-line quote and the list-item continuation
 * keep the source line structure (the `\n` soft-break join — the GitHub
 * rendering), and the indented line right after a list item joins the
 * item's text even at the 4-space indent (the code-inside-item case
 * flattens to the item text — the data is preserved).
 */
export { mdToBlocks } from "./utils";
export type { MdBlockType, MdPasteBlock } from "./models";
