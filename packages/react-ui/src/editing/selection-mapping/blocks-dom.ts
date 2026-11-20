/**
 * The text-block DOM primitives of the selection mapping: which elements
 * are text blocks (the inner editable / the read-only block content), the
 * editor's own-scope filter, and the reading-order neighbours a boundary
 * endpoint resolves against.
 */
import type { BlockId } from "docblocks-core";

/**
 * Whether the node sits in the editor root's own scope: inside a deeper
 * nested editor root (a sync-embed rendering another doc) the node
 * belongs to that editor, not this one.
 */
function ownScopeOf(node: Node, root: HTMLElement): boolean {
  const element = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
  const nearest = element?.closest('[data-slot="docblocks/editor"]') ?? null;
  return nearest === root;
}

/**
 * Whether the element is a text block (the inner contenteditable
 * [data-block-id] element). Over the read-only stand the inner is
 * non-editable (the view mode's copy stands the sole reader): its block
 * content element counts too.
 */
function isTextBlockElement(element: HTMLElement, readOnly = false): boolean {
  if (element.dataset.blockId === undefined) return false;
  if (element.getAttribute("contenteditable") === "true") return true;
  return readOnly && element.getAttribute("data-slot") === "docblocks/block-content";
}

/**
 * The text blocks of the editor's OWN scope (the inner text elements, in
 * DOM order). Blocks of a nested editor (a sync-embed rendering another
 * doc) are excluded: a boundary resolved to a foreign block id would not
 * exist in this doc's `doc`, so the mapping must never consider them
 * (compare the `ownScopeOf` endpoint guard in `mapDomSelection`).
 */
function textBlockElementsIn(root: HTMLElement, readOnly = false): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>("[data-block-id]")).filter(
    (element) => isTextBlockElement(element, readOnly) && ownScopeOf(element, root)
  );
}

/**
 * The closest text block that contains the node; null when the node is in
 * a non-text block or outside the editor root.
 */
function textBlockOf(node: Node, root: HTMLElement, readOnly = false): HTMLElement | null {
  let current: Node | null = node;
  while (current !== null && current !== root) {
    if (current instanceof HTMLElement && isTextBlockElement(current, readOnly)) return current;
    current = current.parentNode;
  }
  return null;
}

/**
 * Whether the endpoint stands inside the empty-cell activation layer: the
 * endpoint is the layer itself or a node it contains (the layer's text is
 * local, never doc-derived).
 */
function inActivationLayer(node: Node): boolean {
  const element = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
  return element?.closest('[data-slot="docblocks/cell-activation"]') !== null;
}

/**
 * Whether the endpoint sits inside a database block (the interactive
 * surface with its own cell selection; the cells AND the chrome — the
 * toolbar and the Add row / Add column buttons live outside the
 * `database-grid` scroller but inside the block, so the guard stands the
 * whole block). A DOM caret there carries no doc selection — the block's
 * own keys / gestures own the stand.
 */
function inDatabaseBlock(node: Node): boolean {
  const element = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
  return element?.closest('[data-slot="docblocks/database"]') !== null;
}

/** The block id of a text-editable element. */
function blockIdOf(element: HTMLElement): BlockId {
  return element.dataset.blockId as BlockId;
}

/** The nearest text block strictly before the node in reading order. */
function nearestBefore(node: Node, blocks: HTMLElement[]): HTMLElement | null {
  for (let i = blocks.length - 1; i >= 0; i--) {
    const element = blocks[i]!;
    if (node.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_PRECEDING) return element;
  }
  return null;
}

/** The nearest text block strictly after the node in reading order. */
function nearestAfter(node: Node, blocks: HTMLElement[]): HTMLElement | null {
  for (const element of blocks) {
    if (node.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_FOLLOWING) return element;
  }
  return null;
}

/** The contenteditable that owns a node (the node's element or its parent's), or null. */
function editableOfNode(node: Node | null): Element | null {
  const element = node === null ? null : node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
  return element?.closest('[contenteditable="true"]') ?? null;
}

/** Whether the range intersects a text block of the editor. */
function rangeTouchesTextBlock(root: HTMLElement, range: Range, readOnly = false): boolean {
  for (const element of textBlockElementsIn(root, readOnly)) {
    if (range.intersectsNode(element)) return true;
  }
  return false;
}

export {
  blockIdOf,
  editableOfNode,
  inActivationLayer,
  inDatabaseBlock,
  isTextBlockElement,
  nearestAfter,
  nearestBefore,
  ownScopeOf,
  rangeTouchesTextBlock,
  textBlockElementsIn,
  textBlockOf,
};
