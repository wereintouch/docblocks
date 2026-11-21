/** The provider's incoming socket message handling: the wire frame's parse
 *  (the replies + the updates) and the updates' delivery (the listeners
 *  first, then the internal doc). */
import * as decoding from "lib0/decoding";
import * as encoding from "lib0/encoding";
import { applyAwarenessUpdate } from "y-protocols/awareness";
import type { Awareness } from "y-protocols/awareness";
import * as sync from "y-protocols/sync";
import * as Y from "yjs";

import {
  MESSAGE_AWARENESS,
  MESSAGE_QUERY_AWARENESS,
  MESSAGE_SYNC,
  buildAwarenessFrame,
  concatFrames,
} from "../ws-frames";
import type { WsLike } from "./models";
import { swallowDecodeError } from "./parse";

/**
 * One socket message's parse (null = a malformed frame, dropped whole). The
 * sync step2/update bytes are collected, not applied: the apply stands the
 * delivery (see handleIncomingMessage). The step1 (state vector query) is
 * fully handled here — it carries no update bytes, and its reply diff is
 * computed over the internal doc's state vector. `markSyncReceived` stands
 * called on the first received document state (a step2 or an update) — even
 * when a later frame is malformed and the batch is dropped.
 */
function parseFrame(
  frame: Uint8Array,
  doc: Y.Doc,
  awareness: Awareness,
  markSyncReceived: () => void
): { replies: Uint8Array[]; updates: Uint8Array[] } | null {
  const decoder = decoding.createDecoder(frame);
  const replies: Uint8Array[] = [];
  const updates: Uint8Array[] = [];
  try {
    // A socket message may carry several concatenated frames.
    while (decoding.hasContent(decoder)) {
      const type = decoding.readVarUint(decoder);
      if (type === MESSAGE_SYNC) {
        const syncMsgPos = decoder.pos; // right after the frame type
        const syncType = decoding.readVarUint(decoder);
        if (syncType === sync.messageYjsSyncStep2 || syncType === sync.messageYjsUpdate) {
          // The provider holds wire state now: the late attach's
          // accumulated-state delivery stands (the onUpdate contract).
          markSyncReceived();
          // The app applies the same raw update bytes attach receives;
          // the internal doc mirrors them after the delivery (above).
          updates.push(decoding.readVarUint8Array(decoder));
        } else if (syncType === sync.messageYjsSyncStep1) {
          const reply = encoding.createEncoder();
          encoding.writeVarUint(reply, MESSAGE_SYNC);
          // readSyncMessage reads the sync type itself: the sub-decoder
          // stands right after the frame type (the shared decoder already
          // consumed it).
          const sub = decoding.createDecoder(frame);
          sub.pos = syncMsgPos;
          sync.readSyncMessage(sub, reply, doc, doc, swallowDecodeError);
          if (encoding.length(reply) > 1) replies.push(encoding.toUint8Array(reply));
        } else {
          // Unknown sync types stand malformed (the standard reader
          // throws; the batch is dropped, the connection stands).
          throw new Error(`unknown sync message type ${syncType}`);
        }
      } else if (type === MESSAGE_AWARENESS) {
        applyAwarenessUpdate(awareness, decoding.readVarUint8Array(decoder), null);
      } else if (type === MESSAGE_QUERY_AWARENESS) {
        replies.push(buildAwarenessFrame(awareness, [awareness.clientID]));
      }
      // auth and unknown types are ignored (forward compatibility)
    }
  } catch {
    return null; // malformed frame: drop the rest of the batch, keep the connection
  }
  return { replies, updates };
}

/**
 * One incoming socket message's handling. The client-side frame budget: an
 * oversized message is dropped whole (not decoded or applied) — bounds the
 * per-message decode/apply work. The replies stand sent as one message; the
 * updates stand the app FIRST (the listeners), and the internal doc follows
 * only if the app accepted them. A listener exception is the app's own
 * failure — it stands visible (not swallowed as a malformed frame), and the
 * internal state vector stays behind, so the next state vector exchange
 * re-sends the missed bytes (the recovery — the internal doc must never
 * claim state the app's doc does not hold, or the divergence is
 * unrecoverable for the connection's life).
 */
function handleIncomingMessage(
  frame: Uint8Array,
  socket: WsLike | null,
  maxFrameBytes: number,
  doc: Y.Doc,
  awareness: Awareness,
  updateListeners: Set<(bytes: Uint8Array) => void>,
  markSyncReceived: () => void
): void {
  if (socket === null) return;
  // The client-side frame budget: an oversized message is dropped whole
  // (not decoded or applied) — bounds the per-message decode/apply work.
  if (frame.byteLength > maxFrameBytes) return;
  const parsed = parseFrame(frame, doc, awareness, markSyncReceived);
  if (parsed === null) return; // malformed frame: drop the batch, keep the connection
  const out = concatFrames(parsed.replies);
  if (out !== null) socket.send(out);
  for (const bytes of parsed.updates) {
    emitUpdate(updateListeners, bytes);
    Y.applyUpdate(doc, bytes);
  }
}

/** The update listeners' emit (the snapshot: a listener may unsubscribe mid-emit). */
function emitUpdate(listeners: Set<(bytes: Uint8Array) => void>, bytes: Uint8Array): void {
  for (const cb of [...listeners]) cb(bytes);
}

export { handleIncomingMessage };
