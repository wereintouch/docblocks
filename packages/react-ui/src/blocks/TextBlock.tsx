import { useStore } from "zustand";

import { useCallback, useEffect, useLayoutEffect, useRef } from "react";
import type { KeyboardEvent, MouseEvent as ReactMouseEvent, ReactNode } from "react";

import type { Block, BlockId, TextRun } from "docblocks-core";

import { useEditorContext } from "../EditorProvider";
import { caretOffsetIn, restoreSelection, selectionInside } from "../editing/dom-offset";
import { useBlockInput } from "../editing/input-safety";
import { useBlockKeyboard } from "../editing/keyboard";
import { useSlashMenuApi } from "../editing/slash";
import { diffTexts, rebaseOffset } from "../editing/text-diff";
import { renderRunsInto } from "../text/runs-dom";
import { useBlockContext } from "./block-context";

/** The text-editable block types (the wrapper tag and data attrs are props). */
type EditableBlock = Extract<
  Block,
  { type: "paragraph" | "heading" | "callout" | "list-item" | "code" | "latex" | "canvas-text" }
>;

interface TextBlockProps {
  id: BlockId;
  block: EditableBlock;
  tag: "div" | "h1" | "h2" | "h3" | "h4" | "h5" | "h6" | "aside" | "li" | "pre";
  /**
   * Content rendered inside the wrapper after the editable: the nested
   * child blocks (list-item) or a custom trailing region (the mermaid
   * diagram preview).
   */
  nested?: ReactNode;
}

const EMPTY_RUNS: TextRun[] = [];

/** The flattened text of the runs. */
function textOf(runs: TextRun[] | undefined): string {
  if (runs === undefined) return "";
  return runs.reduce((text, run) => text + run.text, "");
}

/**
 * A text block: a structural wrapper (tag and data attrs, the gutter
 * handle, the nested children) around one inner contenteditable element.
 *
 * The wrapper is never contenteditable: a nested list item must not hold
 * other blocks' text inside its own editable, or the flat text diff would
 * flatten the nested text into the parent block. React renders only the
 * two elements; the inner text DOM is managed imperatively from the store
 * runs, because a React-managed child tree cannot be reconciled over a DOM
 * the browser edits. While the DOM selection is inside the inner element
 * (the block is focused) the browser owns the text DOM: every input is
 * committed to the doc immediately, and the store (the doc's projection)
 * follows synchronously, so the DOM and the doc always agree. A store
 * text change that reaches the block while the selection is inside (a
 * remote or undo change — the previous store text equals the DOM text)
 * rebuilds the text DOM from the new runs and restores the selection
 * rebased across the store-text delta. When the selection leaves the
 * block, the text DOM is re-synced from the store (the doc is the source
 * of truth; a lagging DOM — e.g. after an undo while editing — is
 * discarded, never committed back). Enter/Shift+Enter, Backspace-at-0,
 * Tab/Shift+Tab, and paste are guarded (useBlockInput): the line-split
 * default is suppressed, the gestures issue doc commands, and paste
 * commits plain text. Known v1 limitations: CJK IME composition is not
 * tracked (composition commits character by character), and mark-only
 * changes are not re-rendered while the caret is inside the block.
 */
