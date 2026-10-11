import { useCallback, useEffect, useLayoutEffect, useRef } from "react";

import type { Block, BlockId, TextRun } from "docblocks-core";

import { useEditorContext } from "../EditorProvider";
import { caretOffsetIn, restoreSelection, selectionInside } from "../editing/dom-offset";
import { diffTexts, rebaseOffset } from "../editing/text-diff";
import { renderRunsInto } from "../text/runs-dom";

/** The four text-editable block types (the wrapper tag and data attrs are props). */
type EditableBlock = Extract<Block, { type: "paragraph" | "heading" | "callout" | "list-item" }>;

interface TextBlockProps {
  id: BlockId;
  block: EditableBlock;
  tag: "p" | "h1" | "h2" | "h3" | "h4" | "h5" | "h6" | "aside" | "li";
}

const EMPTY_RUNS: TextRun[] = [];

/** The flattened text of the runs. */
function textOf(runs: TextRun[] | undefined): string {
  if (runs === undefined) return "";
  return runs.reduce((text, run) => text + run.text, "");
}

/**
 * The editable content of a text block.
 *
 * The block element is a contentEditable wrapper; React renders only the
 * wrapper (tag and data attributes) — the text DOM is managed
 * imperatively from the store runs, because a React-managed child tree
 * cannot be reconciled over a DOM the browser edits. While the DOM
 * selection is inside the block (the block is focused) the browser owns
 * the text DOM: every input is committed to the doc immediately, and the
 * store (the doc's projection) follows synchronously, so the DOM and the
 * doc always agree. A store text change that reaches the block while the
 * selection is inside (a remote or undo change — the previous store text
 * equals the DOM text) rebuilds the text DOM from the new runs and
 * restores the selection rebased across the store-text delta. When the
 * selection leaves the block, the text DOM is re-synced from the store
 * (the doc is the source of truth; a lagging DOM — e.g. after an undo
 * while editing — is discarded, never committed back). Known v1
 * limitations: CJK IME composition is not tracked (composition commits
 * character by character), and mark-only changes are not re-rendered
 * while the caret is inside the block.
 */
function TextBlock({ id, block, tag }: TextBlockProps) {
  const { doc, store } = useEditorContext();

  const contentRef = useRef<HTMLElement | null>(null);
  /** The last store block snapshot applied to the text DOM. */
  const appliedRef = useRef<Block | null>(null);
  /** A store text change pending for the post-render rebuild (selection inside). */
  const pendingRef = useRef<{ runs: TextRun[]; restore: { from: number; to: number | null } | null } | null>(null);

  const storeRuns = block.content ?? EMPTY_RUNS;

  /** Commit the DOM text as a delta over the store text (one undo step). */
  const commitDomDelta = useCallback(() => {
    const el = contentRef.current;
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

      const el = contentRef.current;
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
    const el = contentRef.current;
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

  const setRef = useCallback((element: HTMLElement | null) => {
    contentRef.current = element;
  }, []);

  const Tag = tag;
  return (
    <Tag
      ref={setRef}
      data-block-type={block.type}
      data-block-id={id}
      data-list={block.type === "list-item" ? block.attrs.list : undefined}
      data-checked={block.type === "list-item" ? block.attrs.checked : undefined}
      data-variant={block.type === "callout" ? block.attrs?.variant : undefined}
      contentEditable
      suppressContentEditableWarning
      spellCheck={false}
      onInput={commitDomDelta}
    />
  );
}

export { TextBlock };
export type { EditableBlock, TextBlockProps };
