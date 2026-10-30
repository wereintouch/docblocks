/**
 * The text-inner mechanism of one contenteditable bound to a block's runs:
 * the imperative text-DOM ownership, the input commit, the keyboard
 * gestures, and the store-driven rebuild.
 *
 * The inner element is a plain consumer-rendered div: this hook owns its
 * text DOM (the browser edits it; React must not reconcile a DOM the
 * browser edits) and its key handling (the slash menu first, then the
 * keyboard gestures, then the input-safety guards). The consumer passes
 * the wrapper ref (the gestures read the editor root and park the focus
 * from it) — the block's own wrapper for a text row, the inner itself for
 * the table-cell's own content layer.
 *
 * While the DOM selection is inside the inner (the block is focused) the
 * browser owns the text DOM: every input commits a single-region diff to
 * the doc (one undo step), and the store (the doc's projection) follows
 * synchronously, so the DOM and the doc always agree. A store text change
 * that reaches the block while the selection is inside (a remote or undo
 * change — the previous store text equals the DOM text) rebuilds the text
 * DOM from the new runs and restores the selection rebased across the
 * store-text delta; a mark/attrs-only change re-renders the runs in place
 * (the applied formatting is visible without leaving the block) and
 * restores the selection as-is. When the selection leaves the block, the
 * text DOM re-syncs from the store (the doc is the source of truth; a
 * lagging DOM is discarded, never committed back).
 */
import { useCallback, useEffect, useLayoutEffect, useRef } from "react";
import type { ClipboardEvent as ReactClipboardEvent, KeyboardEvent as ReactKeyboardEvent, RefObject } from "react";

import type { Block, BlockId, BlockType, TextRun } from "docblocks-core";

import {
  caretOffsetIn,
  logicalTextOf,
  restoreSelection,
  selectionInside,
  selectionOrphaned,
} from "../editing/dom-offset";
import { useBlockInput } from "../editing/input-safety";
import { useBlockKeyboard } from "../editing/keyboard";
import { useMentionMenuApi } from "../editing/mention";
import { useSlashMenuApi } from "../editing/slash";
import { diffTexts, rebaseOffset } from "../editing/text-diff";
import { useEditorContext } from "../editor-provider";
import { renderRunsInto } from "../text/runs-dom";
import type { BlockContextValue } from "./block-context";

const EMPTY_RUNS: TextRun[] = [];

/** The flattened text of the runs. */
function textOf(runs: TextRun[] | undefined): string {
  if (runs === undefined) return "";
  return runs.reduce((text, run) => text + run.text, "");
}

interface UseTextInnerOptions {
  id: BlockId;
  /** The block snapshot (the runs source; the applied-ref identity). */
  block: Block;
  blockType: BlockType;
  context: BlockContextValue;
  /** The wrapper ref; the inner ref stands in when absent. */
  wrapperRef?: RefObject<HTMLElement | null>;
}

interface UseTextInner {
  /** The inner's ref (a stable RefObject for the consumer's div). */
  innerRef: RefObject<HTMLDivElement | null>;
  onInput: () => void;
  onPaste: (event: ReactClipboardEvent<HTMLElement>) => void;
  onKeydown: (event: ReactKeyboardEvent<HTMLElement>) => void;
}

