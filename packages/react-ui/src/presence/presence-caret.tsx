import { useStore } from "zustand";

import { useLayoutEffect, useState } from "react";
import type { CSSProperties, RefObject } from "react";

import type { Block, BlockId, Doc, PresenceSelection } from "docblocks-core";

import { locatePosition } from "../editing/dom-offset";
import { useEditorContext } from "../editor-provider";

/** The box kinds of the overlay: a caret bar or a range-segment highlight. */
type OverlaySlot = "docblocks/presence-caret" | "docblocks/presence-range";

/**
 * The structural classes of the overlay boxes (the per-peer hue comes
 * from the inline --docblocks-presence-hue property, the geometry from
 * the inline layout properties). The caret bar is the fixed width token;
 * the range highlight is a softened box of the same hue.
 */
const CARET_CLASS =
  "pointer-events-none absolute w-(--docblocks-presence-caret-width) bg-[hsl(var(--docblocks-presence-hue,200)_var(--docblocks-presence-caret-saturation)_var(--docblocks-presence-caret-lightness))]";
const RANGE_CLASS =
  "pointer-events-none absolute rounded-[2px] bg-[hsl(var(--docblocks-presence-hue,200)_var(--docblocks-presence-caret-saturation)_var(--docblocks-presence-caret-lightness)/var(--docblocks-presence-range-opacity))]";

/** One rendered box: the peer and the pixel geometry relative to the editor root. */
interface OverlayBox {
  key: string;
  peerId: string;
  slot: OverlaySlot;
  /** The segment's block id (range boxes only). */
  blockId?: BlockId;
  left: number;
  top: number;
  height: number;
  /** The rect width (range boxes); undefined for carets (width is a CSS token). */
  width?: number;
}

/** A caret endpoint in a block's flattened text. */
type CaretPoint = { blockId: BlockId; offset: number };

/** A range segment in one chain block (flat offsets). */
interface RangeSegment {
  blockId: BlockId;
  from: number;
  to: number;
}

/** A box geometry relative to the editor root's rect. */
interface BoxRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Deterministic hue (0–359) from the peer id (pure function, no peer state). */
function peerHue(peerId: string): number {
  let hash = 0;
  for (let i = 0; i < peerId.length; i++) hash = (hash * 31 + peerId.charCodeAt(i)) >>> 0;
  return hash % 360;
}

/** The caret endpoints a peer's wire selection draws; a range draws range boxes instead. */
function caretPointsOf(selection: PresenceSelection | null): CaretPoint[] {
  if (selection === null) return [];
  if ("blockId" in selection) return [{ blockId: selection.blockId, offset: selection.offset }];
  return [];
}

/**
 * The per-chain-block segments of a peer's range selection: the from block's
 * tail, the middle text blocks in full, the to block's head. Chain blocks
 * missing from the store (stale presence — the remote selection points at a
 * removed block) are skipped leniently, and the offsets clamp to the current
 * block lengths.
 */
function rangeSegmentsOf(
  selection: PresenceSelection | null,
  doc: Doc,
  blocks: Record<BlockId, Block>
): RangeSegment[] {
  if (selection === null || !("from" in selection)) return [];
  // Without an engine chain, the chain is the endpoints (one when the range
  // is inside a single block).
  const chain =
    selection.blocks ??
    (selection.from.blockId === selection.to.blockId
      ? [selection.from.blockId]
      : [selection.from.blockId, selection.to.blockId]);
  const segments: RangeSegment[] = [];
  for (const blockId of chain) {
    if (blocks[blockId] === undefined) continue;
    const length = doc.getTextLength(blockId);
    const from = blockId === selection.from.blockId ? selection.from.offset : 0;
    const to = blockId === selection.to.blockId ? Math.min(selection.to.offset, length) : length;
    if (from >= to || from >= length) continue;
    segments.push({ blockId, from, to });
  }
  return segments;
}

/**
 * The client rects of a segment inside the block element, relative to the
 * root's rect. Environments without layout (jsdom — no getClientRects)
 * yield no rects, so a missing rect maps to a single zero box.
 */
function rangeRects(root: HTMLElement, block: HTMLElement, from: number, to: number): BoxRect[] {
  const rootRect = root.getBoundingClientRect();
  const start = locatePosition(block, from);
  const end = locatePosition(block, to);
  const range = document.createRange();
  range.setStart(start.node, start.offset);
  range.setEnd(end.node, end.offset);
  if (typeof range.getClientRects !== "function") return [];
  return Array.from(range.getClientRects()).map((rect) => ({
    left: rect.left - rootRect.left,
    top: rect.top - rootRect.top,
    width: rect.width,
    height: rect.height,
  }));
}

