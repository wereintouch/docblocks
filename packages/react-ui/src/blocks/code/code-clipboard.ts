/**
 * The code block's clipboard payload (the copy button's stand): the
 * `text/html`'s payload — the `PRE` over the code's child (the language's
 * class on the `code` element — the producer's convention, the rich paste's
 * pipeline reads it back) + the `text/plain`'s fallback (the external
 * app's stand — the raw text as-is). The plain text's indentation stands
 * (the line numbers are the rendered affordance, not text). The html
 * payload stands the paste's materialization over the code block (the
 * plain payload's markdown pipeline's distortion's guard — the newlines,
 * the indentation, and the markdown-flavored lines stand verbatim).
 */

/** The element's content's escape (the code's text's stand — the
 * `&` / `<` / `>`'s escape over the serialized html). */
function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** The code block's `text/html` payload: the `PRE`'s stand (the rich
 * pipeline's block) over the escaped's text, the language's class over
 * the `code` (the absent's stands the plain). */
function codeBlockHtmlOf(text: string, language: string | undefined): string {
  const classAttr = language !== undefined && language !== "" ? ` class="language-${escapeHtml(language)}"` : "";
  return `<pre><code${classAttr}>${escapeHtml(text)}</code></pre>`;
}

export { codeBlockHtmlOf, escapeHtml };
