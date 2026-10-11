import type { BlockId, Selection as CoreSelection } from "docblocks-core";

import { caretOffsetIn } from "./dom-offset";

/**
 * Map the DOM selection to a core Selection for one editor root.
 *
 * v1 simplifications (contract):
 * - a selection spanning several blocks maps to a `blocks` selection over
 *   the blocks the range touches (no per-block text range is kept);
 * - a selection inside a non-text block or outside the editor maps to
 *   `none`;
 * - `reverse` comes from the anchor/focus order (a right-to-left drag).
 */
function mapDomSelection(root: HTMLElement, domSelection: Selection | null): CoreSelection {
  if (domSelection === null || domSelection.rangeCount === 0) return { kind: "none" };
  const { anchorNode, anchorOffset, focusNode, focusOffset } = domSelection;
  if (anchorNode === null || focusNode === null) return { kind: "none" };
  if (!root.contains(anchorNode) || !root.contains(focusNode)) return { kind: "none" };
  // A selection inside a nested editor (a sync-embed) belongs to that
  // editor's own scope; this root maps it to `none`.
  if (!ownScopeOf(anchorNode, root) || !ownScopeOf(focusNode, root)) return { kind: "none" };

  const anchorBlock = textBlockOf(anchorNode, root);
  if (anchorBlock !== null && textBlockOf(focusNode, root) === anchorBlock) {
    return mapTextSelection(anchorBlock, anchorNode, anchorOffset, focusNode, focusOffset);
  }
  return mapBlocksSelection(root, domSelection, anchorBlock);
}

/** A selection with both endpoints in one text block. */
function mapTextSelection(
  block: HTMLElement,
  anchorNode: Node,
  anchorOffset: number,
  focusNode: Node,
  focusOffset: number
): CoreSelection {
  const anchor = caretOffsetIn(block, anchorNode, anchorOffset);
  const focus = caretOffsetIn(block, focusNode, focusOffset);
  const reverse = focus < anchor;
  const start = reverse ? focus : anchor;
  const end = reverse ? anchor : focus;
  const blockId = block.dataset.blockId as BlockId;
  return {
    kind: "text",
    from: { blockId, offset: start },
    to: start === end ? null : { blockId, offset: end },
    ...(reverse ? { reverse: true } : {}),
  };
}

/** A selection spanning blocks: the touched block ids in document order. */
function mapBlocksSelection(
  root: HTMLElement,
  domSelection: Selection,
  anchorBlock: HTMLElement | null
): CoreSelection {
  const range = domSelection.getRangeAt(0);
  const ids: BlockId[] = [];
  for (const element of Array.from(root.querySelectorAll<HTMLElement>("[data-block-id]"))) {
    const blockId = element.dataset.blockId as BlockId;
    // A text-editable block carries the id on both the wrapper and the
    // inner editable: count each block once, in document order.
    if (ids.includes(blockId)) continue;
    if (range.intersectsNode(element)) ids.push(blockId);
  }
  if (ids.length === 0) return { kind: "none" };
  const anchorId = anchorBlock !== null ? (anchorBlock.dataset.blockId as BlockId) : ids[0]!;
  return { kind: "blocks", ids, anchorId: ids.includes(anchorId) ? anchorId : ids[0]! };
}

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
 * The closest text block (a contenteditable [data-block-id] element) that
 * contains the node; null when the node is in a non-text block or outside
 * the editor root.
 */
function textBlockOf(node: Node, root: HTMLElement): HTMLElement | null {
  let current: Node | null = node;
  while (current !== null && current !== root) {
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

/**
 * Structural equality over the fields a DOM mapping produces. The
 * engine-maintained `blocks` chain of a text selection is derived from
 * from/to, so it is not compared.
 */
function selectionsEqual(a: CoreSelection, b: CoreSelection): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === "none") return true;
  if (a.kind === "blocks" && b.kind === "blocks") {
    return a.anchorId === b.anchorId && a.ids.length === b.ids.length && a.ids.every((id, i) => id === b.ids[i]);
  }
  if (a.kind === "text" && b.kind === "text") {
    if (a.from.blockId !== b.from.blockId || a.from.offset !== b.from.offset) return false;
    if ((a.to === null) !== (b.to === null)) return false;
    if (a.to !== null && b.to !== null && (a.to.blockId !== b.to.blockId || a.to.offset !== b.to.offset)) {
      return false;
    }
    return a.reverse === b.reverse;
  }
  return false;
}

export { mapDomSelection, selectionsEqual };
