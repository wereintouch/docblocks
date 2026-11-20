/** The editor root's document-zone keys: the select-all's whole-document
 *  range and the ctrl+home / ctrl+end caret seats (the browser's native
 *  stands degenerate over the nested editables and the shared page
 *  container). */
import type { KeyboardEvent as ReactKeyboardEvent } from "react";

import type { BlockId, Doc } from "docblocks-core";

import { applyDomSelection } from "../block-commands";
import { locatePosition } from "../dom-offset";

interface DocumentKeysDeps {
  doc: Doc;
  rootBlockId: BlockId;
  root: HTMLElement;
  /** The keydown's target (the form-control / canvas guards read it). */
  target: Element | null;
}

/** The text blocks of the document's page sequence (the document-zone span). */
function textBlockIdsOf(doc: Doc, rootBlockId: BlockId): BlockId[] {
  return doc.getChildren(rootBlockId).filter((id) => {
    const block = doc.getBlock(id);
    return block !== null && "content" in block;
  });
}

/**
 * The form controls (their own select-all's stand — the cell's inputs, the
 * panel's) and the canvas view (its own keys' stand) keep the default; the
 * page's editables + the root's parked focus stand the document's stand.
 */
function ownsDocumentKeys(target: Element | null, root: HTMLElement): boolean {
  if (target === null || target === root) return true;
  return target.closest("input, textarea") === null && target.closest('[data-slot="docblocks/canvas-view"]') === null;
}

/**
 * The select-all's stand (both modes' stand — the read-only view's
 * selection stands the document's zone too): the browser's native
 * select-all degenerates to a collapsed caret (the edit's mode) or selects
 * the consumer's whole page (the read-only's mode), so the editor stands
 * the whole-document's selection itself — the first text block's start →
 * the last text block's end (the DOM's cross seat + the mapping's view
 * sync over the selectionchange; the copy/paste/delete's cross paths stand
 * over the range). True = consumed.
 */
function handleSelectAll(event: ReactKeyboardEvent<HTMLDivElement>, deps: DocumentKeysDeps): boolean {
  if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "a" || event.shiftKey) return false;
  if (!ownsDocumentKeys(deps.target, deps.root)) return false;
  event.preventDefault();
  const textIds = textBlockIdsOf(deps.doc, deps.rootBlockId);
  const firstId = textIds[0];
  const lastId = textIds[textIds.length - 1];
  if (firstId === undefined || lastId === undefined) return true;
  const firstInner = deps.root.querySelector<HTMLElement>(
    `[data-block-id="${CSS.escape(firstId)}"][data-slot="docblocks/block-content"]`
  );
  const lastInner =
    firstId === lastId
      ? firstInner
      : deps.root.querySelector<HTMLElement>(
          `[data-block-id="${CSS.escape(lastId)}"][data-slot="docblocks/block-content"]`
        );
  if (firstInner === null || lastInner === null) return true;
  const head = locatePosition(firstInner, 0);
  const tail = locatePosition(lastInner, deps.doc.getTextLength(lastId));
  applyDomSelection(head.node, head.offset, tail.node, tail.offset);
  return true;
}

/**
 * The document's start/end's stand (the Chromium's native's degeneration
 * over the nested editables' stand): the native Ctrl+Home leaves the caret
 * standing (the outer editable's content start stands the panel's island's
 * position, not the document's first text block), so the editor stands the
 * caret's seat itself (the select-all's head/tail's parity — the first
 * text block's start / the last's end, the selection's collapse to the
 * document's edge's stand). The form controls + the canvas view keep their
 * own keys. True = consumed.
 */
function handleDocumentEdge(event: ReactKeyboardEvent<HTMLDivElement>, deps: DocumentKeysDeps): boolean {
  if (!(event.metaKey || event.ctrlKey) || event.shiftKey) return false;
  if (event.key !== "Home" && event.key !== "End") return false;
  if (!ownsDocumentKeys(deps.target, deps.root)) return false;
  event.preventDefault();
  const textIds = textBlockIdsOf(deps.doc, deps.rootBlockId);
  const targetId = event.key === "Home" ? textIds[0] : textIds[textIds.length - 1];
  if (targetId === undefined) return true;
  const inner = deps.root.querySelector<HTMLElement>(
    `[data-block-id="${CSS.escape(targetId)}"][data-slot="docblocks/block-content"]`
  );
  if (inner === null) return true;
  const position = locatePosition(inner, event.key === "Home" ? 0 : deps.doc.getTextLength(targetId));
  applyDomSelection(position.node, position.offset, position.node, position.offset);
  // The caret's scroll's stand (the programmatic seat stands no native
  // scroll, and the scroller is the consumer's — the caret's view over the
  // document's edge). The scroll's API stands over the Element's only (the
  // text node's parent — the seat's text anchor stands no scrollIntoView
  // of its own); the method itself is optional (the jsdom's test's stand —
  // no implementation there).
  const scrollEl: Element | null = position.node instanceof Element ? position.node : position.node.parentElement;
  scrollEl?.scrollIntoView?.({ block: event.key === "Home" ? "start" : "end" });
  return true;
}

export { handleDocumentEdge, handleSelectAll };
