// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { act } from "react";

import { createDoc } from "docblocks-core";
import type { BlockId, PresenceState, SyncProvider } from "docblocks-core";

import { Editor } from "../src/Editor";
import { EditorProvider } from "../src/EditorProvider";

const CREATED_AT = "2026-10-10T00:00:00.000Z";
type TestDoc = ReturnType<typeof createDoc>;

/** A fake transport whose only active channel is the awareness callback. */
function makeFakeProvider() {
  let awarenessCb: ((peers: PresenceState[]) => void) | null = null;
  const provider: SyncProvider = {
    connect: async () => {},
    disconnect: () => {},
    sendUpdate: () => {},
    onUpdate: () => () => {},
    getLocalStateVector: () => new Uint8Array(),
    setAwareness: () => {},
    onAwareness: (cb) => {
      awarenessCb = cb;
      return () => {
        awarenessCb = null;
      };
    },
  };
  return { provider, emit: (peers: PresenceState[]) => awarenessCb?.(peers) };
}

/** The id of the (single) paragraph block of the doc. */
function paragraphIdOf(doc: TestDoc): BlockId {
  const blocks = doc.toJSON().blocks;
  const id = Object.keys(blocks).find((key) => blocks[key]?.type === "paragraph");
  expect(id, "the doc should have a paragraph").toBeDefined();
  return id!;
}

/**
 * Render the provider + editor with a fake awareness channel; returns the
 * doc, the emit handle, and the editor root element (stable across re-renders).
 */
function renderEditor(prepare: (doc: TestDoc) => void) {
  const doc = createDoc({ id: "doc-1", createdAt: CREATED_AT });
  prepare(doc);
  const { provider, emit } = makeFakeProvider();
  const { container } = render(
    <EditorProvider doc={doc} provider={provider}>
      <Editor />
    </EditorProvider>
  );
  const root = container.querySelector<HTMLElement>('[data-slot="docblocks/editor"]');
  expect(root, "the editor root should be rendered").not.toBeNull();
  return { doc, emit, root: root! };
}

/** Count the presence caret bars of one peer inside the editor root. */
function barCount(root: HTMLElement, peerId: string): number {
  return root.querySelectorAll(`[data-slot="docblocks/presence-caret"][data-peer="${peerId}"]`).length;
}

/** Count the presence range boxes of one peer inside the editor root. */
function rangeBoxCount(root: HTMLElement, peerId: string): number {
  return root.querySelectorAll(`[data-slot="docblocks/presence-range"][data-peer="${peerId}"]`).length;
}

afterEach(cleanup);

