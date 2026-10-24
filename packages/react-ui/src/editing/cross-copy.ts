import type { BlockId, Doc, Selection, TextRun } from "docblocks-core";

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
  if (marks.color !== undefined) out = `<span style="color: ${marks.color.value}">${out}</span>`;
  if (marks.highlight?.value !== undefined)
    out = `<span style="background-color: ${marks.highlight.value}">${out}</span>`;
  if (marks.link !== undefined) out = `<a href="${escapeHtml(marks.link.href)}">${out}</a>`;
  if (marks.mention !== undefined) out = `<span data-mention="${marks.mention.kind}">${out}</span>`;
  return out;
}

/** The [from, to) segment of the runs as plain text + html. */
function segmentOf(runs: readonly TextRun[], from: number, to: number): { text: string; html: string } {
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

/**
 * The clipboard payload (plain text + html) of a cross-block text range:
 * the covered segment of each chain block (a `<div>` per block, the blocks
 * joined by newlines in the plain text). The browser cannot copy a
 * selection across a contenteditable boundary, so the copy side of a
 * cross range runs through the editor. Null when the selection is not a
 * cross-block range: same-block ranges keep the default copy.
 */
function crossRangeClipboardContent(doc: Doc, selection: Selection): { text: string; html: string } | null {
  if (selection.kind !== "text" || selection.to === null) return null;
  const from = selection.from;
  const to = selection.to;
  if (from.blockId === to.blockId) return null;
  const chain = selection.blocks ?? [from.blockId, to.blockId];
  const segments = chain.map((id: BlockId, index: number) => {
    const block = doc.getBlock(id);
    const runs = block !== null && "content" in block ? (block.content ?? []) : [];
    const length = runs.reduce((sum: number, run: TextRun) => sum + run.text.length, 0);
    // The endpoints' offsets are in their own block; the middle blocks are
    // covered in full. A non-text chain block (e.g. a divider skipped by
    // the extension) has no runs: an empty segment stands for its line.
    const segmentFrom = index === 0 ? from.offset : 0;
    const segmentTo = index === chain.length - 1 ? to.offset : length;
    return segmentOf(runs, segmentFrom, segmentTo);
  });
  return {
    text: segments.map((segment) => segment.text).join("\n"),
    html: segments.map((segment) => `<div>${segment.html}</div>`).join(""),
  };
}

export { crossRangeClipboardContent, segmentOf };
