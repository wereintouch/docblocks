// @vitest-environment jsdom
import { act, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { createDoc } from "docblocks-core";
import type { PresenceState } from "docblocks-core";

import { Editor } from "../src/Editor";
import { EditorProvider } from "../src/editor-provider";
import { usePresenceSharing } from "../src/hooks";
import type { PresenceSharingMode } from "../src/presence";
import { CREATED_AT, caret, makePublishingProvider, stubCrypto } from "./presence-sharing.helpers";

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
