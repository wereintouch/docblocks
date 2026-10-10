import * as decoding from "lib0/decoding";
import * as encoding from "lib0/encoding";
import { encodeAwarenessUpdate } from "y-protocols/awareness";
import type { Awareness } from "y-protocols/awareness";
import * as sync from "y-protocols/sync";
import type * as Y from "yjs";

/**
 * Frame helpers for the standard y-websocket wire.
 *
 * A socket message carries one or more concatenated frames, each
 * `[varUint type][payload]`. A sync payload is a y-protocols sync message
 * (own leading varUint: 0 step1, 1 step2, 2 update; step2 and update
 * payloads are the raw CRDT update bytes). An awareness payload is a
 * y-protocols awareness update.
 */

/** Frame types on the standard wire (2 = auth, unused here). */
const MESSAGE_SYNC = 0;
const MESSAGE_AWARENESS = 1;
const MESSAGE_QUERY_AWARENESS = 3;

/** A sync frame carrying our state vector (join handshake). */
function buildSyncStep1Frame(doc: Y.Doc): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MESSAGE_SYNC);
  sync.writeSyncStep1(encoder, doc);
  return encoding.toUint8Array(encoder);
}

/** A sync frame carrying one local CRDT update. */
function buildSyncUpdateFrame(update: Uint8Array): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MESSAGE_SYNC);
  sync.writeUpdate(encoder, update);
  return encoding.toUint8Array(encoder);
}

/** An awareness frame carrying the given clients' states. */
function buildAwarenessFrame(awareness: Awareness, clientIDs: number[]): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MESSAGE_AWARENESS);
  encoding.writeVarUint8Array(encoder, encodeAwarenessUpdate(awareness, clientIDs));
  return encoding.toUint8Array(encoder);
}

/** The outer frame type, or -1 for an empty frame. */
function parseFrameType(frame: Uint8Array): number {
  const decoder = decoding.createDecoder(frame);
  if (!decoding.hasContent(decoder)) return -1;
  return decoding.readVarUint(decoder);
}

/** A decoder positioned right after the outer frame-type varUint; null for an empty frame. */
function decoderAfterFrameType(frame: Uint8Array): decoding.Decoder | null {
  const decoder = decoding.createDecoder(frame);
  if (!decoding.hasContent(decoder)) return null;
  decoding.readVarUint(decoder);
  return decoder;
}

/** The sync message type (0/1/2) of a single sync frame; null for non-sync or malformed frames. */
function parseSyncType(frame: Uint8Array): number | null {
  const decoder = decoding.createDecoder(frame);
  try {
    if (decoding.readVarUint(decoder) !== MESSAGE_SYNC) return null;
    return decoding.readVarUint(decoder);
  } catch {
    return null;
  }
}

/**
 * The raw CRDT update carried by a sync frame of step2/update type,
 * or null for any other frame (step1, non-sync, malformed).
 */
function extractUpdatePayload(frame: Uint8Array): Uint8Array | null {
  const decoder = decoding.createDecoder(frame);
  try {
    if (!decoding.hasContent(decoder)) return null;
    if (decoding.readVarUint(decoder) !== MESSAGE_SYNC) return null;
    const syncType = decoding.readVarUint(decoder);
    if (syncType !== sync.messageYjsSyncStep2 && syncType !== sync.messageYjsUpdate) return null;
    return decoding.readVarUint8Array(decoder);
  } catch {
    return null;
  }
}

/** Concatenate frames into one socket send; null when there is nothing to send. */
function concatFrames(frames: Uint8Array[]): Uint8Array | null {
  if (frames.length === 0) return null;
  const total = frames.reduce((n, f) => n + f.length, 0);
  const out = new Uint8Array(total);
  let pos = 0;
  for (const f of frames) {
    out.set(f, pos);
    pos += f.length;
  }
  return out;
}

export {
  MESSAGE_AWARENESS,
  MESSAGE_QUERY_AWARENESS,
  MESSAGE_SYNC,
  buildAwarenessFrame,
  buildSyncStep1Frame,
  buildSyncUpdateFrame,
  concatFrames,
  decoderAfterFrameType,
  extractUpdatePayload,
  parseFrameType,
  parseSyncType,
};