describe("presence overlay (remote carets)", () => {
  it("renders a caret bar for a peer's caret selection and clears it on a null selection", () => {
    const { doc, emit, root } = renderEditor((d) => {
      const id = d.insertBlock("paragraph");
      d.insertText(id, 0, "hello");
    });
    const id = paragraphIdOf(doc);

    expect(barCount(root, "peer-7")).toBe(0);

    act(() => {
      emit([{ peerId: "peer-7", selection: { blockId: id, offset: 2 }, updatedAt: 1 }]);
    });
    expect(barCount(root, "peer-7")).toBe(1);

    act(() => {
      emit([{ peerId: "peer-7", selection: null, updatedAt: 2 }]);
    });
    expect(barCount(root, "peer-7")).toBe(0);
  });

  it("draws the range boxes (not caret bars) for a peer's range selection; blocks kind and null draw nothing", () => {
    const { doc, emit, root } = renderEditor((d) => {
      const id = d.insertBlock("paragraph");
      d.insertText(id, 0, "hello");
    });
    const id = paragraphIdOf(doc);

    act(() => {
      emit([
        {
          peerId: "peer-9",
          selection: { from: { blockId: id, offset: 0 }, to: { blockId: id, offset: 3 } },
          updatedAt: 1,
        },
        { peerId: "peer-11", selection: { blocks: [id] }, updatedAt: 1 },
        { peerId: "peer-13", selection: null, updatedAt: 1 },
      ]);
    });

    // The same-block range is one highlight box carrying the segment's block id.
    expect(rangeBoxCount(root, "peer-9")).toBe(1);
    expect(
      root.querySelector(`[data-slot="docblocks/presence-range"][data-peer="peer-9"][data-range-block="${id}"]`)
    ).not.toBeNull();
    expect(barCount(root, "peer-9")).toBe(0);
    expect(rangeBoxCount(root, "peer-11")).toBe(0);
    expect(barCount(root, "peer-11")).toBe(0);
    expect(rangeBoxCount(root, "peer-13")).toBe(0);
  });

  it("draws one range box per chain block for a cross-block range", () => {
    const { doc, emit, root } = renderEditor((d) => {
      const id1 = d.insertBlock("paragraph");
      d.insertText(id1, 0, "alpha");
      const id2 = d.insertBlock("paragraph");
      d.insertText(id2, 0, "beta");
    });
    const blocks = doc.toJSON().blocks;
    const ids = Object.keys(blocks).filter((key) => blocks[key]?.type === "paragraph");
    expect(ids).toHaveLength(2);
    const [id1, id2] = ids;

    act(() => {
      emit([
        {
          peerId: "peer-9",
          selection: {
            from: { blockId: id1 as BlockId, offset: 2 },
            to: { blockId: id2 as BlockId, offset: 1 },
            blocks: [id1 as BlockId, id2 as BlockId],
          },
          updatedAt: 1,
        },
      ]);
    });

    // One box per chain block (a zero-geometry box each in jsdom), tagged
    // with the segment's block.
    expect(rangeBoxCount(root, "peer-9")).toBe(2);
    expect(
      root.querySelector(`[data-slot="docblocks/presence-range"][data-peer="peer-9"][data-range-block="${id1}"]`)
    ).not.toBeNull();
    expect(
      root.querySelector(`[data-slot="docblocks/presence-range"][data-peer="peer-9"][data-range-block="${id2}"]`)
    ).not.toBeNull();
    expect(barCount(root, "peer-9")).toBe(0);
  });

  it("skips the stale chain blocks of a range leniently", () => {
    const { doc, emit, root } = renderEditor((d) => {
      const id = d.insertBlock("paragraph");
      d.insertText(id, 0, "hello");
    });
    const id = paragraphIdOf(doc);

    // The chain names a block that no longer exists: only the live segment
    // draws.
    act(() => {
      emit([
        {
          peerId: "peer-9",
          selection: {
            from: { blockId: "stale-block" as BlockId, offset: 0 },
            to: { blockId: id, offset: 3 },
            blocks: ["stale-block" as BlockId, id],
          },
          updatedAt: 1,
        },
      ]);
    });

    expect(rangeBoxCount(root, "peer-9")).toBe(1);
    expect(
      root.querySelector(`[data-slot="docblocks/presence-range"][data-peer="peer-9"][data-range-block="${id}"]`)
    ).not.toBeNull();
  });

  it("draws nothing for a peer pointing at a block that is not rendered", () => {
    const { emit, root } = renderEditor((d) => {
      d.insertBlock("paragraph");
    });

    act(() => {
      emit([{ peerId: "peer-7", selection: { blockId: "missing-block", offset: 0 }, updatedAt: 1 }]);
    });
    expect(root.querySelector('[data-slot="docblocks/presence-caret"]')).toBeNull();
  });

  it("drops the bar of a block removed by a peer", () => {
    const { doc, emit, root } = renderEditor((d) => {
      const id = d.insertBlock("paragraph");
      d.insertText(id, 0, "hello");
    });
    const id = paragraphIdOf(doc);

    act(() => {
      emit([{ peerId: "peer-7", selection: { blockId: id, offset: 1 }, updatedAt: 1 }]);
    });
    expect(barCount(root, "peer-7")).toBe(1);

    act(() => {
      doc.removeBlock(id);
    });
    expect(barCount(root, "peer-7")).toBe(0);
  });
});
