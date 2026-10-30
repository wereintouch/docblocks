/** The presence overlay's geometry: the deterministic hue (0–359) from
 * the peer id (pure function, no peer state), the caret endpoints a
 * peer's wire selection draws (a range draws range boxes instead), the
 * per-chain-block segments of a peer's range selection (the from block's
 * tail, the middle text blocks in full, the to block's head — chain
 * blocks missing from the store (stale presence) are skipped leniently,
 * and the offsets clamp to the current block lengths), the client rects
 * of a segment inside the block element, relative to the root's rect
 * (environments without layout (jsdom — no getClientRects) yield no
 * rects, so a missing rect maps to a single zero box), the client rect
 * of a collapsed range at the flat offset inside the block element,
 * relative to the root's rect (environments without layout yield zero
 * rects, so a missing rect maps to 0). */
import type { Block, BlockId, Doc, PresenceSelection } from "docblocks-core";

import { locatePosition } from "../editing/dom-offset";
import type { BoxRect, CaretPoint, OverlayBox, RangeSegment } from "./models";

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

export { caretGeometry, caretPointsOf, peerHue, rangeRects, rangeSegmentsOf };
