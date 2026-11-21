/** The link's range's reads over the target (the prefill's stand): the
 * link's uniform href over a range (a mixed / the partial's stand stands
 * `null`), the maximal uniform-link's span over a caret (the caret's
 * inside-a-link's expansion — the same href's contiguous runs), and the
 * caret's target's resolution (the expansion's stand, the caret's own
 * insertion's target over the no-link's stand). */
import type { BlockId, Doc, TextPoint } from "docblocks-core";

import { rangeSegments } from "../format-range";
import type { ToolbarRange } from "../format-range";

/** One block's run's spans (the flat offsets + the link's href, `null`
 * over the plain's runs). */
interface Span {
  start: number;
  end: number;
  href: string | null;
}

function spansOf(doc: Doc, blockId: BlockId): Span[] {
  const spans: Span[] = [];
  let pos = 0;
  for (const run of doc.getRuns(blockId)) {
    spans.push({ start: pos, end: pos + run.text.length, href: run.marks.link?.href ?? null });
    pos += run.text.length;
  }
  return spans;
}

/** The range's uniform link href (single / cross): the href when every
 * segment's every overlapping run carries the link with it; `null` over
 * the absent / the mixed's stand. */
function uniformLinkHrefOf(doc: Doc, target: ToolbarRange): string | null {
  const segments: [BlockId, number, number][] =
    target.kind === "single" ? [[target.blockId, target.from, target.to]] : rangeSegments(doc, target.cross);
  let href: string | null = null;
  for (const [blockId, from, to] of segments) {
    if (from >= to) continue;
    for (const span of spansOf(doc, blockId)) {
      const a = Math.max(span.start, from);
      const b = Math.min(span.end, to);
      if (a >= b) continue;
      if (span.href === null) return null; // the plain's intersection's stand
      if (href === null) href = span.href;
      else if (span.href !== href) return null;
    }
  }
  return href;
}

/** The maximal uniform-link's span over a caret: the same href's
 * contiguous's runs containing the caret (a boundary caret belongs to the
 * preceding's run); `null` when the caret stands no link. */
function linkRangeOf(doc: Doc, blockId: BlockId, at: number): { from: number; to: number; href: string } | null {
  const spans = spansOf(doc, blockId);
  let index = -1;
  for (let i = 0; i < spans.length; i += 1) {
    const span = spans[i]!;
    if (at > span.start && at <= span.end) {
      index = i;
      break;
    }
    if (at === span.start && i > 0) {
      index = i - 1; // the boundary's caret stands the preceding's run
      break;
    }
  }
  if (index === -1 || spans[index]!.href === null) return null;
  const href = spans[index]!.href!;
  let from = spans[index]!.start;
  let to = spans[index]!.end;
  for (let i = index - 1; i >= 0 && spans[i]!.href === href; i -= 1) from = spans[i]!.start;
  for (let i = index + 1; i < spans.length && spans[i]!.href === href; i += 1) to = spans[i]!.end;
  return { from, to, href };
}

/** The caret's target (the mod+k's / the caret's gesture's stand): the
 * link's expansion over a caret inside a link, the caret's own insertion's
 * target otherwise (the no-selection's stand — the URL's text lands as the
 * link's label). */
function linkTargetOfCaret(doc: Doc, point: TextPoint): ToolbarRange {
  const expansion = linkRangeOf(doc, point.blockId, point.offset);
  if (expansion !== null) {
    return { kind: "single", blockId: point.blockId, from: expansion.from, to: expansion.to };
  }
  return { kind: "single", blockId: point.blockId, from: point.offset, to: point.offset };
}

export { linkRangeOf, linkTargetOfCaret, uniformLinkHrefOf };
