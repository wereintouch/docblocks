/**
 * Map DOM positions to flat character offsets over a block's inline text
 * and place DOM selections at flat offsets.
 *
 * A block renders its runs as nested inline elements (marks); a flat
 * offset is the sum of the text-node lengths before the DOM position —
 * the inline mark elements are transparent.
 */

/** A DOM caret/endpoint position: the node and the offset within it. */
type DomPosition = { node: Node; offset: number };

/** The flat-text length a node contributes (elements sum their descendants). */
function textLengthOf(node: Node | null): number {
  if (node === null) return 0;
  if (node.nodeType === Node.TEXT_NODE) return node.nodeValue?.length ?? 0;
  let sum = 0;
  for (const child of Array.from(node.childNodes)) sum += textLengthOf(child);
  return sum;
}

/**
 * The flat character offset of a DOM position (node + offset) inside the
 * block root. The node may be a text node (offset in characters) or an
 * element (offset in child slots). A null node or a node outside the
 * root maps to 0.
 */
function caretOffsetIn(root: HTMLElement, node: Node | null, offset: number): number {
  if (node === null || !root.contains(node)) return 0;
  let total = 0;
  const visit = (current: Node): boolean => {
    if (current === node) {
      if (current.nodeType === Node.TEXT_NODE) {
        total += offset;
      } else {
        // A caret at a child boundary: only the preceding children count.
        for (let i = 0; i < offset && i < current.childNodes.length; i++) {
          total += textLengthOf(current.childNodes[i] ?? null);
        }
      }
      return true;
    }
    for (const child of Array.from(current.childNodes)) {
      if (visit(child)) return true;
    }
    if (current.nodeType === Node.TEXT_NODE) total += current.nodeValue?.length ?? 0;
    return false;
  };
  visit(root);
  return total;
}

/**
 * The DOM position at a flat character offset. A boundary between two
 * text nodes maps to the end of the previous one; an offset at or beyond
 * the text end maps after all content.
 */
function locatePosition(root: HTMLElement, flatOffset: number): DomPosition {
  if (flatOffset <= 0) return { node: root, offset: 0 };
  let total = 0;
  const visit = (current: Node): DomPosition | null => {
    if (current.nodeType === Node.TEXT_NODE) {
      const length = current.nodeValue?.length ?? 0;
      if (flatOffset <= total + length) return { node: current, offset: flatOffset - total };
      total += length;
      return null;
    }
    for (const child of Array.from(current.childNodes)) {
      const found = visit(child);
      if (found !== null) return found;
    }
    return null;
  };
  const found = visit(root);
  if (found !== null) return found;
  return { node: root, offset: root.childNodes.length };
}

/**
 * Place the DOM selection at flat character offsets inside the block
 * root: a caret when `to` is null, otherwise the span [from, to).
 * Handles the degenerate positions (both endpoints at 0, both at the
 * text end).
 */
function restoreSelection(root: HTMLElement, from: number, to: number | null): void {
  const selection = window.getSelection();
  if (selection === null) return;
  const start = locatePosition(root, from);
  const end = to === null ? start : locatePosition(root, to);
  const range = document.createRange();
  range.setStart(start.node, start.offset);
  range.setEnd(end.node, end.offset);
  selection.removeAllRanges();
  selection.addRange(range);
}

/**
 * Whether the current DOM selection (if any) is inside the element.
 */
function selectionInside(root: HTMLElement): boolean {
  const selection = window.getSelection();
  if (selection === null || selection.rangeCount === 0) return false;
  const range = selection.getRangeAt(0);
  return root.contains(range.startContainer) && root.contains(range.endContainer);
}

export { caretOffsetIn, locatePosition, restoreSelection, selectionInside };
