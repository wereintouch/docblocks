/**
 * The dev relay's frame plumbing: the y-websocket frame types + the frame
 * builders (the sync step-1 / the sync update / the awareness fan-out),
 * the ws payload's normalization to bytes, the single outgoing-frame site
 * (the room's chaos gate first — drop/delay — then the send), and the
 * sync decode error's swallow (a malformed frame must not tear the relay
 * down).
 */
import * as decoding from "lib0/decoding";
import * as encoding from "lib0/encoding";
import { WebSocket } from "ws";
import type { RawData } from "ws";
import { Awareness, applyAwarenessUpdate, encodeAwarenessUpdate } from "y-protocols/awareness";
import * as sync from "y-protocols/sync";
import * as Y from "yjs";

import { maybeChaosSend } from "./chaos.ts";
import type { Room } from "./relay-rooms.ts";

/** Standard y-websocket frame types. */
const MESSAGE_SYNC = 0;
const MESSAGE_AWARENESS = 1;
const MESSAGE_QUERY_AWARENESS = 3;

/** A sync frame carrying the state vector of `doc` (the join handshake). */
function buildSyncStep1Frame(doc: Y.Doc): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MESSAGE_SYNC);
  sync.writeSyncStep1(encoder, doc);
  return encoding.toUint8Array(encoder);
}

/** A sync frame carrying one CRDT update. */
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

/** Normalize a ws message payload (Buffer, fragment array, ArrayBuffer) to bytes. */
function toFrame(data: RawData): Uint8Array {
  if (Array.isArray(data)) return new Uint8Array(Buffer.concat(data));
  return new Uint8Array(data);
}

/**
 * The single outgoing-frame site for a room: the room's chaos gate
 * (drop/delay) first, then the send to the destination socket. The socket
 * state is re-checked at delivery, so a delayed frame to a closed socket
 * is a no-op there.
 */
function sendFrame(room: Room, socket: WebSocket, frame: Uint8Array): void {
  maybeChaosSend(room.chaos, () => {
    if (socket.readyState === WebSocket.OPEN) socket.send(frame);
  });
}

/** Decode errors inside a sync message must not tear the relay down. */
const swallowDecodeError = (): undefined => undefined;

/** Server-side frame handling for one connection (one message per frame). */
function handleMessage(room: Room, socket: WebSocket, frame: Uint8Array): void {
  const decoder = decoding.createDecoder(frame);
  let type: number;
  try {
    type = decoding.readVarUint(decoder);
  } catch {
    return; // malformed frame: drop
  }
  if (type === MESSAGE_SYNC) {
    const reply = encoding.createEncoder();
    encoding.writeVarUint(reply, MESSAGE_SYNC);
    try {
      sync.readSyncMessage(decoder, reply, room.doc, socket, swallowDecodeError);
    } catch {
      return;
    }
    if (encoding.length(reply) > 1) sendFrame(room, socket, encoding.toUint8Array(reply));
  } else if (type === MESSAGE_AWARENESS) {
    try {
      applyAwarenessUpdate(room.awareness, decoding.readVarUint8Array(decoder), socket);
    } catch {
      // malformed awareness frame: drop
    }
  } else if (type === MESSAGE_QUERY_AWARENESS) {
    sendFrame(room, socket, buildAwarenessFrame(room.awareness, [...room.awareness.getStates().keys()]));
  }
  // unknown frame types are ignored
}

export {
  MESSAGE_AWARENESS,
  MESSAGE_QUERY_AWARENESS,
  MESSAGE_SYNC,
  buildAwarenessFrame,
  buildSyncStep1Frame,
  buildSyncUpdateFrame,
  handleMessage,
  sendFrame,
  swallowDecodeError,
  toFrame,
};
