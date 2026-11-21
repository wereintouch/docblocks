/** The text inner's store-driven rebuild: the store change's capture (the
 *  pre-render selection's rebase over the delta) and its post-render apply
 *  (the runs' re-render + the selection's restore, the cross end's remap
 *  included). */
import { useEffect, useLayoutEffect } from "react";
import type { RefObject } from "react";

import type { Block, BlockId, MentionKind, TextRun } from "docblocks-core";

import {
  caretOffsetIn,
  locatePosition,
  logicalTextOf,
  restoreSelection,
  selectionInside,
  selectionOrphaned,
} from "../editing/dom-offset";
import { diffTexts, rebaseOffset } from "../editing/text-diff";
import type { EditorStore } from "../state";
import { renderRunsInto } from "./runs-dom";

const EMPTY_RUNS: TextRun[] = [];

/** The flattened text of the runs. */
function textOf(runs: TextRun[] | undefined): string {
  if (runs === undefined) return "";
  return runs.reduce((text, run) => text + run.text, "");
}

/**
 * A store text change pending for the post-render rebuild (the selection
 * touched the block). `restore`: both endpoints inside (the in-block
 * selection, rebased); `cross`: one endpoint inside (the cross-block
 * selection's local end — the rebuild detaches the local end's nodes and
 * the browser drops the cross selection, the far end's node stands the
 * re-establish).
 */
type PendingRebuild =
  | { runs: TextRun[]; restore: { from: number; to: number | null } }
  | {
      runs: TextRun[];
      cross: {
        startIsLocal: boolean;
        localOffset: number;
        farNode: Node;
        farOffset: number;
        farBlockId: string | null;
      };
    };

/**
 * The pre-render capture: a store block change that reaches while the DOM
 * selection is inside, before the render (zustand notifies synchronously
 * in the doc change handler, so the DOM still holds the text the selection
 * was captured against here). A text change rebases the captured selection
 * across the delta; a mark/attrs-only change re-renders the runs in place
 * (the applied formatting must be visible without leaving the block),
 * restoring the selection as-is.
 */
function useTextInnerRebuildCapture({
  id,
  store,
  innerRef,
  pendingRef,
}: {
  id: BlockId;
  store: EditorStore;
  innerRef: RefObject<HTMLDivElement | null>;
  pendingRef: RefObject<PendingRebuild | null>;
}): void {
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
      const startInside = el.contains(range.startContainer);
      const endInside = el.contains(range.endContainer);
      if (!startInside && !endInside) return;

      const from = caretOffsetIn(el, range.startContainer, range.startOffset);
      const to = caretOffsetIn(el, range.endContainer, range.endOffset);
      // The cross end's capture (the far end's node + offset, valid until
      // the far block's own rebuild; the far block's id stands the remap
      // when the rebuild ran concurrently): the local end is this block's
      // inside endpoint, the far end the other's.
      const farContainer = startInside ? range.endContainer : range.startContainer;
      const farHost = farContainer.nodeType === Node.TEXT_NODE ? farContainer.parentElement : (farContainer as Element);
      const farBlockId = farHost?.closest("[data-block-id]")?.getAttribute("data-block-id") ?? null;
      const crossCapture = (): {
        startIsLocal: boolean;
        localOffset: number;
        farNode: Node;
        farOffset: number;
        farBlockId: string | null;
      } => ({
        startIsLocal: startInside,
        localOffset: startInside ? from : to,
        farNode: farContainer,
        farOffset: startInside ? range.endOffset : range.startOffset,
        farBlockId,
      });
      if (nextText === prevText) {
        if (startInside && endInside) {
          // Mark/attrs-only change: the text stands, the selection is
          // restored in place (the offsets are valid against the same
          // text).
          pendingRef.current = {
            runs: nextBlock !== undefined && "content" in nextBlock ? (nextBlock.content ?? EMPTY_RUNS) : EMPTY_RUNS,
            restore: { from, to: to === from ? null : to },
          };
          return;
        }
        // The cross end over a mark/attrs-only change: the runs re-render
        // in place (the local end's nodes detach — the cross selection
        // stands the re-establish, the offsets valid against the same
        // text).
        pendingRef.current = {
          runs: nextBlock !== undefined && "content" in nextBlock ? (nextBlock.content ?? EMPTY_RUNS) : EMPTY_RUNS,
          cross: crossCapture(),
        };
        return;
      }
      if (logicalTextOf(el) === nextText) return; // this block's own input: the DOM already holds the new text

      // A remote/undo change: rebuild from the new runs and rebase the
      // captured selection across the store-text delta.
      const delta = diffTexts(prevText, nextText);
      if (delta === null) return;
      const runs = nextBlock !== undefined && "content" in nextBlock ? (nextBlock.content ?? EMPTY_RUNS) : EMPTY_RUNS;
      if (startInside && endInside) {
        pendingRef.current = {
          runs,
          restore: { from: rebaseOffset(from, delta), to: to === from ? null : rebaseOffset(to, delta) },
        };
        return;
      }
      // The cross end over a text change: the local end rebases across the
      // delta, the far end stands (its block's own change — if any — stands
      // its own re-establish over the far end's rebuild).
      const cross = crossCapture();
      pendingRef.current = {
        runs,
        cross: { ...cross, localOffset: rebaseOffset(cross.localOffset, delta) },
      };
    });
    return unsubscribe;
  }, [id, store]);
}

