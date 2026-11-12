/** Renders the own cross-block selection's highlight segments the engine's
 * clamped DOM selection misses: the WebKit engine (the branded Safari —
 * the headless WebKit stands it identically) keeps the selection's content
 * (and its highlight) inside the selection's anchor contenteditable — the
 * cross selection's range spans the editables at its endpoints, but the
 * far endpoint's read-back (and the rendered highlight) stands no
 * crossing. The overlay decides per live selection (the crossing engines'
 * read-back stands no clamping, so they stand no boxes — no double
 * highlight): over the clamped read-back it draws the missed segments as
 * absolute boxes over the editor root (the presence overlay's geometry
 * pipeline — one box per client rect of each chain-block segment),
 * skipping the anchor block the engine's native highlight already covers.
 * A non-crossing DOM selection (a caret re-seated by history over the
 * cross range, an absent selection) stands no native highlight at all —
 * the overlay draws the full chain from the core model there. Read-only
 * mode stands no overlay: the inners stand no contenteditable there, and
 * the native selection crosses as plain text. */
import { useStore } from "zustand";

import { useLayoutEffect, useRef, useState } from "react";
import type { CSSProperties, RefObject } from "react";

import type { Block, BlockId } from "docblocks-core";

import { useEditorContext } from "../editor-provider";
import { rangeRects, rangeSegmentsOf } from "../presence/utils";
import { effectiveFocusEnd } from "./dom-offset";

/** The segment's structural class: the softened box over the --docblocks-own-selection-background token (the engine's default selection's blue — the selection's color is engine-owned, so no standard token maps to it). */
const SEGMENT_CLASS = "pointer-events-none absolute rounded-[2px] bg-(--docblocks-own-selection-background)";

interface SegmentBox {
  key: string;
  blockId: BlockId;
  left: number;
  top: number;
  height: number;
  width: number;
}

