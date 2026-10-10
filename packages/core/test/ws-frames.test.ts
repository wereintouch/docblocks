import * as decoding from "lib0/decoding";
import * as encoding from "lib0/encoding";
import { describe, expect, it } from "vitest";
import { Awareness, applyAwarenessUpdate } from "y-protocols/awareness";
import * as sync from "y-protocols/sync";
import * as Y from "yjs";

import {
  MESSAGE_AWARENESS,
  MESSAGE_SYNC,
  buildAwarenessFrame,
  buildSyncStep1Frame,
  buildSyncUpdateFrame,
  decoderAfterFrameType,
  extractUpdatePayload,
  parseFrameType,
  parseSyncType,
} from "../src/sync/ws-frames";

/**
 * ws-frames: frame codec round-trips on the standard y-websocket wire.
 * Pure unit tests — no sockets, no relay.
 */

describe("sync frames", () => {
  it("a step1 frame carries the doc state vector and yields the full state as a step2 reply", () => {
    const a = new Y.Doc();
    a.getText("t").insert(0, "hello");
    const b = new Y.Doc(); // a fresh doc joining the session

    // The step1 carries the sender's state vector (empty for a fresh doc).
    const frame = buildSyncStep1Frame(b);

    expect(parseFrameType(frame)).toBe(MESSAGE_SYNC);
    expect(parseSyncType(frame)).toBe(0);
    const after = decoderAfterFrameType(frame)!;
    decoding.readVarUint(after); // sync message type (0)
    expect(Array.from(decoding.readVarUint8Array(after))).toEqual(Array.from(Y.encodeStateVector(b)));

    // The reply to that step1 is written by the doc holding the state:
    // a step2 with everything the requester is missing.
    const replyAfter = decoderAfterFrameType(frame)!;
    decoding.readVarUint(replyAfter); // sync message type (0)
    const reply = encoding.createEncoder();
    sync.readSyncStep1(replyAfter, reply, a);
    const sub = decoding.createDecoder(encoding.toUint8Array(reply));
    expect(decoding.readVarUint(sub)).toBe(sync.messageYjsSyncStep2);
    Y.applyUpdate(b, decoding.readVarUint8Array(sub));
    expect(b.getText("t").toString()).toBe("hello");
  });

  it("an update frame round-trips the raw update bytes", () => {
    const a = new Y.Doc();
    a.getText("t").insert(0, "hello");
    const update = Y.encodeStateAsUpdate(a);
    const frame = buildSyncUpdateFrame(update);

    expect(parseFrameType(frame)).toBe(MESSAGE_SYNC);
    expect(parseSyncType(frame)).toBe(2);

    const payload = extractUpdatePayload(frame);
    expect(payload).not.toBeNull();
    const b = new Y.Doc();
    Y.applyUpdate(b, payload!);
    expect(b.getText("t").toString()).toBe("hello");
  });
});

describe("awareness frames", () => {
  it("an awareness frame round-trips peer state between two awareness instances", () => {
    const a = new Awareness(new Y.Doc());
    const b = new Awareness(new Y.Doc());
    a.setLocalState({ selection: { blockId: "b1", offset: 2 }, updatedAt: 1000 });
    const frame = buildAwarenessFrame(a, [a.clientID]);

    expect(parseFrameType(frame)).toBe(MESSAGE_AWARENESS);
    applyAwarenessUpdate(b, decoding.readVarUint8Array(decoderAfterFrameType(frame)!), null);
    expect(b.states.get(a.clientID)).toEqual({ selection: { blockId: "b1", offset: 2 }, updatedAt: 1000 });
  });
});

describe("frame classification", () => {
  it("parseFrameType reports the outer type and -1 for empty frames", () => {
    expect(parseFrameType(new Uint8Array(0))).toBe(-1);
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, 99);
    expect(parseFrameType(encoding.toUint8Array(encoder))).toBe(99);
  });

  it("extractUpdatePayload returns the update only for step2/update frames", () => {
    const a = new Y.Doc();
    a.getText("t").insert(0, "x");

    expect(extractUpdatePayload(buildSyncStep1Frame(a))).toBeNull();
    const awareness = new Awareness(new Y.Doc());
    expect(extractUpdatePayload(buildAwarenessFrame(awareness, [awareness.clientID]))).toBeNull();

    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, 3); // query-awareness
    expect(extractUpdatePayload(encoding.toUint8Array(encoder))).toBeNull();

    // A truncated sync frame is malformed, not a crash.
    expect(extractUpdatePayload(new Uint8Array([0, 2]))).toBeNull();
  });
});
