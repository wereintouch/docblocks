// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { StrictMode, act, memo } from "react";

import { DestroyedViewError, createDoc, loadDoc } from "docblocks-core";
import type { BlockId, PresenceState, SyncProvider } from "docblocks-core";

import { Editor } from "../src/Editor";
import { EditorProvider, useEditorContext } from "../src/EditorProvider";
import type { EditorContextValue } from "../src/EditorProvider";
import { usePresence, useSelection, useText } from "../src/hooks";

const CREATED_AT = "2026-10-10T00:00:00.000Z";

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

/** Captures the provider's context object (the selection view handle). */
function useCapture() {
  return useEditorContext();
}

describe("EditorProvider + Editor", () => {
  // No vitest globals in this package: register the RTL cleanup explicitly.
  afterEach(cleanup);

  it("a peer write leaving the tail non-text stands the trailing paragraph (the remote feed's guard)", async () => {
    const doc = createDoc({ id: "doc-1", createdAt: CREATED_AT });
    const p = doc.insertBlock("paragraph");
    doc.insertText(p, 0, "text");

    render(
      <EditorProvider doc={doc}>
        <Editor />
      </EditorProvider>
    );

    // The peer's state: the doc's own snapshot forked, the database landed
    // over the tail, the full state applied as a remote update (no local
    // origin; a no-op over what the doc already stands).
    const fork = loadDoc(doc.encode());
    fork.insertBlock("database", { tableId: "ext-remote" });
    doc.applyUpdate(fork.encodeUpdate());
    expect(doc.getBlock(doc.getChildren(doc.meta.id)[doc.getChildren(doc.meta.id).length - 1]!)?.type).toBe("database");

    // The guard runs once the in-flight transaction settles (a microtask):
    // the editable trailing paragraph stands over the non-text tail, as
    // its own local write.
    await act(async () => {
      await new Promise<void>((resolve) => void queueMicrotask(() => void queueMicrotask(resolve)));
    });
    const sequence = doc.getChildren(doc.meta.id);
    const tailId = sequence[sequence.length - 1]!;
    expect(doc.getBlock(tailId)?.type).toBe("paragraph");
    expect(doc.getText(tailId)).toBe("");
  });

  it("renders text blocks with their markup", () => {
    const doc = createDoc({ id: "doc-1", createdAt: CREATED_AT });
    const p = doc.insertBlock("paragraph");
    const h = doc.insertBlock("heading", { level: 3 });
    doc.insertText(p, 0, "hello world");
    doc.setMark(p, 0, 5, { type: "bold" });
    doc.setMark(p, 6, 11, { type: "link", href: "https://example.org" });
    doc.insertText(h, 0, "A heading");

    render(
      <EditorProvider doc={doc}>
        <Editor />
      </EditorProvider>
    );

    expect(screen.getByRole("heading", { level: 3 }).textContent).toBe("A heading");
    const bold = screen.getByText("hello");
    expect(bold.tagName).toBe("STRONG");
    expect(screen.getByRole("link", { name: "world" }).getAttribute("href")).toBe("https://example.org");
  });

  it("updates the DOM when commands run outside the provider", () => {
    const doc = createDoc({ id: "doc-1", createdAt: CREATED_AT });
    const p1 = doc.insertBlock("paragraph");
    doc.insertText(p1, 0, "abc");

    render(
      <EditorProvider doc={doc}>
        <Editor />
      </EditorProvider>
    );
    expect(screen.getByText("abc")).toBeDefined();

    act(() => {
      doc.insertText(p1, 3, "XY");
    });
    expect(screen.getByText("abcXY")).toBeDefined();

    act(() => {
      const p2 = doc.insertBlock("paragraph");
      doc.insertText(p2, 0, "second");
    });
    expect(screen.getByText("second")).toBeDefined();

    act(() => {
      doc.removeBlock(p1);
    });
    expect(screen.queryByText("abcXY")).toBeNull();
    expect(screen.getByText("second")).toBeDefined();
  });

  it("does not re-render a sibling block when another block changes", () => {
    const doc = createDoc({ id: "doc-1", createdAt: CREATED_AT });
    const p1 = doc.insertBlock("paragraph");
    const p2 = doc.insertBlock("paragraph");
    doc.insertText(p1, 0, "one");
    doc.insertText(p2, 0, "two");

    const renders = new Map<string, number>();
    const Probe = memo(function Probe({ id }: { id: BlockId }) {
      const text = useText(id);
      renders.set(id, (renders.get(id) ?? 0) + 1);
      return <span data-testid={`probe-${id}`}>{text}</span>;
    });

    render(
      <EditorProvider doc={doc}>
        <Editor />
        <Probe id={p1} />
        <Probe id={p2} />
      </EditorProvider>
    );
    expect(renders.get(p1)).toBe(1);
    expect(renders.get(p2)).toBe(1);

    act(() => {
      doc.insertText(p1, 3, "!");
    });

    expect(renders.get(p1)).toBe(2);
    expect(renders.get(p2)).toBe(1);
    expect(screen.getByTestId(`probe-${p1}`).textContent).toBe("one!");
    expect(screen.getByTestId(`probe-${p2}`).textContent).toBe("two");
  });

  it("reflects view.set(...) in useSelection", () => {
    const doc = createDoc({ id: "doc-1", createdAt: CREATED_AT });
    const p = doc.insertBlock("paragraph");
    doc.insertText(p, 0, "abc");

    let context: EditorContextValue | undefined;
    const Capture = () => {
      context = useCapture();
      return null;
    };
    const SelectionProbe = () => {
      const selection = useSelection();
      const label =
        selection.kind === "text"
          ? `text:${selection.from.blockId}:${selection.from.offset}:${selection.to === null ? "caret" : "range"}`
          : selection.kind;
      return <span data-testid="selection">{label}</span>;
    };

    render(
      <EditorProvider doc={doc}>
        <Editor />
        <Capture />
        <SelectionProbe />
      </EditorProvider>
    );
    expect(screen.getByTestId("selection").textContent).toBe("none");

    act(() => {
      context!.selection.view!.set({ kind: "text", from: { blockId: p, offset: 1 }, to: null });
    });
    expect(screen.getByTestId("selection").textContent).toBe(`text:${p}:1:caret`);
  });

  it("updates usePresence from the provider's awareness channel", () => {
    const doc = createDoc({ id: "doc-1", createdAt: CREATED_AT });
    const p = doc.insertBlock("paragraph");
    doc.insertText(p, 0, "abc");
    const { provider, emit } = makeFakeProvider();

    const PresenceProbe = () => {
      const presence = usePresence();
      return <span data-testid="presence">{presence.map((peer) => peer.peerId).join(",")}</span>;
    };

    render(
      <EditorProvider doc={doc} provider={provider}>
        <Editor />
        <PresenceProbe />
      </EditorProvider>
    );
    expect(screen.getByTestId("presence").textContent).toBe("");

    const peer: PresenceState = { peerId: "peer-7", selection: { blockId: p, offset: 0 }, updatedAt: 42 };
    act(() => {
      emit([peer]);
    });
    expect(screen.getByTestId("presence").textContent).toBe("peer-7");
  });

  it("survives a StrictMode double-mount", () => {
    const doc = createDoc({ id: "doc-1", createdAt: CREATED_AT });
    const p = doc.insertBlock("paragraph");
    doc.insertText(p, 0, "abc");

    let context: EditorContextValue | undefined;
    const Capture = () => {
      context = useCapture();
      return null;
    };

    render(
      <StrictMode>
        <EditorProvider doc={doc}>
          <Editor />
          <Capture />
        </EditorProvider>
      </StrictMode>
    );
    expect(screen.getByText("abc")).toBeDefined();

    // The view created on the second mount is live and drives the store.
    act(() => {
      context!.selection.view!.set({ kind: "text", from: { blockId: p, offset: 0 }, to: null });
    });
    act(() => {
      doc.insertText(p, 3, "!");
    });
    expect(screen.getByText("abc!")).toBeDefined();
  });

  it("tears down on unmount: no store updates and a destroyed selection view", () => {
    const doc = createDoc({ id: "doc-1", createdAt: CREATED_AT });
    const p = doc.insertBlock("paragraph");
    doc.insertText(p, 0, "abc");

    let context: EditorContextValue | undefined;
    const Capture = () => {
      context = useCapture();
      return null;
    };

    const { unmount } = render(
      <EditorProvider doc={doc}>
        <Editor />
        <Capture />
      </EditorProvider>
    );
    const view = context!.selection.view!;
    const store = context!.store;

    let storeUpdates = 0;
    const unsubscribe = store.subscribe(() => {
      storeUpdates += 1;
    });

    unmount();

    expect(() => view.set({ kind: "none" })).toThrow(DestroyedViewError);
    doc.insertText(p, 3, "x");
    expect(storeUpdates).toBe(0);
    unsubscribe();
  });
});

