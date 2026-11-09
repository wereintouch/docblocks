/** The presence sharing pipeline: the local awareness payload's build and
 *  the received peer's selection resolution (plaintext / the cipher's
 *  decrypt / the seq guard). Pure functions — the EditorProvider's effects
 *  own the state and the transport, these own the contract. */
import type { PresenceSelection, PresenceState } from "docblocks-core";

import type { PresenceCrypto, PresenceIdentity, PresenceSharingMode } from "./models";

/** One local publish's parameters (the caller snapshots the values). */
interface PublishParams {
  /** The wire selection; null when the local selection is empty. */
  selection: PresenceSelection | null;
  /** The local grant (the session state at publish time). */
  sharing: PresenceSharingMode;
  /** The read-only stand: the selection never publishes (the identity does). */
  viewMode: boolean;
  /** The consumer's local identity (absent when the provider has no presence prop). */
  identity: PresenceIdentity;
  /** The local cipher; null degrades a targeted grant (the publish stands dropped). */
  crypto: PresenceCrypto | null;
  /** The monotonic publication counter (every publish increments it). */
  seq: number;
  updatedAt: number;
}

/**
 * Build the awareness payload of one publish. Returns null when the grant
 * is targeted over no cipher (the caller keeps the previous payload — the
 * degradation stands, no crash, no partial publish).
 */
async function buildPresencePayload(params: PublishParams): Promise<Record<string, unknown> | null> {
  const { selection, sharing, viewMode, identity, crypto, seq, updatedAt } = params;
  const payload: Record<string, unknown> = { updatedAt, seq };
  if (identity.userId !== undefined) payload.userId = identity.userId;
  if (identity.name !== undefined) payload.name = identity.name;

  if (viewMode || selection === null) {
    payload.selection = null;
    return payload;
  }
  if (sharing === "off") {
    // The legacy stand: a provider without the consumer's identity keeps
    // the 0.2.0's stand (the anonymous plaintext selection — the sharing's
    // feature stands absent without the presence prop).
    payload.selection = identity.userId === undefined ? selection : null;
    return payload;
  }
  if (sharing === "everyone") {
    payload.selection = selection;
    return payload;
  }
  if (crypto === null) return null;
  payload.selection = null;
  payload.selections = await crypto.encrypt(selection, sharing);
  return payload;
}

/**
 * Resolve one received peer's selection: the plaintext one (the everyone /
 * legacy stand) stands as is; a targeted stand resolves to the first entry
 * the local cipher opens (the entries carry no target id, so every entry
 * is tried); without a cipher a targeted selection never stands (the
 * peer's identity frame still lists it in the roster).
 */
async function resolvePeerSelection(params: {
  peer: PresenceState;
  crypto: PresenceCrypto | null;
}): Promise<PresenceState> {
  const { peer, crypto } = params;
  if (peer.selection !== null) return peer;
  if (peer.selections !== undefined && crypto !== null && peer.selections.length > 0) {
    const decrypted = await Promise.all(peer.selections.map((entry) => crypto.decrypt(entry)));
    const selection = decrypted.find((value) => value !== null) ?? null;
    return { ...peer, selection };
  }
  return peer;
}

export { buildPresencePayload, resolvePeerSelection };
export type { PublishParams };
