/** The presence overlay's types: the box kinds of the overlay (a caret
 * bar or a range-segment highlight), one rendered box (the peer and the
 * pixel geometry relative to the editor root), a caret endpoint in a
 * block's flattened text, a range segment in one chain block (flat
 * offsets), a box geometry relative to the editor root's rect. */
import type { BlockId, PresenceSelection } from "docblocks-core";

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

/** The local selection's sharing grant: no sharing, sharing over the whole
 *  room (plaintext), or a targeted user-id list (encrypted per target). */
type PresenceSharingMode = "off" | "everyone" | string[];

/**
 * The consumer's selection cipher (the privacy's stand): the library
 * orchestrates the publish/receive pipeline and the consumer brings the
 * keys. An entry is an opaque string — the algorithm is the consumer's
 * choice.
 */
interface PresenceCrypto {
  /**
   * Encrypt the local selection for the grant: one opaque entry per target
   * (grant order; no target id inside an entry — the recipient tries each
   * entry with its own `decrypt`).
   */
  encrypt(selection: PresenceSelection, grant: string[]): Promise<string[]>;
  /** Try to decrypt a received entry for the local user. Null when the entry is not addressed to the local user. */
  decrypt(entry: string): Promise<PresenceSelection | null>;
}

/** One live roster entry: the peer's identity and whether its selection stands visible to the local user. */
interface PresencePeer {
  peerId: string;
  userId?: string;
  name?: string;
  updatedAt: number;
  /** True when the peer's selection is accepted locally (decrypted, everyone, or legacy plaintext). */
  selectionVisible: boolean;
}

/** The presence sharing's session state (per EditorProvider instance). */
interface PresenceSharing {
  /** The local grant (session state; the default "off"; not persisted, not on the wire). */
  sharing: PresenceSharingMode;
  /** Set the local grant. A no-op over the read-only modes. */
  setSharing: (mode: PresenceSharingMode) => void;
  /** The live roster of the connected peers (the identity frames are always published). */
  peers: PresencePeer[];
}

/** The presence identity's wire payload: the stable user id + the optional display label. */
interface PresenceIdentity {
  userId?: string;
  name?: string;
}

export type {
  BoxRect,
  CaretPoint,
  OverlayBox,
  OverlaySlot,
  PresenceCrypto,
  PresenceIdentity,
  PresencePeer,
  PresenceSharing,
  PresenceSharingMode,
  RangeSegment,
};