function CrossSelectionOverlay({ rootRef }: { rootRef: RefObject<HTMLDivElement | null> }) {
  const { store, doc } = useEditorContext();
  const selection = useStore(store, (state) => state.selection);
  const cross = selection.kind === "text" && selection.to !== null && selection.from.blockId !== selection.to.blockId;

  // The chain's blocks (the presence overlay's reference-stability pattern:
  // a store change re-renders here only when a chain block's snapshot shifts).
  const chainKeyRef = useRef("");
  const chainBlocksCacheRef = useRef<Record<BlockId, Block> | null>(null);
  const chainBlocks = useStore(store, (state) => {
    if (!cross) return null;
    if (selection.kind !== "text" || selection.to === null) return null;
    const chain = selection.blocks ?? [selection.from.blockId, selection.to.blockId];
    const key = chain.join("\u0000");
    const cache = chainBlocksCacheRef.current;
    if (key === chainKeyRef.current && cache !== null) {
      let unchanged = true;
      for (const id of chain) {
        if (cache[id] !== state.blocks[id]) {
          unchanged = false;
          break;
        }
      }
      if (unchanged) return cache;
    }
    const next: Record<BlockId, Block> = {};
    for (const id of chain) {
      const block = state.blocks[id];
      if (block !== undefined) next[id] = block;
    }
    chainKeyRef.current = key;
    chainBlocksCacheRef.current = next;
    return next;
  });

  const [boxes, setBoxes] = useState<SegmentBox[]>([]);

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (root === null || !cross) {
      setBoxes((prev) => (prev.length === 0 ? prev : []));
      return;
    }
    if (selection.kind !== "text" || selection.to === null) return;
    const from = selection.from;
    const to = selection.to;
    const blocks = selection.blocks;

    const recompute = (): void => {
      const domSel = window.getSelection();
      // The engine's anchor editable (the block the native highlight
      // covers): the DOM selection's anchor when readable, the from block
      // otherwise (the DOM anchor is the range's document-earlier end).
      let anchorBlockId = from.blockId;
      const anchorNode = domSel !== null ? domSel.anchorNode : null;
      const anchorEl = anchorNode instanceof Element ? anchorNode : (anchorNode?.parentElement ?? null);
      const anchorWrapper = anchorEl?.closest<HTMLElement>("[data-block-id]") ?? null;
      if (anchorWrapper !== null && anchorWrapper.dataset.blockId !== undefined) {
        anchorBlockId = anchorWrapper.dataset.blockId;
      }
      // The live DOM selection's clamping: the crossing engine's far
      // endpoint read-back stands in the far editable (the effective focus
      // is the raw one); the clamped engine's read-back stays in the anchor
      // editable (the effective focus is the range's far endpoint — the
      // clamped mark). A non-crossing DOM selection (a caret re-seated by
      // history over the cross range, an absent selection) stands no
      // native highlight at all — the full chain stands drawn.
      const range = domSel !== null && domSel.rangeCount > 0 ? domSel.getRangeAt(0) : null;
      const startEditable = range === null ? null : editableOf(range.startContainer, root);
      const endEditable =
        range === null || range.startContainer === range.endContainer
          ? startEditable
          : editableOf(range.endContainer, root);
      const effective = domSel !== null ? effectiveFocusEnd(domSel) : null;
      const rawFocus = domSel !== null ? domSel.focusNode : null;
      const clampedReadBack =
        effective !== null && (effective.node !== rawFocus || effective.offset !== (domSel?.focusOffset ?? -1));
      const crosses = startEditable !== null && endEditable !== null && startEditable !== endEditable;
      // Over the crossing engine (the read-back crosses) the native
      // highlight stands the full range — no boxes.
      if (crosses && clampedReadBack === false) return;
      const next: SegmentBox[] = [];
      for (const segment of rangeSegmentsOf({ from, to, blocks }, doc, chainBlocks ?? {})) {
        // The clamped read-back's stand: the engine's native highlight
        // covers the anchor block's portion — the overlay skips it (no
        // double highlight). The non-crossing stand draws the full chain.
        if (crosses && segment.blockId === anchorBlockId) continue;
        // A range segment is text: it measures inside the inner editable;
        // a block without one (removed, non-text, unrendered) draws nothing.
        const block = root.querySelector<HTMLElement>(
          `[data-block-id="${CSS.escape(segment.blockId)}"][data-slot="docblocks/block-content"]`
        );
        if (block === null) continue;
        const rects = rangeRects(root, block, segment.from, segment.to);
        // Environments without layout: one zero-geometry box, so the
        // highlight's presence (and data attributes) still renders.
        const measured = rects.length > 0 ? rects : [{ left: 0, top: 0, width: 0, height: 0 }];
        measured.forEach((rect, index) => {
          next.push({
            key: `own:${segment.blockId}:${segment.from}-${segment.to}:${index}`,
            blockId: segment.blockId,
            ...rect,
          });
        });
      }
      // Skip the state update when the geometry is unchanged (a remeasure
      // pass can land with identical boxes — no overlay re-render then).
      setBoxes((prev) => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next));
    };

    // The measurement needs settled layout: a store-triggered recompute can
    // land mid-rebuild (a rebased text DOM), so every trigger also remeasures
    // on the next frame, after React has applied the rebuild.
    let frame = 0;
    const scheduleRecompute = (): void => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        frame = 0;
        recompute();
      });
    };

    recompute();
    scheduleRecompute();
    window.addEventListener("resize", scheduleRecompute);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", scheduleRecompute);
    };
  }, [cross, chainBlocks, selection, doc, rootRef]);

  return (
    <>
      {boxes.map((box) => (
        <span
          key={box.key}
          data-slot="docblocks/selection-segment"
          data-block-id={box.blockId}
          className={SEGMENT_CLASS}
          style={{ left: box.left, top: box.top, height: box.height, width: box.width } as CSSProperties}
        />
      ))}
    </>
  );
}

/** The contenteditable the node stands in, over the editor's scope (the
 * cross-boundary's mark for the DOM selection's endpoints). */
function editableOf(node: Node | null, root: HTMLElement): HTMLElement | null {
  if (node === null || root.contains(node) === false) return null;
  const element = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : (node.parentElement ?? null);
  const editable = element?.closest<HTMLElement>('[contenteditable="true"]') ?? null;
  return editable !== null && root.contains(editable) ? editable : null;
}

export { CrossSelectionOverlay };
