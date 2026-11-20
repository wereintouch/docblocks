/**
 * The writer's anchor hint (the degenerate seat's identity's stand): the
 * degenerate reverse cross-editable seat (the base at offset 0 — the
 * Chromium's collapse's stand) loses the browser's anchor's identity over
 * the addRange's seat (the anchor's read-back stands the range's start —
 * the far end), so the writer records the intended anchor (the base, the
 * range's end's stand) over the seat's endpoints; the mapping honors the
 * hint over the exact-match selection (the direction's reverse's stand)
 * and stands no over any other selection (the hint's staleness's no-stand
 * — the endpoints' mismatch's stand).
 */
interface WriterAnchorHint {
  root: ParentNode;
  anchorNode: Node;
  anchorOffset: number;
  startNode: Node;
  startOffset: number;
  endNode: Node;
  endOffset: number;
}

let writerAnchorHint: WriterAnchorHint | null = null;

/** The degenerate seat's intended anchor's record (the mapping's reverse's stand). */
function setWriterAnchorHint(
  root: ParentNode,
  anchorNode: Node,
  anchorOffset: number,
  startNode: Node,
  startOffset: number,
  endNode: Node,
  endOffset: number
): void {
  writerAnchorHint = { root, anchorNode, anchorOffset, startNode, startOffset, endNode, endOffset };
}

/** The root's live hint over the exact-match seat (the staleness's no-stand). */
function writerAnchorHintFor(root: ParentNode, range: Range): WriterAnchorHint | null {
  const hint = writerAnchorHint;
  if (hint === null || hint.root !== root) return null;
  if (hint.startNode !== range.startContainer || hint.startOffset !== range.startOffset) return null;
  if (hint.endNode !== range.endContainer || hint.endOffset !== range.endOffset) return null;
  if (hint.anchorNode !== range.endContainer || hint.anchorOffset !== range.endOffset) return null;
  return hint;
}

export { setWriterAnchorHint, writerAnchorHintFor };
export type { WriterAnchorHint };
