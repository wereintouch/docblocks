// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { act } from "react";

import { createDoc } from "docblocks-core";
import type { PresenceState, SyncProvider } from "docblocks-core";

import { Editor } from "../src/Editor";
import { EditorProvider } from "../src/editor-provider";
import { usePresence } from "../src/hooks";

const CREATED_AT = "2026-10-10T00:00:00.000Z";

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

afterEach(cleanup);

describe("structural data-slot attributes", () => {
  it("renders the slot on the editor root, blocks, list wrappers, list items, and placeholders", () => {
    const doc = createDoc({ id: "doc-1", createdAt: CREATED_AT });
    const p = doc.insertBlock("paragraph");
    doc.insertText(p, 0, "text");
    doc.insertBlock("heading", { level: 2 });
    doc.insertBlock("list-item", { list: "bullet" });
    doc.insertBlock("list-item", { list: "number" });
    doc.insertBlock("divider");

    render(
      <EditorProvider doc={doc}>
        <Editor />
      </EditorProvider>
    );

    expect(document.querySelector('[data-slot="docblocks/editor"]')).not.toBeNull();
    expect(document.querySelector(`[data-block-id="${p}"]`)?.getAttribute("data-slot")).toBe("docblocks/block");
    expect(document.querySelector('[data-slot="docblocks/block"][data-block-type="heading"]')).not.toBeNull();
    expect(document.querySelectorAll('[data-slot="docblocks/list-item"]').length).toBe(2);
    expect(document.querySelector('[data-slot="docblocks/list"][data-list="bullet"]')).not.toBeNull();
    expect(document.querySelector('[data-slot="docblocks/list"][data-list="number"]')).not.toBeNull();
    expect(document.querySelector('[data-slot="docblocks/divider"][data-block-type="divider"]')).not.toBeNull();
  });
});

describe("awareness publishing (EditorProvider)", () => {
  it("publishes the live selection debounced, null on unfocus and on window blur", () => {
    vi.useFakeTimers();
    try {
      const doc = createDoc({ id: "doc-1", createdAt: CREATED_AT });
      const p = doc.insertBlock("paragraph");
      doc.insertText(p, 0, "hello");
      const { provider, published } = makePublishingProvider();

      const { unmount } = render(
        <EditorProvider doc={doc} provider={provider}>
          <Editor />
        </EditorProvider>
      );
      expect(published).toHaveLength(0);

      // A caret inside the block (the inner editable holds the text).
      const el = document.querySelector<HTMLElement>(`[data-block-id="${p}"]`);
      expect(el).not.toBeNull();
      const inner = el!.querySelector<HTMLElement>('[data-slot="docblocks/block-content"]');
      expect(inner).not.toBeNull();
      const textNode = inner!.firstChild;
      expect(textNode?.nodeType).toBe(Node.TEXT_NODE);
      const range = document.createRange();
      range.setStart(textNode!, 2);
      range.collapse(true);
      const selection = window.getSelection()!;
      selection.removeAllRanges();
      selection.addRange(range);
      act(() => {
        document.dispatchEvent(new Event("selectionchange"));
      });

      // Inside the debounce window nothing is published yet.
      expect(published).toHaveLength(0);

      act(() => {
        vi.advanceTimersByTime(50);
      });
      expect(published).toHaveLength(1);
      expect(published[0]).toEqual({
        selection: { blockId: p, offset: 2 },
        updatedAt: expect.any(Number),
      });

      // A selection outside the editor maps to none → a null selection.
      const outside = document.createElement("span");
      outside.textContent = "outside";
      document.body.appendChild(outside);
      const outsideRange = document.createRange();
      outsideRange.setStart(outside.firstChild!, 1);
      outsideRange.collapse(true);
      selection.removeAllRanges();
      selection.addRange(outsideRange);
      act(() => {
        document.dispatchEvent(new Event("selectionchange"));
      });
      act(() => {
        vi.advanceTimersByTime(50);
      });
      expect(published[published.length - 1]).toEqual({
        selection: null,
        updatedAt: expect.any(Number),
      });

      // Window blur publishes null immediately (no debounce).
      const before = published.length;
      act(() => {
        window.dispatchEvent(new Event("blur"));
      });
      expect(published).toHaveLength(before + 1);
      expect(published[published.length - 1]).toEqual({
        selection: null,
        updatedAt: expect.any(Number),
      });

      // A queued publish is dropped on unmount.
      const backRange = document.createRange();
      backRange.setStart(textNode!, 4);
      backRange.collapse(true);
      selection.removeAllRanges();
      selection.addRange(backRange);
      act(() => {
        document.dispatchEvent(new Event("selectionchange"));
      });
      const queuedAt = published.length;
      unmount();
      act(() => {
        vi.advanceTimersByTime(50);
      });
      expect(published).toHaveLength(queuedAt);
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps the presence slice reference stable across self-echoing local publishes", () => {
    vi.useFakeTimers();
    try {
      const doc = createDoc({ id: "doc-1", createdAt: CREATED_AT });
      const p = doc.insertBlock("paragraph");
      doc.insertText(p, 0, "hello");

      const remote: PresenceState[] = [{ peerId: "42", updatedAt: 1, selection: { blockId: p, offset: 2 } }];
      let awarenessCb: ((peers: PresenceState[]) => void) | null = null;
      // Mimics WsSyncProvider: a local setAwareness fires the awareness
      // channel, which re-emits the (unchanged) remote peer list as a fresh
      // array.
      const provider: SyncProvider = {
        connect: async () => {},
        disconnect: () => {},
        sendUpdate: () => {},
        onUpdate: () => () => {},
        getLocalStateVector: () => new Uint8Array(),
        setAwareness: () => awarenessCb?.(remote),
        onAwareness: (cb) => {
          awarenessCb = cb;
          cb(remote);
          return () => {
            awarenessCb = null;
          };
        },
      };

      // A consumer that records the presence slice reference per render.
      const probe: { slice: unknown; renders: number } = { slice: undefined, renders: 0 };
      function Probe() {
        probe.slice = usePresence();
        probe.renders += 1;
        return null;
      }

      render(
        <EditorProvider doc={doc} provider={provider}>
          <Editor />
          <Probe />
        </EditorProvider>
      );

      expect(probe.slice).toBe(remote);
      const before = probe.slice;

      // A local selection change publishes after the debounce; the fake
      // self-echo re-emits the same remote list and must not re-render the
      // consumer (no slice identity churn).
      const el = document.querySelector<HTMLElement>(`[data-block-id="${p}"]`)!;
      const inner = el.querySelector<HTMLElement>('[data-slot="docblocks/block-content"]')!;
      const range = document.createRange();
      range.setStart(inner.firstChild!, 1);
      range.collapse(true);
      window.getSelection()!.removeAllRanges();
      window.getSelection()!.addRange(range);
      act(() => {
        document.dispatchEvent(new Event("selectionchange"));
      });
      act(() => {
        vi.advanceTimersByTime(50);
      });
      expect(probe.slice).toBe(before);

      // A real change to the remote list still re-renders.
      const changed: PresenceState[] = [{ peerId: "42", updatedAt: 2, selection: null }];
      act(() => {
        awarenessCb?.(changed);
      });
      expect(probe.slice).toBe(changed);
      expect(probe.slice).not.toBe(before);
    } finally {
      vi.useRealTimers();
    }
  });
});
