/** The block's paste handler (the input-safety's stand over the browser's
 *  default paste — the unmanaged DOM mutation would leave the doc and
 *  the DOM diverged): the payload commits through the doc's commands at
 *  the DOM's selection offset (one transaction, one undo step). A
 *  `text/html` payload is flattened over the clipboard's whitelist (the
 *  marks included); a plain-text payload is inserted as text. The
 *  cross-block range's paste lands at the seam (the range's deletion in
 *  the same transact); the code target and the cell's paragraphs take
 *  the plain payload only (the markdown pipeline does not run in a cell).
 */
import { useCallback } from "react";
import type { ClipboardEvent, RefObject } from "react";

import type { BlockId, BlockType, Doc, TextPoint } from "docblocks-core";

import type { BlockContextValue } from "../blocks";
import type { SelectionRef } from "../editor-provider";
import { findParentId, focusCaretIn } from "./block-commands";
import { applyMdPaste, applyRichPaste, plainTextOfHtml } from "./clipboard";
import { caretOffsetIn, restoreSelection } from "./dom-offset";

type BlockPasteArgs = {
  doc: Doc;
  id: BlockId;
  blockType: BlockType;
  context: BlockContextValue;
  selectionRef: SelectionRef;
  innerRef: RefObject<HTMLElement | null>;
  rootBlockId: BlockId;
  /** The cell context (the block is a table cell or lives in one). */
  inCell: boolean;
  declareLocalCaret: (offset: number) => void;
};

