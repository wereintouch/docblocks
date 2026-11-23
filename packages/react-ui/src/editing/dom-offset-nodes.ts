/**
 * The DOM node detection (the `./dom-offset`'s shared reads): the editor
 * root's ownership, the text-editable block, the line-break anchor, the
 * mention chip's atomic island, the chip's adjacent slot, and the
 * flat-text length.
 */
import { LINE_ANCHOR_SLOT, MENTION_SLOT } from "../text";

/** A DOM caret/endpoint position: the node and the offset within it. */
type DomPosition = { node: Node; offset: number };

/**
 * The editor root (the docblocks/editor slot element) that owns the node;
 * the document when the node is not inside an editor. A page can render
 * the same doc in several editors (sync panes) — element lookups by block
 * id must be scoped to the one that owns the selection.
 */
function editorRootOf(node: Node): ParentNode {
  const element = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
  return element?.closest<HTMLElement>('[data-slot="docblocks/editor"]') ?? document;
}

/**
 * The closest text-editable block (the inner contenteditable
 * [data-block-id] element) containing the node; null when the node is in a
 * non-text block or detached.
 */
function textBlockOfNode(node: Node): HTMLElement | null {
  let current: Node | null = node;
  while (current !== null) {
    if (
      current instanceof HTMLElement &&
      current.dataset.blockId !== undefined &&
      current.getAttribute("contenteditable") === "true"
    ) {
      return current;
    }
    current = current.parentNode;
  }
  return null;
}

/** Whether the node is the line-break anchor element or its text. */
function isLineAnchor(node: Node | null): boolean {
  if (node === null) return false;
  if (node instanceof Element && node.getAttribute("data-slot") === LINE_ANCHOR_SLOT) return true;
  return node.parentElement?.getAttribute("data-slot") === LINE_ANCHOR_SLOT;
}

/** The mention chip element owning the node (the atomic island's stand). */
function mentionChipOf(node: Node | null): HTMLElement | null {
  if (node === null) return null;
  const element = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : (node.parentElement ?? null);
  return element?.closest<HTMLElement>(`[data-slot="${MENTION_SLOT}"]`) ?? null;
}

/**
 * The element slot adjacent to the mention chip in its own parent (the
 * caret seat before / after the atomic island — the browser cannot seat a
 * caret inside the contenteditable=false chip's text, and a seat at the
 * child slot keeps the offset domain (the caretOffsetIn's walk counts the
 * chip's text over the preceding children)).
 */
function chipSlot(chip: HTMLElement, after: boolean): DomPosition {
  const parent = chip.parentElement ?? chip;
  const index = Array.prototype.indexOf.call(parent.childNodes, chip);
  return { node: parent, offset: (index < 0 ? parent.childNodes.length : index) + (after ? 1 : 0) };
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

export { chipSlot, editorRootOf, isLineAnchor, lineAnchorOf, mentionChipOf, textBlockOfNode, textLengthOf };
export type { DomPosition };