/**
 * The client rect of a collapsed range at the flat offset inside the
 * block element, relative to the root's rect. Environments without layout
 * (jsdom — no getClientRects) yield zero rects, so a missing rect maps to 0.
 */
function caretGeometry(
  root: HTMLElement,
  block: HTMLElement,
  offset: number
): Omit<OverlayBox, "key" | "peerId" | "slot"> {
  const position = locatePosition(block, offset);
  const range = document.createRange();
  range.setStart(position.node, position.offset);
  range.collapse(true);
  let rect: DOMRect | undefined;
  if (typeof range.getClientRects === "function") {
    const rects = range.getClientRects();
    rect = rects.length > 0 ? rects[0] : undefined;
  }
  const rootRect = root.getBoundingClientRect();
  return {
    left: rect !== undefined ? rect.left - rootRect.left : 0,
    top: rect !== undefined ? rect.top - rootRect.top : 0,
    height: rect !== undefined ? rect.height : 0,
  };
}

/**
 * Renders remote peers' selections as absolutely positioned boxes over the
 * editor root — a pure view of the presence slice (it never mutates).
 *
 * A caret selection draws a caret bar; a range selection (cross-block
 * included) draws its highlight boxes — one per client rect of each
 * chain-block segment. The boxes are recomputed on presence changes, on
 * block snapshot changes (text shifts the pixels), and on window resize; a
 * peer whose block is not rendered (removed, unknown type) draws nothing.
 */
function PresenceCaretOverlay({ rootRef }: { rootRef: RefObject<HTMLDivElement | null> }) {
  const { store, doc } = useEditorContext();
  const presence = useStore(store, (state) => state.presence);
  // The blocks' wide read stands only with peers (the stable sentinel
  // without them — a doc change with zero peers re-renders nothing here).
  const blocks = useStore(store, (state) => (state.presence.length === 0 ? null : state.blocks));
  const [boxes, setBoxes] = useState<OverlayBox[]>([]);

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (root === null) return;

    const recompute = (): void => {
      const next: OverlayBox[] = [];
      for (const peer of presence) {
        for (const point of caretPointsOf(peer.selection)) {
          // A text-editable block measures inside its inner editable (a
          // nested list's text must not corrupt the flat offset); a
          // non-text block falls back to the wrapper element.
          const block =
            root.querySelector<HTMLElement>(
              `[data-block-id="${point.blockId}"][data-slot="docblocks/block-content"]`
            ) ?? root.querySelector<HTMLElement>(`[data-block-id="${point.blockId}"]`);
          if (block === null) continue;
          next.push({
            key: `${peer.peerId}:caret:${point.blockId}:${point.offset}`,
            peerId: peer.peerId,
            slot: "docblocks/presence-caret",
            ...caretGeometry(root, block, point.offset),
          });
        }
        for (const segment of rangeSegmentsOf(peer.selection, doc, blocks ?? {})) {
          // A range segment is text: it measures inside the inner editable;
          // a block without one (removed, non-text, unrendered) draws nothing.
          const block = root.querySelector<HTMLElement>(
            `[data-block-id="${segment.blockId}"][data-slot="docblocks/block-content"]`
          );
          if (block === null) continue;
          const rects = rangeRects(root, block, segment.from, segment.to);
          // Environments without layout: one zero-geometry box, so the
          // highlight's presence (and data attributes) still renders.
          const measured: BoxRect[] = rects.length > 0 ? rects : [{ left: 0, top: 0, width: 0, height: 0 }];
          measured.forEach((rect, index) => {
            next.push({
              key: `${peer.peerId}:range:${segment.blockId}:${segment.from}-${segment.to}:${index}`,
              peerId: peer.peerId,
              slot: "docblocks/presence-range",
              blockId: segment.blockId,
              ...rect,
            });
          });
        }
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
  }, [presence, blocks, doc, rootRef]);

  return (
    <>
      {boxes.map((box) => (
        <span
          key={box.key}
          data-slot={box.slot}
          data-peer={box.peerId}
          data-range-block={box.blockId}
          className={box.slot === "docblocks/presence-caret" ? CARET_CLASS : RANGE_CLASS}
          style={
            {
              "--docblocks-presence-hue": peerHue(box.peerId),
              left: box.left,
              top: box.top,
              height: box.height,
              ...(box.width !== undefined ? { width: box.width } : null),
            } as CSSProperties
          }
        />
      ))}
    </>
  );
}

export { PresenceCaretOverlay };
export type { OverlayBox };
