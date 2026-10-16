/**
 * The line metrics of a code block's inner editable: the top (relative to
 * the inner's top edge) and the height of each LOGICAL line. A logical line
 * occupies as many line boxes as its wrapped continuations (the number
 * stands on the first box, the continuations carry no number); an empty
 * line is a single line-height.
 *
 * Environments without layout (jsdom — no `getClientRects` / no computed
 * line metrics) report null: the caller falls back to the static stack
 * (correct while the lines do not wrap).
 */

/** A measured logical line (the line number's anchor). */
interface CodeLineMetric {
  /** The top of the line's first line box, in px from the inner's top edge. */
  top: number;
  /** The line's height (the wrapped line boxes count), in px. */
  height: number;
}

/** The character point {node, offset} of a flat text offset inside the element. */
function pointAt(el: Element, offset: number): { node: Text; offset: number } | null {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode() as Text | null;
  let remaining = offset;
  while (node !== null) {
    const length = node.nodeValue?.length ?? 0;
    if (remaining <= length) return { node, offset: remaining };
    remaining -= length;
    node = walker.nextNode() as Text | null;
  }
  return null;
}

/**
 * Measure the logical lines of the code text against the inner editable's
 * live line boxes (the inner holds the same flat text the store reports).
 * Returns null when the environment cannot measure (the static fallback).
 */
function measureCodeLines(inner: HTMLElement, text: string): CodeLineMetric[] | null {
  const proto = Range.prototype as unknown as { getClientRects?: () => DOMRect[] };
  if (typeof proto.getClientRects !== "function") return null;
  const lineHeight = parseFloat(getComputedStyle(inner).lineHeight);
  if (!Number.isFinite(lineHeight) || lineHeight <= 0) return null;
  const innerRect = inner.getBoundingClientRect();
  if (innerRect.width === 0 && innerRect.height === 0) return null;

  const lines = text.split("\n");
  const metrics: CodeLineMetric[] = [];
  let offset = 0;
  let cursor = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    const isLast = i === lines.length - 1;
    if (line.length > 0) {
      const start = pointAt(inner, offset);
      const end = pointAt(inner, offset + line.length);
      // The line's own characters only (the trailing \n would drag the
      // next line's box into the range).
      if (start !== null && end !== null) {
        const range = document.createRange();
        range.setStart(start.node, start.offset);
        range.setEnd(end.node, end.offset);
        const tops = [...new Set([...range.getClientRects()].map((rect) => Math.round(rect.top - innerRect.top)))].sort(
          (a, b) => a - b
        );
        const first = tops[0];
        if (first !== undefined) {
          const height = tops.length * lineHeight;
          metrics.push({ top: first, height });
          cursor = first + height;
          offset += line.length + 1;
          continue;
        }
      }
      offset += line.length + 1;
    } else if (!isLast) {
      offset += 1; // the lone line break
    }
    // An empty line (or a measurement miss): a single line-height at the
    // running cursor (the empty line boxes stack at the line pitch).
    metrics.push({ top: cursor, height: lineHeight });
    cursor += lineHeight;
  }
  return metrics;
}

export { measureCodeLines };
export type { CodeLineMetric };
