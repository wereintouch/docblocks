import { useCallback } from "react";
import type { ClipboardEvent, KeyboardEvent, RefObject } from "react";

import type { BlockId, BlockType, TextPoint } from "docblocks-core";
import { InvalidAttrsError, InvalidOperationError } from "docblocks-core";

import { useEditorContext } from "../EditorProvider";
import type { BlockContextValue } from "../blocks";
import {
  ensureTrailingParagraph,
  findParentId,
  focusCaretIn,
  indentIn,
  indentOf,
  mergeWithPrevious,
  outdentBlock,
  removeBlocksSelection,
  restoreSelectionIn,
  splitAt,
} from "./block-commands";
import { applyMdPaste, applyRichPaste, plainTextOfHtml } from "./clipboard";
import { handleCrossRangeKey } from "./cross-range-keys";
import { caretOffsetIn, editorRootOf, restoreSelection } from "./dom-offset";
import { useMentionMenuApi } from "./mention";
import { mapDomSelection, selectionsEqual } from "./selection-mapping";
import { useSlashMenuApi } from "./slash";

/**
 * Input safety and the keyboard gestures of one editable block.
 *
 * The browser default for Enter, Shift+Enter, and paste is suppressed: an
 * unmanaged DOM mutation would leave the doc and the DOM diverged. Paste
 * commits through doc commands at the DOM selection offset (one
 * transaction, one undo step): a `text/html` payload is flattened over the
 * clipboard whitelist (marks included), a plain-text payload is inserted
 * as text. Enter splits the block at the caret, Shift+Enter inserts a
 * line break (a `\n` in the run text, rendered through the inner's
 * `white-space: pre-wrap`), Backspace at offset 0 merges with the
 * previous sibling, Tab / Shift+Tab nest / outdent the block (the code
 * block keeps the typewriter Tab: a `\t` at the caret), and a "/" typed in a
 * page text block opens the slash command menu — the character and the
 * query typed after it enter the doc as plain text (the menu filters on
 * the live suffix; code keeps the "/" as plain text).
 * Quote, callout, and code blocks share the soft-line gesture family:
 * Enter on a non-empty line is a line break, Enter on the empty LAST line
 * exits (the preceding lines stand as the block, a new empty paragraph
 * takes the caret, a wholly empty one converts in place), and Backspace
 * at offset 0 never merges a non-empty one with the previous block (the
 * characters delete in place until the block is empty).
 * While a blocks selection is active (the wrapper is focused from the
 * gutter): Delete / Backspace remove the selected blocks, the arrows move
 * a single-block selection to the previous / next sibling, Escape clears it.
 *
 * A text gesture runs only when the DOM selection is a caret inside the
 * block's inner editable; a cross-block or missing selection is a no-op.
 */
