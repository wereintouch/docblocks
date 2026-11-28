// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { act } from "react";

import { createDoc } from "docblocks-core";
import type { PresenceState, SyncProvider } from "docblocks-core";

import { Editor } from "../src/Editor";
import { EditorProvider } from "../src/editor-provider";
import { peerBlockIdsOf } from "../src/presence/PresenceCaretOverlay";

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
  it("renders the slot on the editor root, blocks, list items, and row markers", () => {
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
    expect(
      document.querySelector(`[data-block-id="${p}"]:not([data-slot="docblocks/row"])`)?.getAttribute("data-slot")
    ).toBe("docblocks/block");
    expect(document.querySelector('[data-slot="docblocks/block"][data-block-type="heading"]')).not.toBeNull();
    expect(document.querySelectorAll('[data-slot="docblocks/list-item"]').length).toBe(2);
    // The flat stand: the list's marker stands the kind (no list element —
    // the row's marker label renders the marker per row).
    expect(document.querySelector('[data-slot="docblocks/row-marker"][data-kind="bullet"]')).not.toBeNull();
    expect(document.querySelector('[data-slot="docblocks/row-marker"][data-kind="number"]')).not.toBeNull();
    expect(document.querySelector('[data-slot="docblocks/divider"][data-block-type="divider"]')).not.toBeNull();
  });
});

describe("the presence overlay's stands (the crafted frame, the re-render contract)", () => {
  it("stands the crafted presence frame over the tree (the CSS.escape sink — no selector crash)", async () => {
    const doc = createDoc({ id: "doc-1", createdAt: CREATED_AT });
    const p = doc.insertBlock("paragraph");
    doc.insertText(p, 0, "hello");
    const { provider, emit } = makePublishingProvider();

    await act(async () => {
      render(
        <EditorProvider doc={doc} provider={provider}>
          <Editor />
        </EditorProvider>
      );
    });

    // The crafted peer: the blockId carries the selector metacharacters (the
    // unescaped interpolation stands the invalid selector — the querySelector
    // throws over the effect and the crash takes the whole tree down, the
    // overlay stands no boundary).
    const crafted: PresenceState[] = [
      {
        peerId: "evil",
        updatedAt: 1,
        selection: { blockId: '"] } [contenteditable="x"', offset: 0 },
      },
    ];
    await act(async () => {
      emit(crafted);
    });
    // The tree stands intact (the crafted frame draws no box — the block
    // stands absent — the selector stands no throw).
    expect(document.querySelector(`[data-block-id="${p}"]:not([data-slot="docblocks/row"])`)).not.toBeNull();
    expect(document.querySelector('[data-slot="docblocks/presence-caret"]')).toBeNull();
  });

  it("derives the peer blocks' ids over the selection's shapes (the precise subscription's input)", () => {
    expect(
      peerBlockIdsOf([
        { peerId: "a", updatedAt: 1, selection: { blockId: "b2", offset: 0 } },
        {
          peerId: "b",
          updatedAt: 1,
          selection: { from: { blockId: "b1", offset: 0 }, to: { blockId: "b3", offset: 1 } },
        },
        {
          peerId: "c",
          updatedAt: 1,
          selection: { from: { blockId: "b1", offset: 0 }, to: { blockId: "b3", offset: 1 }, blocks: ["b4"] },
        },
        { peerId: "d", updatedAt: 1, selection: null },
      ])
    ).toEqual(["b1", "b2", "b3", "b4"]);
  });
});