/**
 * The post-render apply: the pending rebuild (the selection was inside) or
 * the text DOM's re-sync from the store whenever the block snapshot changed
 * and the selection is not inside (mount seed included). "Inside" is read
 * from the live DOM selection at apply time, never from a stale focus flag.
 */
function useTextInnerRebuildApply({
  block,
  storeRuns,
  innerRef,
  pendingRef,
  localCaretRef,
  appliedRef,
  resolveMentionLabel,
}: {
  block: Block;
  storeRuns: TextRun[];
  innerRef: RefObject<HTMLDivElement | null>;
  pendingRef: RefObject<PendingRebuild | null>;
  localCaretRef: RefObject<number | null>;
  appliedRef: RefObject<Block | null>;
  resolveMentionLabel: (kind: MentionKind, targetId: string) => string | null;
}): void {
  useLayoutEffect(() => {
    const el = innerRef.current;
    if (el === null) return;
    const pending = pendingRef.current;
    const override = localCaretRef.current;
    localCaretRef.current = null;
    if (pending !== null) {
      pendingRef.current = null;
      renderRunsInto(pending.runs, el, resolveMentionLabel);
      appliedRef.current = block;
      if ("cross" in pending) {
        // The cross end's re-establish: the rebuild detached the local
        // end's nodes (the browser drops the cross selection over them).
        // The far end's node stands unless the far block's own rebuild ran
        // concurrently (its far node then stands the remap over the far
        // block's current inner — the mark/attrs-only change leaves the
        // far text standing, the offset valid as-is; the remap makes the
        // re-establish order-independent over the two blocks' commits).
        // The selection may have left the range between the capture and
        // this commit — the rebuild alone is the convergence then.
        const cross = pending.cross;
        let farNode = cross.farNode;
        let farOffset = cross.farOffset;
        if (!document.contains(farNode) && cross.farBlockId !== null) {
          const scope = el.closest('[data-slot="docblocks/editor"]') ?? document;
          const farInner = scope.querySelector<HTMLElement>(
            `[data-block-id="${CSS.escape(cross.farBlockId)}"][data-slot="docblocks/block-content"]`
          );
          if (farInner !== null) {
            const remap = locatePosition(farInner, cross.farOffset);
            farNode = remap.node;
            farOffset = remap.offset;
          }
        }
        const selection = window.getSelection();
        const stands =
          selection !== null &&
          selection.rangeCount > 0 &&
          (selection.containsNode(farNode, true) || selectionOrphaned());
        if (stands && document.contains(farNode)) {
          const local = locatePosition(el, cross.localOffset);
          const range = document.createRange();
          if (cross.startIsLocal) {
            range.setStart(local.node, local.offset);
            range.setEnd(farNode, farOffset);
          } else {
            range.setStart(farNode, farOffset);
            range.setEnd(local.node, local.offset);
          }
          selection.removeAllRanges();
          selection.addRange(range);
        }
        return;
      }
      // The selection may have left the block between the capture and
      // this commit — then the rebuild alone is the convergence. An
      // orphaned selection (its containers detached by the rebuild above)
      // still belongs to this block: the restore is the recovery. A
      // local-caret declaration replaces the rebased offsets (the caret
      // is a collapsed point: no range).
      if (selectionInside(el) || selectionOrphaned()) {
        restoreSelection(el, override ?? pending.restore.from, override !== null ? null : pending.restore.to);
      }
      return;
    }
    if (!selectionInside(el) && appliedRef.current !== block) {
      renderRunsInto(storeRuns, el, resolveMentionLabel);
      appliedRef.current = block;
    }
  });
}

export { EMPTY_RUNS, textOf, useTextInnerRebuildApply, useTextInnerRebuildCapture };
export type { PendingRebuild };
