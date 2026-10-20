import * as decoding from "lib0/decoding";
import * as encoding from "lib0/encoding";
import { Awareness, applyAwarenessUpdate, removeAwarenessStates } from "y-protocols/awareness";
import * as sync from "y-protocols/sync";
import * as Y from "yjs";

import {
  MESSAGE_AWARENESS,
  MESSAGE_SYNC,
  buildAwarenessFrame,
  buildSyncStep1Frame,
  buildSyncUpdateFrame,
  decoderAfterFrameType,
  parseFrameType,
  parseSyncType,
} from "../src/sync/ws-frames";

/**
 * An in-memory standard y-websocket server for tests: rooms keyed by URL
 * path, the standard join flow (step1 on connect, step2 on request),
 * update/awareness fan-out to all room connections, and close cleanup of
 * the connection's awareness states.
 *
 * Delivery is explicit (`deliver`) — no timers, no uncontrolled async — so
 * tests control exactly when and in what order frames land. Chaos hooks
 * (duplicate/shuffle/mute/kill) mutate how deliveries are applied.
 */

/** A fake socket the relay drives; the provider sees the WsLike surface. */
interface FakeSocket {
  url: string;
  closed: boolean;
  opened: boolean;
  send(data: Uint8Array): void;
  close(): void;
  onopen: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: Uint8Array }) => void) | null;
  onclose: ((ev: unknown) => void) | null;
  onerror: ((ev: unknown) => void) | null;
}

interface Room {
  doc: Y.Doc;
  awareness: Awareness;
  /** Client IDs each connection announced through awareness frames. */
  controlled: Map<FakeSocket, number[]>;
}