function TextBlock({ id, block, tag, nested }: TextBlockProps) {
  const { doc, store, selection: selectionRef } = useEditorContext();
  const blockContext = useBlockContext();
  const selected = useStore(store, (state) => state.selection.kind === "blocks" && state.selection.ids.includes(id));

  const wrapperRef = useRef<HTMLElement | null>(null);
  const innerRef = useRef<HTMLElement | null>(null);
  const slash = useSlashMenuApi();
  const { onKeyDown: onInputKeyDown, onPaste } = useBlockInput({
    id,
    blockType: block.type,
    context: blockContext,
    innerRef,
    wrapperRef,
  });
  const { onKeyDown: onGestureKeyDown } = useBlockKeyboard({
    id,
    blockType: block.type,
    context: blockContext,
    innerRef,
  });

  /**
   * The block's single keydown entry: the open slash menu first (it owns
   * the keys while open), then the keyboard gestures, then the input-
   * safety guards (skipped when a handler already prevented the default,
   * so preventDefault is never doubled).
   */
  const onKeydown = useCallback(
    (event: KeyboardEvent<HTMLElement>) => {
      if (slash !== null && slash.onKeyDown(event, id)) return;
      onGestureKeyDown(event);
      if (event.defaultPrevented) return;
      onInputKeyDown(event);
    },
    [id, onGestureKeyDown, onInputKeyDown, slash]
  );

  /** The last store block snapshot applied to the text DOM. */
  const appliedRef = useRef<Block | null>(null);
  /** A store text change pending for the post-render rebuild (selection inside). */
  const pendingRef = useRef<{ runs: TextRun[]; restore: { from: number; to: number | null } | null } | null>(null);

  const storeRuns = block.content ?? EMPTY_RUNS;

  /** Commit the DOM text as a delta over the store text (one undo step). */
  const commitDomDelta = useCallback(() => {
    const el = innerRef.current;
    if (el === null) return;
    const current = store.getState().blocks[id];
    if (current === undefined) return;
    const delta = diffTexts(textOf("content" in current ? current.content : undefined), el.textContent ?? "");
    if (delta === null) return;
    doc.transact(() => {
      if (delta.deleteLen > 0) doc.deleteText(id, delta.from, delta.from + delta.deleteLen);
      if (delta.inserted.length > 0) doc.insertText(id, delta.from, delta.inserted);
    });
  }, [doc, id, store]);

  // Capture a store text change that reaches while the DOM selection is
  // inside, before the render: zustand notifies synchronously in the doc
  // change handler, so the DOM still holds the text the selection was
  // captured against here.
  useEffect(() => {
    const unsubscribe = store.subscribe((state, prevState) => {
      const nextBlock = state.blocks[id];
      const prevBlock = prevState.blocks[id];
      if (nextBlock === prevBlock) return;
      const nextText = nextBlock !== undefined && "content" in nextBlock ? textOf(nextBlock.content) : "";
      const prevText = prevBlock !== undefined && "content" in prevBlock ? textOf(prevBlock.content) : "";
      if (nextText === prevText) return; // mark/attr-only change: the text DOM stands

      const el = innerRef.current;
      const selection = window.getSelection();
      if (el === null || selection === null || selection.rangeCount === 0) return;
      const range = selection.getRangeAt(0);
      if (!el.contains(range.startContainer) || !el.contains(range.endContainer)) return;

      const from = caretOffsetIn(el, range.startContainer, range.startOffset);
      const to = caretOffsetIn(el, range.endContainer, range.endOffset);
      if ((el.textContent ?? "") === nextText) return; // this block's own input: the DOM already holds the new text

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
    if (pending !== null) {
      pendingRef.current = null;
      renderRunsInto(pending.runs, el);
      appliedRef.current = block;
      // The selection may have left the block between the capture and
      // this commit — then the rebuild alone is the convergence.
      if (pending.restore !== null && selectionInside(el)) {
        restoreSelection(el, pending.restore.from, pending.restore.to);
      }
      return;
    }
    if (!selectionInside(el) && appliedRef.current !== block) {
      renderRunsInto(storeRuns, el);
      appliedRef.current = block;
    }
  });

  const setRefs = useCallback((element: HTMLElement | null) => {
    wrapperRef.current = element;
  }, []);
  const setInnerRef = useCallback((element: HTMLElement | null) => {
    innerRef.current = element;
  }, []);

  /** Gutter click: a blocks selection on this block (Shift extends from the previous anchor). */
  const onGutterClick = useCallback(
    (event: ReactMouseEvent<HTMLButtonElement>) => {
      event.preventDefault();
      const view = selectionRef.view;
      if (view === null) return;
      const current = view.get();
      if (event.shiftKey && current.kind === "blocks") {
        const siblings = doc.getChildren(blockContext.parentId);
        const anchorIndex = siblings.indexOf(current.anchorId);
        const hereIndex = siblings.indexOf(id);
        // Same parent only; a cross-parent range is a v1.1 feature.
        if (anchorIndex !== -1 && hereIndex !== -1) {
          const [low, high] = anchorIndex <= hereIndex ? [anchorIndex, hereIndex] : [hereIndex, anchorIndex];
          view.set({ kind: "blocks", ids: siblings.slice(low, high + 1), anchorId: current.anchorId });
        } else {
          view.set({ kind: "blocks", ids: [id], anchorId: id });
        }
      } else {
        view.set({ kind: "blocks", ids: [id], anchorId: id });
      }
      wrapperRef.current?.focus();
    },
    [blockContext, doc, id, selectionRef]
  );

  /** Keep the gutter mousedown from moving the text caret. */
  const onGutterMouseDown = useCallback((event: ReactMouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
  }, []);

  const Tag = tag;
  return (
    <Tag
      ref={setRefs}
      data-slot={tag === "li" ? "docblocks/list-item" : "docblocks/block"}
      data-block-type={block.type}
      data-block-id={id}
      data-list={block.type === "list-item" ? block.attrs.list : undefined}
      data-checked={block.type === "list-item" ? block.attrs.checked : undefined}
      data-variant={block.type === "callout" ? block.attrs?.variant : undefined}
      data-language={block.type === "code" ? block.attrs?.language : undefined}
      data-display={block.type === "latex" ? (block.attrs.display ? "true" : "false") : undefined}
      data-selected={selected ? "true" : undefined}
      tabIndex={0}
      onKeyDown={onKeydown}
    >
      <button
        type="button"
        data-slot="docblocks/gutter"
        aria-label="Select block"
        onClick={onGutterClick}
        onMouseDown={onGutterMouseDown}
      />
      <div
        ref={setInnerRef}
        contentEditable
        suppressContentEditableWarning
        spellCheck={false}
        data-slot="docblocks/block-content"
        data-block-id={id}
        onInput={commitDomDelta}
        onPaste={onPaste}
      />
      {nested}
    </Tag>
  );
}

export { TextBlock, textOf };
export type { EditableBlock, TextBlockProps };
