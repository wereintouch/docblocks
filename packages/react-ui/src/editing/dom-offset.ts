import { LINE_ANCHOR_SLOT } from "../text/runs-dom";

/**
 * Map DOM positions to flat character offsets over a block's inline text
 * and place DOM selections at flat offsets.
 *
 * A block renders its runs as nested inline elements (marks); a flat
 * offset is the sum of the text-node lengths before the DOM position —
 * the inline mark elements are transparent. The trailing line-break
 * anchor (the zero-width caret seat of a final empty line) is transparent
 * too: it carries no logical character.
 */

/** A DOM caret/endpoint position: the node and the offset within it. */
type DomPosition = { node: Node; offset: number };

/** Whether the node is the line-break anchor element or its text. */
function isLineAnchor(node: Node | null): boolean {
  if (node === null) return false;
  if (node instanceof Element && node.getAttribute("data-slot") === LINE_ANCHOR_SLOT) return true;
  return node.parentElement?.getAttribute("data-slot") === LINE_ANCHOR_SLOT;
}

/** The flat-text length a node contributes (elements sum their descendants; the line anchor contributes 0). */
function textLengthOf(node: Node | null): number {
  if (node === null) return 0;
  if (isLineAnchor(node)) return 0;
  if (node.nodeType === Node.TEXT_NODE) return node.nodeValue?.length ?? 0;
  let sum = 0;
  for (const child of Array.from(node.childNodes)) sum += textLengthOf(child);
  return sum;
}

/** The line-break anchor element inside the root, or null. */
function lineAnchorOf(root: HTMLElement): HTMLElement | null {
  const anchor = root.querySelector<HTMLElement>(`:scope > [data-slot="${LINE_ANCHOR_SLOT}"]`);
  return anchor;
}

/**
 * The flat character offset of a DOM position (node + offset) inside the
 * block root. The node may be a text node (offset in characters) or an
 * element (offset in child slots). A caret on the line anchor (the final
 * empty line) maps to the end of the logical text. A null node or a node
 * outside the root maps to 0.
 */
function caretOffsetIn(root: HTMLElement, node: Node | null, offset: number): number {
  if (node === null || !root.contains(node)) return 0;
  let total = 0;
  const visit = (current: Node): boolean => {
    if (current === node) {
      if (current.nodeType === Node.TEXT_NODE) {
        if (isLineAnchor(current)) return true; // the anchor is a zero-length seat: the offset is the logical end
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
    if (current.nodeType === Node.TEXT_NODE && !isLineAnchor(current)) total += current.nodeValue?.length ?? 0;
    return false;
  };
  visit(root);
  return total;
}

/**
 * The DOM position at a flat character offset. A boundary between two
 * text nodes maps to the end of the previous one; an offset at or beyond
 * the text end maps after all content (atomic, after the trailing line
 * anchor when it stands there: the stable caret seat of the final empty
 * line).
 */
function locatePosition(root: HTMLElement, flatOffset: number): DomPosition {
  if (flatOffset <= 0) return { node: root, offset: 0 };
  const anchor = lineAnchorOf(root);
  // The anchor is a seat for the final empty line only while it is still
  // trailing (the browser may have inserted content after it, making it a
  // mid-text artifact — then the normal walk below places the end). The
  // seat is the atomic position AFTER the anchor (the anchor is
  // contenteditable=false and cannot hold a caret inside it).
  if (anchor !== null && root.lastElementChild === anchor && flatOffset >= textLengthOf(root)) {
    return { node: root, offset: root.childNodes.length };
  }
  let total = 0;
  const visit = (current: Node): DomPosition | null => {
    if (current.nodeType === Node.TEXT_NODE) {
      if (isLineAnchor(current)) return null; // the anchor carries no logical character
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
 * The logical text of the inner editable: the DOM text with the line
 * anchor excluded (it carries no logical character). The anchor may sit
 * mid-text once the browser has inserted content after it, so it is
 * excluded by structure, not by a trailing-character strip. The
 * input-diff and the store-convergence checks compare against this,
 * never the raw text.
 */
function logicalTextOf(root: HTMLElement): string {
  let text = "";
  const visit = (current: Node): void => {
    if (current.nodeType === Node.TEXT_NODE) {
      text += current.nodeValue ?? "";
      return;
    }
    if (current.nodeType !== Node.ELEMENT_NODE) return;
    if (isLineAnchor(current)) return;
    for (const child of Array.from(current.childNodes)) visit(child);
  };
  visit(root);
  return text;
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

/**
 * Whether the current DOM selection is orphaned: it has a range whose
 * start container is no longer connected to the document (a rebuild of
 * the element's text detached the selection's nodes). An orphaned
 * selection belongs to the element that was rebuilt — its restore is the
 * recovery.
 */
function selectionOrphaned(): boolean {
  const selection = window.getSelection();
  if (selection === null || selection.rangeCount === 0) return false;
  const node = selection.getRangeAt(0).startContainer;
  return node !== document && !document.contains(node);
}

export { caretOffsetIn, locatePosition, logicalTextOf, restoreSelection, selectionInside, selectionOrphaned };