/** Deterministic PRNG (mulberry32) for reproducible chaos. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffled<T>(items: T[], prng: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(prng() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

class WsRelay {
  #rooms = new Map<string, Room>();
  #sockets = new Map<FakeSocket, string>();
  #allSockets: FakeSocket[] = [];
  #muted = new Set<FakeSocket>();
  #queue: { to: FakeSocket; frame: Uint8Array }[] = [];
  #duplicateAll = false;
  #shuffleAll = false;
  #prng: () => number;
  #step1s = new Map<string, Map<number, number>[]>();

  constructor(seed = 1) {
    this.#prng = mulberry32(seed);
  }

  /** All sockets created so far (in connect order), closed ones included. */
  get sockets(): FakeSocket[] {
    return this.#allSockets;
  }

  /** The room name (URL path after the host) a socket URL addresses. */
  roomOf(url: string): string {
    const path = url.replace(/^wss?:\/\//, "").split("?")[0]!;
    return `/${path.split("/").slice(1).join("/")}`; // drop the host segment
  }

  /** The state vectors seen in step1 frames of a room (join order). */
  step1s(roomName: string): Map<number, number>[] {
    return this.#step1s.get(roomName) ?? [];
  }

  /** Deliver the first `n` frames of the next delivery batch and drop them. */
  dropNext(n: number): void {
    this.#dropCount = n;
  }
  #dropCount = 0;

  /** Deliver every frame twice (persistent until cleared). */
  setDuplicateAll(on: boolean): void {
    this.#duplicateAll = on;
  }

  /** Deliver batches in shuffled order (persistent until cleared, seeded). */
  setShuffleAll(on: boolean): void {
    this.#shuffleAll = on;
  }

  /** Never deliver frames to this socket (network partition). */
  mute(socket: FakeSocket): void {
    this.#muted.add(socket);
  }

  /** Simulate an unexpected server-side close of one connection. */
  killSocket(socket: FakeSocket): void {
    if (socket.closed) return;
    socket.closed = true;
    const roomName = this.#sockets.get(socket);
    if (roomName !== undefined) this.#onSocketClosed(this.#rooms.get(roomName)!, socket);
    socket.onclose?.(undefined);
  }

  /** Inject a query-awareness frame (the server asks the client for its state). */
  queryAwareness(socket: FakeSocket): void {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, 3);
    this.#queue.push({ to: socket, frame: encoding.toUint8Array(encoder) });
  }

  /** Queue an arbitrary raw frame to one socket (fault injection). */
  rawFrame(socket: FakeSocket, frame: Uint8Array): void {
    this.#queue.push({ to: socket, frame });
  }

  /** Connect a fake socket to the room implied by the URL. */
  connect(url: string): FakeSocket {
    const roomName = this.roomOf(url);
    const room = this.#roomOf(roomName);
    const socket: FakeSocket = {
      url,
      closed: false,
      opened: false,
      onopen: null,
      onmessage: null,
      onclose: null,
      onerror: null,
      send: (data: Uint8Array) => {
        // The browser's WebSocket rejects a pre-open send; the fake stands
        // the same rejection (the provider must buffer until open).
        if (!socket.opened) {
          throw new Error("WebSocket is not open: ready state CONNECTING");
        }
        if (!socket.closed) this.#handleMessage(room, socket, data);
      },
      close: () => {
        if (socket.closed) return;
        socket.closed = true;
        this.#onSocketClosed(room, socket);
        socket.onclose?.(undefined);
      },
    };
    this.#sockets.set(socket, roomName);
    this.#allSockets.push(socket);
    room.controlled.set(socket, []);
    // The open event is deferred so the provider installs its handlers first.
    queueMicrotask(() => {
      if (socket.closed) return;
      socket.opened = true;
      socket.onopen?.(undefined);
    });
    // Standard server: on join push our state vector and the current awareness states.
    this.#queue.push({ to: socket, frame: buildSyncStep1Frame(room.doc) });
    if (room.awareness.getStates().size > 0) {
      this.#queue.push({
        to: socket,
        frame: buildAwarenessFrame(room.awareness, [...room.awareness.getStates().keys()]),
      });
    }
    return socket;
  }

  /**
   * Deliver queued frames (and everything they trigger) until quiescent.
   * Chaos flags apply to every batch of the call.
   */
  async deliver(): Promise<void> {
    await Promise.resolve(); // let deferred open microtasks run first
    let guard = 0;
    while (this.#queue.length > 0 && guard++ < 10000) {
      let batch = this.#queue.splice(0);
      if (this.#shuffleAll) batch = shuffled(batch, this.#prng);
      if (this.#dropCount > 0) batch = batch.slice(this.#dropCount);
      if (this.#dropCount > 0) this.#dropCount = 0;
      if (this.#duplicateAll) batch = [...batch, ...batch];
      for (const m of batch) {
        if (m.to.closed || this.#muted.has(m.to)) continue;
        m.to.onmessage?.({ data: m.frame });
      }
      await Promise.resolve();
    }
  }

  #roomOf(name: string): Room {
    let room = this.#rooms.get(name);
    if (room !== undefined) return room;
    const doc = new Y.Doc();
    const awareness = new Awareness(doc);
    awareness.setLocalState(null); // the server itself has no local state
    room = { doc, awareness, controlled: new Map() };
    const roomName = name;
    doc.on("update", (update: Uint8Array) => {
      // Fan out to every room connection, origin included (idempotent re-apply).
      for (const [s, n] of this.#sockets) {
        if (n === roomName && !s.closed) this.#queue.push({ to: s, frame: buildSyncUpdateFrame(update) });
      }
    });
    awareness.on("update", (changes: { added: number[]; updated: number[]; removed: number[] }, origin: unknown) => {
      const originSocket = this.#socketOf(origin);
      const controlled = originSocket !== undefined ? room!.controlled.get(originSocket) : undefined;
      if (controlled !== undefined) {
        for (const id of changes.added) if (!controlled.includes(id)) controlled.push(id);
        for (const id of changes.removed) {
          const i = controlled.indexOf(id);
          if (i >= 0) controlled.splice(i, 1);
        }
      }
      const changed = [...changes.added, ...changes.updated, ...changes.removed];
      if (changed.length === 0) return;
      const frame = buildAwarenessFrame(awareness, changed);
      for (const [s, n] of this.#sockets) {
        if (n === roomName && !s.closed) this.#queue.push({ to: s, frame });
      }
    });
    this.#rooms.set(name, room);
    return room;
  }

  /** Server-side frame handling: one message per frame (the provider's shape). */
  #handleMessage(room: Room, from: FakeSocket, frame: Uint8Array): void {
    const type = parseFrameType(frame);
    if (type !== MESSAGE_SYNC && type !== MESSAGE_AWARENESS) return;
    const after = decoderAfterFrameType(frame);
    if (after === null) return;
    if (type === MESSAGE_SYNC) {
      if (parseSyncType(frame) === 0) this.#recordStep1(room, frame);
      const reply = encoding.createEncoder();
      encoding.writeVarUint(reply, MESSAGE_SYNC);
      try {
        sync.readSyncMessage(after, reply, room.doc, from, swallowDecodeError);
      } catch {
        return;
      }
      if (encoding.length(reply) > 1) this.#queue.push({ to: from, frame: encoding.toUint8Array(reply) });
    } else {
      try {
        applyAwarenessUpdate(room.awareness, decoding.readVarUint8Array(after), from);
      } catch {
        // malformed awareness frame: drop
      }
    }
  }

  #recordStep1(room: Room, frame: Uint8Array): void {
    const after = decoderAfterFrameType(frame);
    if (after === null) return;
    try {
      decoding.readVarUint(after); // sync message type (0)
      const sv = Y.decodeStateVector(decoding.readVarUint8Array(after));
      const name = this.#roomNameOf(room);
      const list = this.#step1s.get(name) ?? [];
      list.push(sv);
      this.#step1s.set(name, list);
    } catch {
      // malformed step1: nothing to record
    }
  }

  #roomNameOf(room: Room): string {
    for (const [name, r] of this.#rooms) if (r === room) return name;
    return "";
  }

  /** The live socket a relay origin refers to, if any. */
  #socketOf(v: unknown): FakeSocket | undefined {
    return v !== null && typeof v === "object" && this.#sockets.has(v as FakeSocket) ? (v as FakeSocket) : undefined;
  }

  #onSocketClosed(room: Room, socket: FakeSocket): void {
    const controlled = room.controlled.get(socket) ?? [];
    room.controlled.delete(socket);
    this.#sockets.delete(socket);
    if (controlled.length > 0) removeAwarenessStates(room.awareness, controlled, null);
  }
}

/** Decode errors inside a sync message do not tear the relay down. */
const swallowDecodeError = (): undefined => undefined;

export { WsRelay, mulberry32 };
export type { FakeSocket };
