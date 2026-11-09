// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { act } from "react";

import { createDoc } from "docblocks-core";
import type { PresenceSelection, PresenceState, SyncProvider } from "docblocks-core";

import { Editor } from "../src/Editor";
import { EditorProvider } from "../src/editor-provider";
import { usePresenceSharing } from "../src/hooks";
import { buildPresencePayload, resolvePeerSelection } from "../src/presence";
import type { PresenceCrypto, PresenceSharingMode } from "../src/presence";

const CREATED_AT = "2026-11-09T00:00:00.000Z";

/** A fake transport capturing every setAwareness payload (plus the awareness channel). */
function makePublishingProvider() {
  const published: Record<string, unknown>[] = [];
  let awarenessCb: ((peers: PresenceState[]) => void) | null = null;
  const provider: SyncProvider = {
    connect: async () => {},
    disconnect: () => {},
    sendUpdate: () => {},
    onUpdate: () => () => {},
    getLocalStateVector: () => new Uint8Array(),
    setAwareness: (state) => {
      published.push(state);
    },
    onAwareness: (cb) => {
      awarenessCb = cb;
      return () => {
        awarenessCb = null;
      };
    },
  };
  return { provider, published, emit: (peers: PresenceState[]) => awarenessCb?.(peers) };
}

/** The stub cipher: an entry is addressed to exactly one user (`enc:<target>:<sender>:<json>`); the recipient's decrypt opens it only when the entry is addressed to them. */
const stubCrypto = (myUserId: string): PresenceCrypto => {
  return {
    encrypt: async (selection, grant) =>
      grant.map((target) => `enc:${target}:${myUserId}:${JSON.stringify(selection)}`),
    decrypt: async (entry) => {
      const match = /^enc:([^:]*):([^:]*):([\s\S]*)$/.exec(entry);
      if (match === null || match[1] !== myUserId || match[3] === undefined) return null;
      return JSON.parse(match[3]) as PresenceSelection;
    },
  };
};

const caret = (blockId: string, offset: number): PresenceSelection => ({ blockId, offset });

afterEach(cleanup);

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

