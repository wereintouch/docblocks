import type { BlockId, Selection as CoreSelection, Doc, SelectionView } from "docblocks-core";

import { caretOffsetIn } from "./dom-offset";

/**
 * Map the DOM selection to a core Selection for one editor root.
 *
 * Contract:
 * - a selection with both endpoints in one text block maps to the per-block
 *   text range (a caret when collapsed);
 * - a selection with endpoints in (possibly different) text blocks maps to
 *   the text range over the resolved points;
 * - an endpoint in a non-text region (image, divider, table, …) resolves to
 *   the nearest text boundary in reading order: the document-order-first
 *   endpoint to the END of the nearest preceding text block (or the START
 *   of the nearest following one when there is no preceding one), the
 *   document-order-last endpoint the other way around; a range that reaches
 *   into a non-text region only through its endpoints (the range itself
 *   spans a text block) is resolved the same way;
 * - a selection touching no text block maps to a `blocks` selection over
 *   the blocks the range touches (no per-block text range);
 * - a selection inside a nested editor (a sync-embed) or outside the
 *   editor root maps to `none` (the nested editor owns the selection);
 * - `reverse` comes from the anchor/focus order (a right-to-left drag).
 *
 * The engine fills the cross-block `blocks` chain on `set` — the mapping
 * never computes it. Offsets of boundary endpoints come from the doc
 * (getTextLength), not a DOM text walk.
 */
function mapDomSelection(root: HTMLElement, domSelection: Selection | null, doc: Doc): CoreSelection {
  if (domSelection === null || domSelection.rangeCount === 0) return { kind: "none" };
  const { anchorNode, anchorOffset, focusNode, focusOffset } = domSelection;
  if (anchorNode === null || focusNode === null) return { kind: "none" };
  if (!root.contains(anchorNode) || !root.contains(focusNode)) return { kind: "none" };
  // A selection inside a nested editor (a sync-embed) belongs to that
  // editor's own scope; this root maps it to `none`.
  if (!ownScopeOf(anchorNode, root) || !ownScopeOf(focusNode, root)) return { kind: "none" };

  const range = domSelection.getRangeAt(0);
  const anchorBlock = textBlockOf(anchorNode, root);
  const focusBlock = textBlockOf(focusNode, root);
  if (anchorBlock !== null && focusBlock === anchorBlock) {
    return mapTextSelection(anchorBlock, anchorNode, anchorOffset, focusNode, focusOffset);
  }

  // The DOM range's document-order endpoints (the range is never inverted):
  // from/to take the first/last resolved point, `reverse` the anchor order.
  const anchorIsFirst = range.startContainer === anchorNode && range.startOffset === anchorOffset;
  const first: Endpoint = {
    node: anchorIsFirst ? anchorNode : focusNode,
    offset: anchorIsFirst ? anchorOffset : focusOffset,
    textBlock: anchorIsFirst ? anchorBlock : focusBlock,
  };
  const last: Endpoint = {
    node: anchorIsFirst ? focusNode : anchorNode,
    offset: anchorIsFirst ? focusOffset : anchorOffset,
    textBlock: anchorIsFirst ? focusBlock : anchorBlock,
  };

  // A pure non-text selection (the range touches no text block) keeps the
  // blocks-kind mapping.
  if (first.textBlock === null && last.textBlock === null && !rangeTouchesTextBlock(root, range)) {
    return mapBlocksSelection(root, domSelection, anchorBlock);
  }

  const from = resolveEndpoint(doc, root, first, "first");
  const to = resolveEndpoint(doc, root, last, "last");
  if (from === null || to === null) return mapBlocksSelection(root, domSelection, anchorBlock);

  // Degenerate resolution (both endpoints land on one point): a caret.
  if (from.blockId === to.blockId && from.offset === to.offset) {
    return { kind: "text", from, to: null };
  }
  return {
    kind: "text",
    from,
    to,
    ...(!anchorIsFirst ? { reverse: true } : {}),
  };
}

