/**
 * The plain-text paste's linkify (the paste's convenience's stand): the
 * bare web's URLs and the email's forms stand the link's mark over the
 * plain's runs — a match splits the run into the plain's parts and the
 * linked span (the span keeps the run's own marks). The code's block / the
 * exclusive code's mark / the already-linked's / the mention's runs stand
 * untouched. The phone's forms stand no auto-link (the digits' false's
 * stand — the versions' / the dates' / the numbers' tokens); the phone's
 * link is the manual's stand (the link editor's `tel:`'s inference).
 *
 * The markdown's explicit links (`[t](u)` / the autolink's `<https://…>`)
 * stand the parser's runs (the link's mark already) and pass through.
 * The faithful import's path (the headless's `importDocument`) stands no
 * linkify — the markdown's semantics stand the explicit's links only.
 */
import { type TextRun, isSafeLinkHref } from "docblocks-core";

/** The combined scan: the bare web's URL or the email's form, the
 *  leftmost's match wins. The URL's look-behind keeps the token's middle
 *  (`xhttps://…` stands the plain); the email's look-behind keeps the
 *  local's token's boundary (the `.` / the `+` / the `-`'s continuation's
 *  stand, the `:`'s exclusion — the `mailto:`'s prefix's residue stands
 *  the plain, not the re-linked's stand). */
const LINKIFY_RE =
  /(?<![A-Za-z0-9])(https?:\/\/[^\s<>"']+)|(?<![\w.:%+-])([A-Za-z0-9._%+-]+@(?:[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?\.)+[A-Za-z]{2,}(?![A-Za-z0-9-]))/g;

/** The bare URL's trailing punctuation (the sentence's end's stand). */
const URL_TRAILING_PUNCT = /[.,;:!?]+$/;

/** The bare URL's href (the trailing punctuation's trim + the unbalanced
 *  closing paren's drop + the non-empty body's gate over the core's
 *  contract; `null` stands the plain's degradation). */
function bareUrlHref(url: string): string | null {
  let body = url.replace(URL_TRAILING_PUNCT, "");
  // The balanced parens' stand (a nested-paren deep-link's `A_(B)` form):
  // a trailing `)` over an unbalanced count is the sentence's paren, not
  // the URL's body.
  if (body.endsWith(")") && (body.match(/\(/g)?.length ?? 0) < (body.match(/\)/g)?.length ?? 0)) {
    body = body.slice(0, -1);
  }
  const schemeEnd = body.indexOf("//") + 2;
  if (schemeEnd < 2 || body.length <= schemeEnd) return null; // the empty body's stand
  return isSafeLinkHref(body) ? body : null;
}

/** One plain run's text over the link's spans: the plain's parts (no
 *  link) and the linked's spans (the href — the URL's trimmed form, the
 *  email's `mailto:`'s form). */
function linkifyText(text: string): Array<{ text: string; link?: string }> {
  const parts: Array<{ text: string; link?: string }> = [];
  let last = 0;
  for (const match of text.matchAll(LINKIFY_RE)) {
    const start = match.index ?? 0;
    const url = match[1];
    let href: string | null = null;
    let span = match[0].length;
    if (url !== undefined) {
      href = bareUrlHref(url);
      if (href !== null) span = href.length; // the trimmed punct's off (the plain's stand)
    } else {
      const candidate = `mailto:${match[2]}`;
      if (isSafeLinkHref(candidate)) href = candidate;
    }
    if (start > last) parts.push({ text: text.slice(last, start) });
    // The span always stands (the linked's form over the href, the plain's
    // over the rejection — the text is never lost).
    if (href !== null) parts.push({ text: text.slice(start, start + span), link: href });
    else parts.push({ text: text.slice(start, start + span) });
    last = start + span;
  }
  if (last < text.length) parts.push({ text: text.slice(last) });
  return parts;
}

/** The runs' linkify: the plain's text's runs stand the split over the
 *  matches (the span keeps the run's marks); the code's / the linked's /
 *  the mention's runs pass through. */
function linkifyRuns(runs: TextRun[]): TextRun[] {
  const out: TextRun[] = [];
  for (const run of runs) {
    const { marks, text } = run;
    if (text === "" || marks.code === true || marks.link !== undefined || marks.mention !== undefined) {
      out.push(run);
      continue;
    }
    for (const part of linkifyText(text)) {
      out.push({ text: part.text, marks: part.link !== undefined ? { ...marks, link: { href: part.link } } : marks });
    }
  }
  return out;
}

export { linkifyRuns };
