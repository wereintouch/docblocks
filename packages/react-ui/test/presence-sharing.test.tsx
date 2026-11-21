// @vitest-environment jsdom
import { describe, expect, it } from "vitest";

import type { PresenceState } from "docblocks-core";

import { buildPresencePayload, resolvePeerSelection } from "../src/presence";
import { caret, stubCrypto } from "./presence-sharing.helpers";

describe("buildPresencePayload (the local publish's stand)", () => {
  const base = {
    selection: caret("b1", 2),
    identity: { userId: "u1", name: "Alice" },
    seq: 7,
    updatedAt: 1234,
  };

  it("off: the identity frame only (no selection, no ciphertext)", async () => {
    const payload = await buildPresencePayload({ ...base, sharing: "off", viewMode: false, crypto: stubCrypto("u1") });
    expect(payload).toEqual({ selection: null, userId: "u1", name: "Alice", seq: 7, updatedAt: 1234 });
    expect(payload).not.toHaveProperty("selections");
  });

  it("everyone: the plaintext selection (the legacy stand), no ciphertext", async () => {
    const payload = await buildPresencePayload({
      ...base,
      sharing: "everyone",
      viewMode: false,
      crypto: stubCrypto("u1"),
    });
    expect(payload).toEqual({ selection: caret("b1", 2), userId: "u1", name: "Alice", seq: 7, updatedAt: 1234 });
    expect(payload).not.toHaveProperty("selections");
  });

  it("targeted: the selection encrypts per target (one entry per grant member), plaintext stands null", async () => {
    const crypto = stubCrypto("u1");
    const payload = await buildPresencePayload({
      ...base,
      sharing: ["u2", "u3"],
      viewMode: false,
      crypto,
    });
    expect(payload).not.toBeNull();
    expect(payload!.selection).toBeNull();
    expect(payload!.selections).toEqual([
      'enc:u2:u1:{"blockId":"b1","offset":2}',
      'enc:u3:u1:{"blockId":"b1","offset":2}',
    ]);
    expect(payload!.userId).toBe("u1");
  });

  it("targeted over no cipher: the publish stands dropped (null), no partial state", async () => {
    const payload = await buildPresencePayload({ ...base, sharing: ["u2"], viewMode: false, crypto: null });
    expect(payload).toBeNull();
  });

  it("the read-only stand: the identity frame only, even over an active grant", async () => {
    const payload = await buildPresencePayload({
      ...base,
      sharing: "everyone",
      viewMode: true,
      crypto: stubCrypto("u1"),
    });
    expect(payload).toEqual({ selection: null, userId: "u1", name: "Alice", seq: 7, updatedAt: 1234 });
  });

  it("an empty local selection: the identity frame only (the grant is irrelevant)", async () => {
    const payload = await buildPresencePayload({
      ...base,
      selection: null,
      sharing: "everyone",
      viewMode: false,
      crypto: stubCrypto("u1"),
    });
    expect(payload).toEqual({ selection: null, userId: "u1", name: "Alice", seq: 7, updatedAt: 1234 });
  });

  it("no identity supplied: the legacy stand (the anonymous plaintext selection over the default grant — the 0.2.0's stand)", async () => {
    const payload = await buildPresencePayload({
      selection: caret("b1", 1),
      sharing: "off",
      viewMode: false,
      identity: {},
      crypto: null,
      seq: 1,
      updatedAt: 5,
    });
    expect(payload).toEqual({ selection: caret("b1", 1), seq: 1, updatedAt: 5 });
  });

  it("no identity supplied: the everyone grant stands the same plaintext (the parity)", async () => {
    const payload = await buildPresencePayload({
      selection: caret("b1", 1),
      sharing: "everyone",
      viewMode: false,
      identity: {},
      crypto: null,
      seq: 1,
      updatedAt: 5,
    });
    expect(payload).toEqual({ selection: caret("b1", 1), seq: 1, updatedAt: 5 });
  });
});

describe("resolvePeerSelection (the received peer's stand)", () => {
  it("a plaintext frame (everyone / legacy) stands as is", async () => {
    const peer: PresenceState = { peerId: "9", updatedAt: 1, selection: caret("b1", 3) };
    await expect(resolvePeerSelection({ peer, crypto: stubCrypto("u1") })).resolves.toEqual(peer);
  });

  it("a targeted frame opens for its own user (the first entry that decrypts)", async () => {
    const peer: PresenceState = {
      peerId: "9",
      updatedAt: 1,
      selection: null,
      selections: ["enc:uX:u1:{}", 'enc:u1:u1:{"blockId":"b1","offset":4}'],
    };
    const resolved = await resolvePeerSelection({ peer, crypto: stubCrypto("u1") });
    expect(resolved.selection).toEqual(caret("b1", 4));
    // the roster fields stand intact
    expect(resolved.selections).toEqual(peer.selections);
  });

  it("a targeted frame stands invisible to a non-recipient (the identity frame still lists the peer)", async () => {
    const peer: PresenceState = {
      peerId: "9",
      updatedAt: 1,
      selection: null,
      selections: ['enc:u1:u2:{"blockId":"b1","offset":4}'],
      userId: "u2",
      name: "Bob",
    };
    // u3's cipher: the entry is addressed to u1 — u3's decrypt refuses it.
    const resolved = await resolvePeerSelection({ peer, crypto: stubCrypto("u3") });
    expect(resolved.selection).toBeNull();
    expect(resolved.userId).toBe("u2");
  });

  it("a targeted frame over no cipher never opens (the roster stands)", async () => {
    const peer: PresenceState = {
      peerId: "9",
      updatedAt: 1,
      selection: null,
      selections: ['enc:u1:u1:{"blockId":"b1","offset":4}'],
    };
    const resolved = await resolvePeerSelection({ peer, crypto: null });
    expect(resolved.selection).toBeNull();
  });
});