/** One DOM selection endpoint and its closest text-editable block. */
interface Endpoint {
  node: Node;
  offset: number;
  textBlock: HTMLElement | null;
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

/**
 * Resolve one endpoint to a text point. An endpoint inside a text block is
 * its caret offset there. An endpoint in a non-text region takes the
 * nearest text boundary in reading order per the endpoint's role (see the
 * module header). Null when no boundary exists in either fallback direction.
 */
function resolveEndpoint(
  doc: Doc,
  root: HTMLElement,
  endpoint: Endpoint,
  role: "first" | "last"
): { blockId: BlockId; offset: number } | null {
  if (endpoint.textBlock !== null) {
    return {
      blockId: endpoint.textBlock.dataset.blockId as BlockId,
      offset: caretOffsetIn(endpoint.textBlock, endpoint.node, endpoint.offset),
    };
  }
  const blocks = textBlockElementsIn(root);
  if (role === "first") {
    const preceding = nearestBefore(endpoint.node, blocks);
    if (preceding !== null) return { blockId: blockIdOf(preceding), offset: doc.getTextLength(blockIdOf(preceding)) };
    const following = nearestAfter(endpoint.node, blocks);
    return following === null ? null : { blockId: blockIdOf(following), offset: 0 };
  }
  const following = nearestAfter(endpoint.node, blocks);
  if (following !== null) return { blockId: blockIdOf(following), offset: 0 };
  const preceding = nearestBefore(endpoint.node, blocks);
  return preceding === null ? null : { blockId: blockIdOf(preceding), offset: doc.getTextLength(blockIdOf(preceding)) };
}

/** The block id of a text-editable element. */
function blockIdOf(element: HTMLElement): BlockId {
  return element.dataset.blockId as BlockId;
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

/** Whether the range intersects a text-editable block of the editor. */
function rangeTouchesTextBlock(root: HTMLElement, range: Range): boolean {
  for (const element of textBlockElementsIn(root)) {
    if (range.intersectsNode(element)) return true;
  }
  return false;
}

/**
 * The text-editable blocks of the editor's OWN scope (contenteditable
 * [data-block-id], in DOM order). Blocks of a nested editor (a sync-embed
 * rendering another doc) are excluded: a boundary resolved to a foreign
 * block id would not exist in this doc's `doc`, so the mapping must never
 * consider them (compare the `ownScopeOf` endpoint guard in
 * `mapDomSelection`).
 */
function textBlockElementsIn(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>("[data-block-id]")).filter(
    (element) => isTextBlockElement(element) && ownScopeOf(element, root)
  );
}

/**
 * Whether the element is a text-editable block (the inner contenteditable
 * [data-block-id] element).
 */
function isTextBlockElement(element: HTMLElement): boolean {
  return element.dataset.blockId !== undefined && element.getAttribute("contenteditable") === "true";
}

/** The nearest text-editable block strictly before the node in reading order. */
function nearestBefore(node: Node, blocks: HTMLElement[]): HTMLElement | null {
  for (let i = blocks.length - 1; i >= 0; i--) {
    const element = blocks[i]!;
    if (node.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_PRECEDING) return element;
  }
  return null;
}

/** The nearest text-editable block strictly after the node in reading order. */
function nearestAfter(node: Node, blocks: HTMLElement[]): HTMLElement | null {
  for (const element of blocks) {
    if (node.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_FOLLOWING) return element;
  }
  return null;
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
    if (current instanceof HTMLElement && isTextBlockElement(current)) return current;
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

/**
 * Map the DOM selection to the view at gesture time. The browser does not
 * reliably dispatch `selectionchange` for a cross-boundary selection (and
 * headless dispatch is flaky in general), so every gesture that re-bases
 * the DOM selection pushes the mapping to the view itself; the event-based
 * path then stands as the idempotent backstop.
 */
function syncDomSelection(root: HTMLElement, doc: Doc, view: SelectionView): void {
  const next = mapDomSelection(root, window.getSelection(), doc);
  if (!selectionsEqual(next, view.get())) view.set(next);
}

export { mapDomSelection, selectionsEqual, syncDomSelection };