describe("the sharing session (EditorProvider wiring)", () => {
  it("defaults to off, flips through the hook, and re-publishes over the new grant", async () => {
    const doc = createDoc({ id: "doc-1", createdAt: CREATED_AT });
    const p = doc.insertBlock("paragraph");
    doc.insertText(p, 0, "hello");
    const { provider, published } = makePublishingProvider();

    const probe: { sharing: PresenceSharingMode; setSharing: (m: PresenceSharingMode) => void } = {
      sharing: "off",
      setSharing: () => {},
    };
    function Probe() {
      const state = usePresenceSharing();
      probe.sharing = state.sharing;
      probe.setSharing = state.setSharing;
      return null;
    }

    render(
      <EditorProvider doc={doc} provider={provider} presence={{ userId: "u1", crypto: stubCrypto("u1") }}>
        <Editor />
        <Probe />
      </EditorProvider>
    );

    expect(probe.sharing).toBe("off");
    expect(published).toHaveLength(0);

    await act(async () => {
      probe.setSharing("everyone");
    });
    // the grant flip publishes immediately (no debounce): the identity frame,
    // no selection yet (the doc's selection stands none over the fresh render)
    expect(published).toHaveLength(1);
    expect(published[0]!.selection).toBeNull();

    await act(async () => {
      probe.setSharing(["u2"]);
    });
    expect(published).toHaveLength(2);
    expect(published[1]!.selection).toBeNull();
    expect("selections" in published[1]!).toBe(false); // no selection to encrypt

    // A caret now: the targeted grant encrypts (one entry for the target).
    const inner = document.querySelector<HTMLElement>(`[data-block-id="${p}"] [data-slot="docblocks/block-content"]`)!;
    const range = document.createRange();
    range.setStart(inner.firstChild!, 1);
    range.collapse(true);
    window.getSelection()!.removeAllRanges();
    window.getSelection()!.addRange(range);
    act(() => {
      document.dispatchEvent(new Event("selectionchange"));
    });
    await vi.waitFor(() => {
      expect(published).toHaveLength(3);
    });
    const last = published[published.length - 1]!;
    expect(last.selection).toBeNull();
    expect(last.selections).toEqual(['enc:u2:u1:{"blockId":"' + p + '","offset":1}']);
  });

  it("the roster: a targeted frame is visible to the recipient only (the seq race drops the older frame)", async () => {
    const doc = createDoc({ id: "doc-1", createdAt: CREATED_AT });
    const p = doc.insertBlock("paragraph");
    doc.insertText(p, 0, "hello");
    const { provider, emit } = makePublishingProvider();

    const probe: { peers: { peerId: string; userId?: string; selectionVisible: boolean }[] } = { peers: [] };
    function Probe() {
      probe.peers = usePresenceSharing().peers;
      return null;
    }

    render(
      <EditorProvider doc={doc} provider={provider} presence={{ userId: "u1", crypto: stubCrypto("u1") }}>
        <Editor />
        <Probe />
      </EditorProvider>
    );

    // The roster frame: identity only (sharing off over the peer) + a
    // targeted frame addressed to u1.
    const rosterFrame: PresenceState = {
      peerId: "41",
      updatedAt: 10,
      selection: null,
      userId: "u2",
      name: "Bob",
      seq: 1,
    };
    const targetedFrame: PresenceState = {
      peerId: "41",
      updatedAt: 20,
      selection: null,
      selections: ['enc:u1:u2:{"blockId":"' + p + '","offset":3}'],
      userId: "u2",
      name: "Bob",
      seq: 2,
    };
    act(() => {
      emit([rosterFrame]);
    });
    await vi.waitFor(() => expect(probe.peers).toHaveLength(1));
    expect(probe.peers[0]).toMatchObject({ peerId: "41", userId: "u2", selectionVisible: false });

    act(() => {
      emit([targetedFrame]);
    });
    await vi.waitFor(() => expect(probe.peers[0]!.selectionVisible).toBe(true));
    expect(probe.peers[0]!.selectionVisible).toBe(true);

    // The seq race: the older frame (seq 1) emitted after the newer one
    // (seq 2) must not re-land (the peer's selection stands visible — the
    // newer frame's stand), and the roster keeps the peer.
    act(() => {
      emit([rosterFrame, targetedFrame]);
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(probe.peers).toHaveLength(1);
    expect(probe.peers[0]!.selectionVisible).toBe(true);
  });

  it("a legacy frame (selection + updatedAt only) stands visible (the pre-sharing stand)", async () => {
    const doc = createDoc({ id: "doc-1", createdAt: CREATED_AT });
    const p = doc.insertBlock("paragraph");
    doc.insertText(p, 0, "hello");
    const { provider, emit } = makePublishingProvider();

    const probe: { peers: { peerId: string; selectionVisible: boolean }[] } = { peers: [] };
    function Probe() {
      probe.peers = usePresenceSharing().peers;
      return null;
    }

    render(
      <EditorProvider doc={doc} provider={provider}>
        <Editor />
        <Probe />
      </EditorProvider>
    );

    const legacy: PresenceState = { peerId: "77", updatedAt: 1, selection: caret(p, 2) };
    act(() => {
      emit([legacy]);
    });
    await vi.waitFor(() => expect(probe.peers).toHaveLength(1));
    expect(probe.peers[0]).toMatchObject({ selectionVisible: true });
    expect(probe.peers[0]!.peerId).toBe("77");
  });

  it("the read-only stand: the grant setter stands a no-op (the state keeps its stand)", () => {
    const doc = createDoc({ id: "doc-1", createdAt: CREATED_AT });
    doc.insertBlock("paragraph");
    const { provider, published } = makePublishingProvider();

    const probe: { sharing: PresenceSharingMode; setSharing: (m: PresenceSharingMode) => void } = {
      sharing: "off",
      setSharing: () => {},
    };
    function Probe() {
      const state = usePresenceSharing();
      probe.sharing = state.sharing;
      probe.setSharing = state.setSharing;
      return null;
    }

    render(
      <EditorProvider doc={doc} provider={provider} mode="view" presence={{ userId: "u1", crypto: stubCrypto("u1") }}>
        <Editor />
        <Probe />
      </EditorProvider>
    );

    act(() => {
      probe.setSharing("everyone");
    });
    expect(probe.sharing).toBe("off");
    expect(published).toHaveLength(0); // the read-only stand publishes no selection frame
  });

  it("the degraded stand: a targeted grant over no cipher stands a no-op (the warn, the grant keeps its stand)", () => {
    const doc = createDoc({ id: "doc-1", createdAt: CREATED_AT });
    doc.insertBlock("paragraph");
    const { provider } = makePublishingProvider();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const probe: { sharing: PresenceSharingMode; setSharing: (m: PresenceSharingMode) => void } = {
      sharing: "off",
      setSharing: () => {},
    };
    function Probe() {
      const state = usePresenceSharing();
      probe.sharing = state.sharing;
      probe.setSharing = state.setSharing;
      return null;
    }

    render(
      <EditorProvider doc={doc} provider={provider} presence={{ userId: "u1" }}>
        <Editor />
        <Probe />
      </EditorProvider>
    );

    act(() => {
      probe.setSharing(["u2"]);
    });
    expect(probe.sharing).toBe("off");
    expect(warn).toHaveBeenCalled();

    // The non-targeted grants stand over the degraded stand (the cipher is irrelevant).
    act(() => {
      probe.setSharing("everyone");
    });
    expect(probe.sharing).toBe("everyone");
    warn.mockRestore();
  });
});
