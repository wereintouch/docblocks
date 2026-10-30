/** The presence overlay's types: the box kinds of the overlay (a caret
 * bar or a range-segment highlight), one rendered box (the peer and the
 * pixel geometry relative to the editor root), a caret endpoint in a
 * block's flattened text, a range segment in one chain block (flat
 * offsets), a box geometry relative to the editor root's rect. */
import type { BlockId } from "docblocks-core";

/** The box kinds of the overlay: a caret bar or a range-segment highlight. */
type OverlaySlot = "docblocks/presence-caret" | "docblocks/presence-range";

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

export type { BoxRect, CaretPoint, OverlayBox, OverlaySlot, RangeSegment };
