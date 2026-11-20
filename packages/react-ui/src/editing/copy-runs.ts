/**
 * The copy payload's run primitives: the marks' html wrap, the runs'
 * segments, and the pieces' join. The clipboard's two flavors stand the
 * piece: the plain text and its html.
 */
import { isSafeLinkHref } from "docblocks-core";
import type { Block, TextRun } from "docblocks-core";

/** One clipboard piece: the same block's plain text and its html stand. */
interface ClipboardPiece {
  text: string;
  html: string;
}

/** The clipboard payload: the plain text (`text/plain`) + the html (`text/html`). */
interface ClipboardPayload {
  text: string;
  html: string;
}

/** The HTML-escaped run text. */
function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** The run's text wrapped in its mark's tags (link outermost, then the color spans, then the inline tags). */
function wrapRun(text: string, marks: TextRun["marks"]): string {
  // `code` is exclusive: the run carries no other marks.
  let out = escapeHtml(text);
  if (marks.underline === true) out = `<u>${out}</u>`;
  if (marks.strike === true) out = `<s>${out}</s>`;
  if (marks.italic === true) out = `<em>${out}</em>`;
  if (marks.bold === true) out = `<strong>${out}</strong>`;
  if (marks.code === true) out = `<code>${out}</code>`;
  if (marks.color !== undefined) out = `<span style="color: ${escapeHtml(marks.color.value)}">${out}</span>`;
  if (marks.highlight?.value !== undefined)
    out = `<span style="background-color: ${escapeHtml(marks.highlight.value)}">${out}</span>`;
  if (marks.link !== undefined && isSafeLinkHref(marks.link.href))
    out = `<a href="${escapeHtml(marks.link.href)}">${out}</a>`;
  // The mark's values escape too: a value written over the CRDT's raw
  // (no command's validation) can break the clipboard HTML's attributes
  // — the escape closes the third-party paste target (the local paste
  // re-parses through the whitelist).
  if (marks.mention !== undefined) out = `<span data-mention="${escapeHtml(marks.mention.kind)}">${out}</span>`;
  return out;
}

/** The [from, to) segment of the runs as plain text + html. */
function segmentOf(runs: readonly TextRun[], from: number, to: number): ClipboardPiece {
  let position = 0;
  let text = "";
  let html = "";
  for (const run of runs) {
    const runStart = position;
    const runEnd = position + run.text.length;
    position = runEnd;
    if (runEnd <= from || runStart >= to) continue;
    const segment = run.text.slice(Math.max(from, runStart) - runStart, Math.min(to, runEnd) - runStart);
    // The mention: the plain text is the `@label` form (the display is the
    // label; the copy carries the `@` prefix). The mention is atomic, so the
    // segment is the whole label (a partial slice degrades to the raw label).
    const mention = run.marks.mention;
    text += mention !== undefined && segment === run.text ? `@${segment}` : segment;
    html += wrapRun(segment, run.marks);
  }
  return { text, html };
}

/** The block's runs (a non-content type has none). */
function runsOf(block: Block): readonly TextRun[] {
  return "content" in block ? (block.content ?? []) : [];
}

/** The joined runs' text length. */
function textLengthOf(runs: readonly TextRun[]): number {
  return runs.reduce((sum, run) => sum + run.text.length, 0);
}

/** The pieces joined: the blocks' lines in the plain text, the divs / tables in the html. */
function joinPieces(pieces: readonly ClipboardPiece[]): ClipboardPayload | null {
  if (pieces.length === 0) return null;
  return {
    text: pieces.map((piece) => piece.text).join("\n"),
    html: pieces.map((piece) => piece.html).join(""),
  };
}

export { escapeHtml, joinPieces, runsOf, segmentOf, textLengthOf, wrapRun };
export type { ClipboardPayload, ClipboardPiece };
