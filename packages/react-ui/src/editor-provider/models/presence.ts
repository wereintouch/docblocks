/** The presence identity and the selection-sharing cipher (`presence`). */
import type { PresenceCrypto } from "../../presence";

/**
 * The local user's presence identity and the selection-sharing cipher
 * (consumer session state — never document data). Without `userId` the
 * peer is unaddressable: targeted sharing stands unavailable (the roster
 * still lists the peer by its transport-level `peerId`). Without `crypto`
 * the grant degrades to "off" / "everyone" (a targeted grant is a no-op).
 */
interface PresenceConfig {
  /** The stable user id — the addressable identity on the wire. */
  userId: string;
  /** The roster display label (optional). */
  name?: string;
  /**
   * The selection cipher (the targeted's stand): the local selection is
   * encrypted per target for a targeted grant, and a received ciphertext
   * entry is decrypted with the local user's keys. Opaque strings
   * throughout — the algorithm is the consumer's choice. Without it, only
   * "off" / "everyone" are available.
   */
  crypto?: PresenceCrypto;
}

export type { PresenceConfig };