function useBlockPaste({
  doc,
  id,
  blockType,
  context,
  selectionRef,
  innerRef,
  rootBlockId,
  inCell,
  declareLocalCaret,
}: BlockPasteArgs) {
  const onPaste = useCallback(
    (event: ClipboardEvent<HTMLElement>) => {
      event.preventDefault();
      const html = event.clipboardData.getData("text/html");
      const text = event.clipboardData.getData("text/plain");

      // The code target takes the plain payload even when the html is
      // present (its data is the raw text — the html pipeline flattens
      // the lines and destroys the indentation).
      const plainWins = blockType === "code";

      // A cross-block range: the range is deleted as text and the paste
      // content lands at the seam — one transaction (one undo step, one
      // wire update), the single-block insert pipeline reused as-is. A
      // range that leaves no seam (the full-selection's stand) takes the
      // paste's content at the root's tail (the selection's replace's
      // stand — nothing dropped).
      const view = selectionRef.view;
      if (view !== null) {
        const selection = view.get();
        if (selection.kind === "text" && selection.to !== null && selection.to.blockId !== selection.from.blockId) {
          // The const locals keep the narrowing inside the transact closure
          // (a property narrowing does not persist past the arrow).
          const from = selection.from;
          const to = selection.to;
          // The seam outlives the transact via a property (a closure-
          // assigned variable is not flow-narrowed past the call).
          const seam: { point: TextPoint | null; landing: { blockId: BlockId; offset: number } | null } = {
            point: null,
            landing: null,
          };
          doc.transact(() => {
            const deleted = doc.deleteTextRange(from, to);
            if (deleted === null) {
              // The range left no seam (the chain's tail stands no text —
              // the full-selection's stand): the paste's content takes the
              // range's place at the root's tail (the selection's replace's
              // stand — the document's content is replaced by the paste,
              // nothing dropped). The ephemeral empty paragraph seats the
              // shared materialization (the pipeline's own seat's removal /
              // merge / convert stands — the seat is fresh, so no
              // keepSeat: no peer caret stands on it).
              const seat = doc.insertBlock("paragraph", undefined, { parent: rootBlockId });
              if (html !== "") {
                seam.landing = applyRichPaste(doc, seat, 0, 0, html);
              } else if (text !== "") {
                seam.landing = applyMdPaste(doc, seat, 0, 0, text);
              }
              seam.point = seam.landing ?? { blockId: seat, offset: 0 };
              return;
            }
            const seamBlock = doc.getBlock(deleted.blockId);
            const seamRaw = seamBlock !== null && seamBlock.type === "code";
            const seamCellId = findParentId(doc, deleted.blockId);
            // The cell seam takes the plain payload only (no markdown
            // pipeline in a cell; an html-only payload degrades to its
            // text), like the code target keeps the raw text.
            const seamCell = seamCellId !== null && doc.getBlock(seamCellId)?.type === "table-cell";
            if (seamCell) {
              const plain = text !== "" ? text : plainTextOfHtml(html);
              if (plain !== "") {
                const normalized = plain.replace(/\r\n?/g, "\n");
                doc.insertText(deleted.blockId, deleted.offset, normalized);
                seam.landing = { blockId: deleted.blockId, offset: deleted.offset + normalized.length };
              }
            } else if (html !== "" && !(seamRaw && text !== "")) {
              // The rich cross paste materializes at the seam (the multi-block
              // pipeline over the seam's open transact; the seam block keeps
              // its id — the peer carets rebase onto it).
              seam.landing = applyRichPaste(doc, deleted.blockId, deleted.offset, deleted.offset, html, {
                keepSeat: true,
              });
            } else if (text !== "") {
              // The plain cross paste goes through the markdown pipeline at
              // the seam (one transact with the range deletion; the seam
              // block keeps its id — the peer carets rebase onto it).
              seam.landing = applyMdPaste(doc, deleted.blockId, deleted.offset, deleted.offset, text, {
                keepSeat: true,
              });
            }
            seam.point = deleted;
          });
          if (seam.point === null) return;
          {
            // The caret seat stands at the seam when the paste materialized
            // nothing (the whitespace-only markdown — the range is deleted
            // and the focus must not be lost).
            const target = seam.landing ?? { blockId: seam.point.blockId, offset: seam.point.offset };
            // Scope the caret seat to this editor's root: the landing block
            // id also exists in the other panes' editors (same doc), and an
            // unscoped document query would seat the caret in the first
            // match in document order.
            const root = innerRef.current?.closest('[data-slot="docblocks/editor"]') ?? document;
            focusCaretIn(target.blockId, target.offset, root);
          }
          return;
        }
      }

      const selection = window.getSelection();
      if (selection === null || selection.rangeCount === 0) return;
      const range = selection.getRangeAt(0);
      // The inner over the closure (not the event's currentTarget — the
      // container-level dispatch stands the event over the page's
      // container, whose text offsets are not the block's).
      const el = innerRef.current;
      if (el === null) return;
      if (!el.contains(range.startContainer) || !el.contains(range.endContainer)) return;
      const anchor = caretOffsetIn(el, range.startContainer, range.startOffset);
      const focus = caretOffsetIn(el, range.endContainer, range.endOffset);
      const from = Math.min(anchor, focus);
      const to = Math.max(anchor, focus);

      // A rich payload: apply the whitelist-flattened runs as doc commands;
      // the selection collapses to its end first, so the store-driven
      // rebuild lands the caret after the inserted text (the rebase path).
      // The code target stands the plain payload (the plainWins gate
      // above) — the raw text is their data; the cell paragraphs stand
      // plain text only (the markdown pipeline does not run in a cell);
      // the html-only fallback keeps the old behavior for every other
      // target when there is no plain to stand on.
      if (html !== "" && !inCell && (!plainWins || text === "")) {
        restoreSelection(el, to, null);
        // The multi-block rich paste materializes at the caret (the caret
        // block split; the code target takes the raw text) — one transact.
        const landing = applyRichPaste(doc, id, from, to, html);
        if (landing !== null) {
          if (landing.blockId === id) {
            // The store-driven rebuild consumes the declaration (the DOM
            // selection set before the apply would be re-seated by it).
            declareLocalCaret(landing.offset);
          } else {
            // The landing block is new (the multi-block paste): focusCaretIn
            // defers to the next frame, after the mount.
            const root = innerRef.current?.closest('[data-slot="docblocks/editor"]') ?? document;
            focusCaretIn(landing.blockId, landing.offset, root);
          }
          return;
        }
        // A rich parse that materialized nothing (the whitespace / anchor-only
        // payload) is not a no-op when the plain payload carries content: the
        // paste falls through to the plain branch below (the paste never
        // fails). The html-only whitespace payload has no plain to stand on —
        // the plain branch is a no-op there.
      }

      if (text === "" && !inCell) return;
      // The cell paragraphs take plain text only (the multi-line paste
      // stands as soft breaks; an html-only payload degrades to its text —
      // the marks are dropped).
      if (inCell) {
        const plain = text !== "" ? text : plainTextOfHtml(html);
        if (plain === "") return;
        restoreSelection(el, to, null);
        const normalized = plain.replace(/\r\n?/g, "\n");
        doc.transact(() => {
          if (from < to) doc.deleteText(id, from, to);
          doc.insertText(id, from, normalized);
        });
        declareLocalCaret(from + normalized.length);
        return;
      }
      // The selection must collapse before the apply: the store-driven
      // rebuild re-seats the browser's multi-character selection, and the
      // apply reads the caret from the DOM selection.
      restoreSelection(el, to, null);
      // The markdown paste (the text/plain branch, always-parsed): the
      // blocks materialize at the caret (the caret block split; the
      // code target takes the raw text) — one transact.
      const landing = applyMdPaste(doc, id, from, to, text);
      if (landing !== null) {
        if (landing.blockId === id) {
          // The store-driven rebuild consumes the declaration (the DOM
          // selection set before the apply would be re-seated by it).
          declareLocalCaret(landing.offset);
        } else {
          // The caret block is new (the multi-block paste): focusCaretIn
          // defers to the next frame, after the mount.
          const root = innerRef.current?.closest('[data-slot="docblocks/editor"]') ?? document;
          focusCaretIn(landing.blockId, landing.offset, root);
        }
      }
    },
    [doc, id, selectionRef, context]
  );

  return onPaste;
}

export { useBlockPaste };