function useBlockInput({
  id,
  blockType,
  context,
  innerRef,
  wrapperRef,
  declareLocalCaret,
}: {
  id: BlockId;
  blockType: BlockType;
  context: BlockContextValue;
  innerRef: RefObject<HTMLElement | null>;
  wrapperRef: RefObject<HTMLElement | null>;
  /**
   * Declare the caret the store-driven rebuild should restore (a flat
   * offset in the NEW text). The rebase rule for a change at the caret
   * is the remote-convergence rule (an insertion exactly at the offset
   * does not move it); a local gesture whose caret must land after its
   * own insertion declares it explicitly.
   */
  declareLocalCaret: (offset: number) => void;
}) {
  const { doc, selection: selectionRef, store, rootBlockId } = useEditorContext();
  const slash = useSlashMenuApi();
  const mention = useMentionMenuApi();
  // The cell context (the block is a table cell or lives in one): the cell
  // gestures own the keys — Enter is a soft line break at every position
  // (no split / no exit), Backspace at the line start is a no-op (no
  // merge), and the paste is plain text only (the markdown pipeline does
  // not run in a cell).
  const inCell = context.parentType === "table-cell" || blockType === "table-cell";

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
      // fully deleted range leaves no seam: the data is dropped (the v1
      // edge).
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
            if (deleted === null) return;
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
      const el = event.currentTarget;
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

  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLElement>) => {
      const view = selectionRef.view;
      const inner = innerRef.current;
      if (view === null || inner === null) return;
      let selection = view.get();
      let root: HTMLElement | null = null;

      // The selection is re-mapped from the DOM at event time before any
      // operation acts on it: the view is normally updated by the
      // selectionchange event, which the browser does not dispatch for a
      // cross-boundary selection (and dispatches flakily in general). The
      // mapping is the one the event handler uses; a differing result is
      // pushed to the view there (the same equality guard: a no-op set is
      // skipped). A blocks view (the gutter selection) is never clobbered —
      // the DOM caret left behind by the gutter flow cannot express it.
      const mappedRoot = editorRootOf(event.currentTarget);
      const domSelection = window.getSelection();
      if (selection.kind !== "blocks" && mappedRoot instanceof HTMLElement && domSelection !== null) {
        const fresh = mapDomSelection(mappedRoot, domSelection, doc);
        if (!selectionsEqual(fresh, selection)) view.set(fresh);
        selection = view.get();
        root = mappedRoot;
      }

      // A cross-block text range: the range operations own the keys —
      // shift+arrow/home/end move the selection's focus end (the browser
      // cannot extend a selection across a contenteditable boundary),
      // Delete/Backspace and a printable character replace the range as
      // text, Enter is a no-op; any other key passes through to the
      // browser (the arrows collapse the range to a caret).
      if (selection.kind === "text" && selection.to !== null && selection.to.blockId !== selection.from.blockId) {
        if (root !== null && handleCrossRangeKey(doc, view, selection, root, event)) return;
      }

      if (selection.kind === "blocks") {
        // The wrapper is focused (gutter click): the selection keys act on it.
        if (event.key === "Delete" || event.key === "Backspace") {
          event.preventDefault();
          removeBlocksSelection(doc, context.parentId, selection.ids);
          view.set({ kind: "none" });
          // The document root's tail guarantee (the gesture's one
          // transact stands the stand): the removal stands a non-text last
          // block (or the empty sequence) — the empty paragraph stands
          // after it and the caret seats there (the typeable home).
          if (context.parentId === rootBlockId && rootBlockId === doc.meta.id) {
            const trailingId = ensureTrailingParagraph(doc, doc.meta.id);
            if (trailingId !== null) {
              focusCaretIn(trailingId, 0, wrapperRef.current?.closest("[data-slot='docblocks/editor']") ?? document);
              return;
            }
          }
          // The deleted rows unmount and the browser would drop the focus to
          // the document: park it on the editor root (the undo hotkey reach).
          wrapperRef.current?.closest<HTMLElement>('[data-slot="docblocks/editor"]')?.focus();
          return;
        }
        if (event.key === "Escape") {
          event.preventDefault();
          view.set({ kind: "none" });
          return;
        }
        if (event.key === "ArrowUp" || event.key === "ArrowDown") {
          // A single-block selection held by this wrapper; multi-selections
          // ignore the arrows (v1).
          if (selection.ids.length === 1 && selection.ids[0] === id) {
            const siblings = doc.getChildren(context.parentId);
            const index = siblings.indexOf(id);
            const nextId = event.key === "ArrowUp" ? siblings[index - 1] : siblings[index + 1];
            if (nextId !== undefined) {
              event.preventDefault();
              view.set({ kind: "blocks", ids: [nextId], anchorId: nextId });
              const root = wrapperRef.current?.closest<HTMLElement>('[data-slot="docblocks/editor"]');
              root?.querySelector<HTMLElement>(`[data-block-id="${nextId}"]`)?.focus();
            }
          }
        }
        return;
      }

      // The slash trigger: a "/" with a collapsed caret in a page text block
      // (paragraph, heading, list-item, callout, quote — code is
      // excluded: a "/" there is plain text) at any position and any indent
      // of the root page sequence (or the provider's entry root itself)
      // opens the command menu. The character stands in the doc as a regular
      // one (the editor commits it; the browser's insertion is suppressed) —
      // the menu tracks the text after it (the doc is the query's source
      // of truth), and Backspace deletes it like any other.
      if (
        slash !== null &&
        event.key === "/" &&
        !event.nativeEvent.isComposing &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.altKey
      ) {
        const domSelection = window.getSelection();
        if (domSelection === null || !domSelection.isCollapsed) return;
        if (domSelection.anchorNode === null || !inner.contains(domSelection.anchorNode)) return;
        const block = store.getState().blocks[id];
        if (block === undefined) return;
        const type = block.type;
        const isPageText =
          type === "paragraph" || type === "heading" || type === "list-item" || type === "callout" || type === "quote";
        const inPageSequence = context.parentId === rootBlockId || id === rootBlockId;
        if (isPageText && inPageSequence) {
          const caret = caretOffsetIn(inner, domSelection.anchorNode, domSelection.anchorOffset);
          if (slash.onSlashKey(event, id, context.parentId, caret)) {
            // The key's default is prevented by the trigger: the editor
            // commits the "/" itself (one undo step) and the caret lands
            // after it — declared before the store update, since the
            // rebase rule keeps a caret at the insertion offset in place.
            declareLocalCaret(caret + 1);
            doc.insertText(id, caret, "/");
            return;
          }
        }
      }

      // The mention trigger: an "@" with a collapsed caret in a page text
      // block (the same page-text set as the slash; code is excluded — an
      // "@" there is plain text) at a boundary (the start or after
      // whitespace) opens the mention picker when a provider stands. The
      // character stands in the doc as a regular one (the editor commits
      // it; the browser's insertion is suppressed) — the picker tracks the
      // text after it. Without a provider, or at a non-boundary, the "@" is
      // plain text (the trigger declines and the key flows to the browser).
      if (
        mention !== null &&
        event.key === "@" &&
        !event.nativeEvent.isComposing &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.altKey
      ) {
        const domSelection = window.getSelection();
        if (domSelection === null || !domSelection.isCollapsed) return;
        if (domSelection.anchorNode === null || !inner.contains(domSelection.anchorNode)) return;
        const block = store.getState().blocks[id];
        if (block === undefined) return;
        const type = block.type;
        const isPageText =
          type === "paragraph" || type === "heading" || type === "list-item" || type === "callout" || type === "quote";
        const inPageSequence = context.parentId === rootBlockId || id === rootBlockId;
        if (isPageText && inPageSequence) {
          const caret = caretOffsetIn(inner, domSelection.anchorNode, domSelection.anchorOffset);
          if (mention.onMentionKey(event, id, context.parentId, caret)) {
            declareLocalCaret(caret + 1);
            doc.insertText(id, caret, "@");
            return;
          }
        }
      }

      // isComposing: an Enter during an IME composition commits the
      // candidate text — suppressing it would strand CJK input.
      if (event.key === "Enter" && !event.nativeEvent.isComposing) {
        event.preventDefault();
        const domSelection = window.getSelection();
        if (domSelection === null || domSelection.rangeCount === 0) return;
        if (domSelection.anchorNode === null || domSelection.focusNode === null) return;
        // A caret in this block only: a cross-block or missing selection is
        // a no-op, and an in-block range is a no-op (v1).
        if (!inner.contains(domSelection.anchorNode) || !inner.contains(domSelection.focusNode)) return;
        if (
          domSelection.anchorNode !== domSelection.focusNode ||
          domSelection.anchorOffset !== domSelection.focusOffset
        )
          return;
        const offset = caretOffsetIn(inner, domSelection.anchorNode, domSelection.anchorOffset);
        if (inCell) {
          // The cell context: Enter is a soft line break at every position
          // (the split / exit gestures are the page-level ones — a cell
          // paragraph never splits into a second paragraph).
          declareLocalCaret(offset + 1);
          doc.insertText(id, offset, "\n");
          return;
        }
        if (event.shiftKey) {
          // Shift+Enter is a line break inside the block: one `\n` at the
          // caret. The caret lands after the break — declared before the
          // store update, since the rebase rule keeps a caret at the
          // insertion offset in place and the post-render commit may run
          // synchronously inside the command.
          declareLocalCaret(offset + 1);
          doc.insertText(id, offset, "\n");
          return;
        }
        if (blockType === "quote" || blockType === "callout" || blockType === "code") {
          // Quote, callout, and code share the interactivity: the lines
          // are soft breaks; Enter exits only where the caret's line is
          // empty and is the block's LAST line (nothing follows the
          // caret) — an empty line with a line after it takes a plain
          // break, and so does a non-empty line. The preceding lines
          // stand as the block and the empty last line becomes a new
          // paragraph after it (a wholly empty one converts in place).
          const text = doc.getText(id);
          const caretLineIsEmpty = offset === 0 || text[offset - 1] === "\n";
          if (!(caretLineIsEmpty && offset === text.length)) {
            declareLocalCaret(offset + 1);
            doc.insertText(id, offset, "\n");
            return;
          }
          let focusId: BlockId = id;
          try {
            doc.transact(() => {
              if (text === "") {
                doc.changeBlockType(id, "paragraph");
                return;
              }
              doc.deleteText(id, text.length - 1, text.length);
              const indent = indentOf(doc, id);
              focusId = doc.insertBlock("paragraph", indent !== 0 ? { indent } : undefined, {
                parent: context.parentId,
                after: id,
              });
            });
          } catch (error) {
            // The core's typed rejection rolls the transact back: the
            // gesture is a no-op, not a crash.
            if (error instanceof InvalidAttrsError || error instanceof InvalidOperationError) return;
            throw error;
          }
          focusCaretIn(focusId, 0, editorRootOf(inner));
          return;
        }
        const newId = splitAt(doc, id, context.parentId, offset);
        if (newId !== null) focusCaretIn(newId, 0, editorRootOf(inner));
        return;
      }

      if (event.key === "Backspace" && !event.nativeEvent.isComposing) {
        const domSelection = window.getSelection();
        if (domSelection === null || domSelection.rangeCount === 0 || !domSelection.isCollapsed) return;
        if (domSelection.anchorNode === null || !inner.contains(domSelection.anchorNode)) return;
        const offset = caretOffsetIn(inner, domSelection.anchorNode, domSelection.anchorOffset);
        if (offset !== 0) return; // inside the block: the input diff path handles it
        // The cell context: Backspace at the line start is a no-op — no
        // merge with the previous in-cell paragraph and no exit.
        if (inCell) return;
        // A non-empty quote/callout/code never merges with the previous
        // block: the Backspace keeps deleting the block's own characters
        // (line breaks included) until it is empty, and the empty-block
        // gesture below then resets it to a paragraph.
        if ((blockType === "quote" || blockType === "callout" || blockType === "code") && doc.getTextLength(id) > 0)
          return;
        const merged = mergeWithPrevious(doc, id, context.parentId);
        if (merged === null) return;
        event.preventDefault();
        focusCaretIn(merged.blockId, merged.offset, editorRootOf(inner));
        return;
      }

      if (event.key === "Tab" && !event.nativeEvent.isComposing) {
        if (blockType === "code") {
          // The code block keeps the typewriter Tab: a "\t" at the caret
          // (one insertText) instead of an indent change.
          if (!event.shiftKey) {
            const domSelection = window.getSelection();
            if (
              domSelection !== null &&
              domSelection.rangeCount > 0 &&
              domSelection.isCollapsed &&
              domSelection.anchorNode !== null &&
              inner.contains(domSelection.anchorNode)
            ) {
              const offset = caretOffsetIn(inner, domSelection.anchorNode, domSelection.anchorOffset);
              event.preventDefault();
              // The caret lands after the inserted tab — declared before
              // the store update (the rebase rule keeps a caret at the
              // insertion offset in place).
              declareLocalCaret(offset + 1);
              doc.insertText(id, offset, "\t");
            }
          }
          return;
        }
        // The DOM selection before the gesture: the indent change is a
        // structural edit (a list item re-derives its nesting — in the
        // base view its li moves between lists and remounts), so the
        // gesture's own selection (a caret, or a range within the block)
        // is captured here and re-seated when the remount dropped it.
        const domSelection = window.getSelection();
        let seat: { from: number; to: number | null } | null = null;
        if (
          domSelection !== null &&
          domSelection.rangeCount > 0 &&
          domSelection.anchorNode !== null &&
          domSelection.focusNode !== null &&
          inner.contains(domSelection.anchorNode) &&
          inner.contains(domSelection.focusNode)
        ) {
          const anchor = caretOffsetIn(inner, domSelection.anchorNode, domSelection.anchorOffset);
          const focus = caretOffsetIn(inner, domSelection.focusNode, domSelection.focusOffset);
          const from = Math.min(anchor, focus);
          const to = Math.max(anchor, focus);
          seat = { from, to: to === from ? null : to };
          // The gesture owns the key while the caret sits in this block's
          // text — the browser's default Tab (focus to the next focusable
          // element) must not run, even when the gesture itself is a
          // no-op (a first block's Tab, a top-level Shift+Tab): the focus
          // stays in the text.
          event.preventDefault();
        }
        // The gesture's own inner element: the motion view's exit clone
        // keeps this node connected while the remount adds the survivor,
        // so the re-seat must not mistake the clone for the target.
        const exclude = innerRef.current ?? null;
        const acted = event.shiftKey ? outdentBlock(doc, id, context.parentId) : indentIn(doc, id, context.parentId);
        if (acted) {
          // The flat gesture (updateBlock) keeps the block's element where
          // it stands in the flat-row view (no remount: the selection is
          // already seated). A remount (a base-view list item moving
          // between lists) drops the selection — then the re-seat.
          const freshSelection = window.getSelection();
          const stillSeated =
            inner.isConnected &&
            freshSelection !== null &&
            freshSelection.rangeCount > 0 &&
            freshSelection.anchorNode !== null &&
            inner.contains(freshSelection.anchorNode);
          if (!stillSeated && seat !== null) {
            restoreSelectionIn(doc, id, seat.from, seat.to, editorRootOf(inner), exclude);
          }
        }
      }
    },
    [blockType, context, declareLocalCaret, doc, id, innerRef, rootBlockId, selectionRef, slash, store, wrapperRef]
  );

  return { onKeyDown, onPaste };
}

export { useBlockInput };
