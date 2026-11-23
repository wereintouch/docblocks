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
import { useCallback, useEffect, useRef } from "react";
import type { ClipboardEvent as ReactClipboardEvent, KeyboardEvent as ReactKeyboardEvent, RefObject } from "react";

import type { Block, BlockId, BlockType, MentionKind } from "docblocks-core";

import { logicalTextOf } from "../editing/dom-offset";
import { useBlockInput } from "../editing/input-safety";
import { useBlockKeyboard } from "../editing/keyboard";
import { useMentionMenuApi } from "../editing/mention";
import { isPageSurfaceInner, usePageSurface } from "../editing/page-surface";
import { useSlashMenuApi } from "../editing/slash";
import { diffTexts } from "../editing/text-diff";
import { useEditorContext } from "../editor-provider";
import type { BlockContextValue } from "../shared/providers/block-context";
import { EMPTY_RUNS, textOf, useTextInnerRebuildApply, useTextInnerRebuildCapture } from "./text-inner-rebuild";
import type { PendingRebuild } from "./text-inner-rebuild";

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
  const { doc, store, selection: selectionRef, mentionProvider } = useEditorContext();

  // The chip's live label over the target's id (the consumer's `resolveLabel`;
  // the absent stand keeps the insertion-time label — the run's text).
  const resolveMentionLabel = useCallback(
    (kind: MentionKind, targetId: string): string | null => mentionProvider?.resolveLabel?.(kind, targetId) ?? null,
    [mentionProvider]
  );

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
  /**
   * A store text change pending for the post-render rebuild (the selection
   * touched the block).
   */
  const pendingRef = useRef<PendingRebuild | null>(null);

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
      // The block chrome (the header's controls) owns its keys: a keydown
      // that bubbles from a control outside the editable content (and the
      // wrapper itself, the gutter selection's focus) stands no block
      // gesture — the native control behavior (the button's Enter/Space
      // click) must not be suppressed by the block's handler.
      const inner = innerRef.current;
      const target = event.target;
      if (target instanceof Element && target !== event.currentTarget && (inner === null || !inner.contains(target)))
        return;
      if (slash !== null && slash.onKeyDown(event, id)) return;
      if (mention !== null && mention.onKeyDown(event, id)) return;
      onGestureKeyDown(event);
      if (event.defaultPrevented) return;
      onInputKeyDown(event);
    },
    [id, onGestureKeyDown, onInputKeyDown, slash, mention]
  );

  useTextInnerRebuildCapture({ id, store, innerRef, pendingRef });
  useTextInnerRebuildApply({ block, storeRuns, innerRef, pendingRef, localCaretRef, appliedRef, resolveMentionLabel });

  // The page surface's dispatch registration (the container-level
  // handlers' source over this block's gestures and commit).
  // The hint's caret's state (the span model): the inner's own :focus
  // stands no more (the focus stands on the page container), so the
  // attribute carries the "the caret stands here" state to the empty
  // hint's rule.
  useEffect(() => {
    const el = innerRef.current;
    if (el === null) return;
    const update = () => {
      const anchor = window.getSelection()?.anchorNode ?? null;
      el.toggleAttribute("data-caret-inside", anchor !== null && el.contains(anchor));
    };
    update();
    document.addEventListener("selectionchange", update);
    return () => document.removeEventListener("selectionchange", update);
  }, []);

  usePageSurfaceRegistration(id, innerRef, { onKeydown, onInput: commitDomDelta, onPaste });

  return { innerRef, onInput: commitDomDelta, onPaste, onKeydown };
}

/**
 * The page surface's registration: the per-block handlers stand in the
 * editor instance's surface registry (the container-level dispatch's
 * source) while the inner is a page-surface text block (the isolated
 * surfaces — the cells, the nested editors — keep their own inner-bound
 * handlers and stand no registration over the outer scope). The entry
 * updates over every handler's identity change; the unmount unregisters.
 */
function usePageSurfaceRegistration(
  id: BlockId,
  innerRef: RefObject<HTMLDivElement | null>,
  handlers: {
    onKeydown: (event: ReactKeyboardEvent<HTMLElement>) => void;
    onInput: () => void;
    onPaste: (event: ReactClipboardEvent<HTMLElement>) => void;
  }
): void {
  const registry = usePageSurface();
  const { onKeydown, onInput, onPaste } = handlers;
  useEffect(() => {
    const inner = innerRef.current;
    if (registry === null || inner === null || isPageSurfaceInner(inner) === false) return;
    registry.register(id, { onKeydown, onInput, onPaste });
    return () => registry.unregister(id);
  }, [registry, id, innerRef, onKeydown, onInput, onPaste]);
}

export { textOf } from "./text-inner-rebuild";
export { useTextInner };