describe("the editor frame and the empty-block hint", () => {
  afterEach(cleanup);

  it("the editor root is wrapped in the shared Card", () => {
    const doc = createDoc({ id: "doc-frame", createdAt: CREATED_AT });
    doc.insertBlock("paragraph");
    const { container } = render(
      <EditorProvider doc={doc}>
        <Editor />
      </EditorProvider>
    );
    const editor = container.querySelector('[data-slot="docblocks/editor"]');
    expect(editor).not.toBeNull();
    expect(editor!.closest('[data-slot="card"]')).toBe(editor!.parentElement);
  });

  it("the empty text block carries the default hint text", () => {
    const doc = createDoc({ id: "doc-hint", createdAt: CREATED_AT });
    doc.insertBlock("paragraph");
    const { container } = render(
      <EditorProvider doc={doc}>
        <Editor />
      </EditorProvider>
    );
    const inner = container.querySelector('[data-slot="docblocks/block-content"]');
    expect(inner?.getAttribute("data-placeholder")).toBe("Type '/' for commands");
  });

  it("the provider's commandPalettePlaceholder overrides the hint text", () => {
    const doc = createDoc({ id: "doc-hint-2", createdAt: CREATED_AT });
    doc.insertBlock("paragraph");
    const { container } = render(
      <EditorProvider doc={doc} commandPalettePlaceholder="Type '/' to insert">
        <Editor />
      </EditorProvider>
    );
    const inner = container.querySelector('[data-slot="docblocks/block-content"]');
    expect(inner?.getAttribute("data-placeholder")).toBe("Type '/' to insert");
  });

  it("a nested provider without its own placeholder inherits the enclosing one", () => {
    const doc = createDoc({ id: "doc-hint-3", createdAt: CREATED_AT });
    doc.insertBlock("paragraph");
    const b = doc.insertBlock("paragraph");
    const { container } = render(
      <EditorProvider doc={doc} commandPalettePlaceholder="Outer hint">
        <EditorProvider doc={doc} rootBlockId={b}>
          <Editor />
        </EditorProvider>
      </EditorProvider>
    );
    const inners = container.querySelectorAll('[data-slot="docblocks/block-content"]');
    expect(inners).toHaveLength(1);
    expect(inners[0]?.getAttribute("data-placeholder")).toBe("Outer hint");
  });
});
