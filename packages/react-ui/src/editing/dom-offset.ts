import type { DomPosition } from "./dom-offset-nodes";
import { chipSlot, isLineAnchor, lineAnchorOf, mentionChipOf, textLengthOf } from "./dom-offset-nodes";

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

/**
 * The caret's seat at a mention chip's boundary over the ADJACENT editable
 * text: a text node's boundary where one stands on that side and reads
 * back at the same flat offset. The island's element slot (the chip's
 * parent) is the seat of last resort: the WebKit family handles a caret
 * next to a contenteditable=false inline island poorly (the seat collapses
 * toward the block's end), while a text node's boundary is every engine's
 * native path. A text that does not read back at the boundary (another
 * island stands in between) is not adjacent — the element slot stands then.
 */
function chipTextSeat(root: HTMLElement, chipText: Node, after: boolean, boundary: number): DomPosition | null {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  walker.currentNode = chipText;
  for (let node = after ? walker.nextNode() : walker.previousNode(); node !== null;) {
    if (node instanceof Text && !isLineAnchor(node) && mentionChipOf(node) === null) {
      const seat = { node, offset: after ? 0 : (node.nodeValue?.length ?? 0) };
      if (caretOffsetIn(root, seat.node, seat.offset) === boundary) return seat;
      return null;
    }
    node = after ? walker.nextNode() : walker.previousNode();
  }
  return null;
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
  if (flatOffset <= 0) {
    // The start resolves to the first text node where one stands (not a
    // line anchor, not the mention chip's atomic text): the caret over an
    // element container's offset 0 renders as a zero rect in the engines
    // (the range's bounding box is the text-position's), and the text
    // anchor keeps the read-back's domain (the caretOffsetIn's walk is the
    // text anchor's native path).
    const textWalker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let firstText: Text | null = null;
    let textNode: Node | null = textWalker.nextNode();
    while (textNode !== null) {
      if (textNode instanceof Text && !isLineAnchor(textNode) && mentionChipOf(textNode) === null) {
        firstText = textNode;
        break;
      }
      textNode = textWalker.nextNode();
    }
    if (firstText === null) return { node: root, offset: 0 };
    // A text that leads with a chip (the chip's text precedes the first
    // seatable text): the slot before the first chip stands offset 0 (the
    // chip's text is not a seatable start — the island's stand). The
    // compare's PRECEDING flag = the chip precedes the first text.
    const elementWalker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
    let firstChip: HTMLElement | null = null;
    let element: Node | null = elementWalker.nextNode();
    while (element !== null) {
      if (element instanceof Element) {
        const chip = mentionChipOf(element);
        if (chip !== null) {
          firstChip = chip;
          break;
        }
      }
      element = elementWalker.nextNode();
    }
    if (firstChip !== null && firstText.compareDocumentPosition(firstChip) & Node.DOCUMENT_POSITION_PRECEDING) {
      return chipSlot(firstChip, false);
    }
    return { node: firstText, offset: 0 };
  }
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
      const chip = mentionChipOf(current);
      if (chip !== null) {
        // The atomic island: a caret cannot stand inside the chip's text.
        // A flat offset over the chip snaps to the nearest boundary (the
        // pick's seat stands after the chip, the type's continuation keeps
        // the editable) — the adjacent text node's boundary where one
        // stands on that side, the element slot otherwise.
        if (flatOffset <= total + length) {
          const after = flatOffset - total > length / 2 || flatOffset === total + length;
          const past = after && flatOffset > total;
          const seat = chipTextSeat(root, current, after, past ? total + length : total);
          return seat ?? chipSlot(chip, past);
        }
        total += length;
        return null;
      }
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

/**
 * The selection's focus end as the editor reads it: the engine's
 * `focusNode` / `focusOffset` — except when the range crosses a
 * contenteditable boundary and the focus reads back inside the anchor's
 * own editable (the webkit's clamped focus read-back: the engine clamps
 * the far endpoint there, so the anchor/focus pair cannot express the
 * cross range). The range's endpoints stand the derivation then: the
 * engine's range is faithful across the boundary even when the
 * anchor/focus read-back is not. The direction is the range's (the
 * clamped engine's anchor reads as the range's start) — the focus end is
 * the range's far endpoint over the anchor's, whatever its order.
 */
function effectiveFocusEnd(domSelection: Selection): { node: Node; offset: number } | null {
  if (domSelection.rangeCount === 0) return null;
  const { anchorNode, anchorOffset, focusNode, focusOffset } = domSelection;
  if (focusNode === null || anchorNode === null) return null;
  const range = domSelection.getRangeAt(0);
  const anchorEditable = editableOfNode(anchorNode);
  const startEditable = editableOfNode(range.startContainer);
  const endEditable = range.startContainer === range.endContainer ? startEditable : editableOfNode(range.endContainer);
  const crosses = startEditable !== null && endEditable !== null && startEditable !== endEditable;
  if (crosses && anchorEditable !== null && anchorEditable.contains(focusNode)) {
    // The clamped stand: the far endpoint is the range's, not the read-back's.
    const anchorIsRangeStart = range.startContainer === anchorNode && range.startOffset === anchorOffset;
    return anchorIsRangeStart
      ? { node: range.endContainer, offset: range.endOffset }
      : { node: range.startContainer, offset: range.startOffset };
  }
  return { node: focusNode, offset: focusOffset };
}

/** The contenteditable that owns a node (the node's element or its parent's), or null. */
function editableOfNode(node: Node | null): Element | null {
  const element = node === null ? null : node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
  return element?.closest('[contenteditable="true"]') ?? null;
}

export { editorRootOf, textBlockOfNode } from "./dom-offset-nodes";
export {
  caretOffsetIn,
  effectiveFocusEnd,
  locatePosition,
  logicalTextOf,
  restoreSelection,
  selectionInside,
  selectionOrphaned,
};