function useTextInner({ id, block, blockType, context, wrapperRef }: UseTextInnerOptions): UseTextInner {
  const { doc, store, selection: selectionRef } = useEditorContext();

  const innerRef = useRef<HTMLDivElement | null>(null);
  const slash = useSlashMenuApi();
  const mention = useMentionMenuApi();
  /**
   * The caret a local gesture wants restored after the store-driven
   * rebuild (a flat offset in the new text); consumed by the next
   * post-render commit.
   */
  const localCaretRef = useRef<number | null>(null);
  /** The local-caret declaration for the input gestures of this block. */
  const declareLocalCaret = useCallback((offset: number) => {
    localCaretRef.current = offset;
  }, []);

  /** The last store block snapshot applied to the text DOM. */
  const appliedRef = useRef<Block | null>(null);
  /** A store text change pending for the post-render rebuild (selection inside). */
  const pendingRef = useRef<{ runs: TextRun[]; restore: { from: number; to: number | null } | null } | null>(null);

  const storeRuns = "content" in block ? (block.content ?? EMPTY_RUNS) : EMPTY_RUNS;

  /** Commit the DOM text as a delta over the store text (one undo step). */
  const commitDomDelta = useCallback(() => {
    const el = innerRef.current;
    if (el === null) return;
    // A cross-block range is owned by the range operations: a cross DOM
    // selection must not feed the single-region diff (it would commit a
    // garbage region — the store stays the source of truth).
    const selection = selectionRef.view?.get();
    if (selection?.kind === "text" && selection.to !== null && selection.to.blockId !== selection.from.blockId) {
      return;
    }
    const current = store.getState().blocks[id];
    if (current === undefined) return;
    const delta = diffTexts(textOf("content" in current ? current.content : undefined), logicalTextOf(el));
    if (delta === null) return;
    doc.transact(() => {
      if (delta.deleteLen > 0) doc.deleteText(id, delta.from, delta.from + delta.deleteLen);
      if (delta.inserted.length > 0) doc.insertText(id, delta.from, delta.inserted);
    });
  }, [doc, id, selectionRef, store]);

  const { onKeyDown: onInputKeyDown, onPaste } = useBlockInput({
    id,
    blockType,
    context,
    innerRef,
    wrapperRef: wrapperRef ?? innerRef,
    declareLocalCaret,
  });
  const { onKeyDown: onGestureKeyDown } = useBlockKeyboard({
    id,
    blockType,
    context,
    innerRef,
  });

  /**
   * The block's single keydown entry: the open slash menu first (it owns
   * the keys while open), then the keyboard gestures, then the input-
   * safety guards (skipped when a handler already prevented the default,
   * so preventDefault is never doubled).
   */
  const onKeydown = useCallback(
    (event: ReactKeyboardEvent<HTMLElement>) => {
      if (slash !== null && slash.onKeyDown(event, id)) return;
      if (mention !== null && mention.onKeyDown(event, id)) return;
      onGestureKeyDown(event);
      if (event.defaultPrevented) return;
      onInputKeyDown(event);
    },
    [id, onGestureKeyDown, onInputKeyDown, slash, mention]
  );

  // Capture a store block change that reaches while the DOM selection is
  // inside, before the render: zustand notifies synchronously in the doc
  // change handler, so the DOM still holds the text the selection was
  // captured against here. A text change rebases the captured selection
  // across the delta; a mark/attrs-only change re-renders the runs in
  // place (the applied formatting must be visible without leaving the
  // block), restoring the selection as-is.
  useEffect(() => {
    const unsubscribe = store.subscribe((state, prevState) => {
      const nextBlock = state.blocks[id];
      const prevBlock = prevState.blocks[id];
      if (nextBlock === prevBlock) return;
      const nextText = nextBlock !== undefined && "content" in nextBlock ? textOf(nextBlock.content) : "";
      const prevText = prevBlock !== undefined && "content" in prevBlock ? textOf(prevBlock.content) : "";

      const el = innerRef.current;
      const selection = window.getSelection();
      if (el === null || selection === null || selection.rangeCount === 0) return;
      const range = selection.getRangeAt(0);
      if (!el.contains(range.startContainer) || !el.contains(range.endContainer)) return;

      const from = caretOffsetIn(el, range.startContainer, range.startOffset);
      const to = caretOffsetIn(el, range.endContainer, range.endOffset);
      if (nextText === prevText) {
        // Mark/attrs-only change: the text stands, the selection is
        // restored in place (the offsets are valid against the same text).
        pendingRef.current = {
          runs: nextBlock !== undefined && "content" in nextBlock ? (nextBlock.content ?? EMPTY_RUNS) : EMPTY_RUNS,
          restore: { from, to: to === from ? null : to },
        };
        return;
      }
      if (logicalTextOf(el) === nextText) return; // this block's own input: the DOM already holds the new text

      // A remote/undo change: rebuild from the new runs and rebase the
      // captured selection across the store-text delta.
      const delta = diffTexts(prevText, nextText);
      if (delta === null) return;
      const runs = nextBlock !== undefined && "content" in nextBlock ? (nextBlock.content ?? EMPTY_RUNS) : EMPTY_RUNS;
      pendingRef.current = {
        runs,
        restore: { from: rebaseOffset(from, delta), to: to === from ? null : rebaseOffset(to, delta) },
      };
    });
    return unsubscribe;
  }, [id, store]);

  // After the commit: apply the pending rebuild (selection was inside) or
  // re-sync the text DOM from the store whenever the block snapshot
  // changed and the selection is not inside (mount seed included). "Inside"
  // is read from the live DOM selection at apply time, never from a stale
  // focus flag.
  useLayoutEffect(() => {
    const el = innerRef.current;
    if (el === null) return;
    const pending = pendingRef.current;
    const override = localCaretRef.current;
    localCaretRef.current = null;
    if (pending !== null) {
      pendingRef.current = null;
      renderRunsInto(pending.runs, el);
      appliedRef.current = block;
      // The selection may have left the block between the capture and
      // this commit — then the rebuild alone is the convergence. An
      // orphaned selection (its containers detached by the rebuild above)
      // still belongs to this block: the restore is the recovery. A
      // local-caret declaration replaces the rebased offsets (the caret
      // is a collapsed point: no range).
      if (pending.restore !== null && (selectionInside(el) || selectionOrphaned())) {
        restoreSelection(el, override ?? pending.restore.from, override !== null ? null : pending.restore.to);
      }
      return;
    }
    if (!selectionInside(el) && appliedRef.current !== block) {
      renderRunsInto(storeRuns, el);
      appliedRef.current = block;
    }
  });

  return { innerRef, onInput: commitDomDelta, onPaste, onKeydown };
}

export { textOf, useTextInner };
