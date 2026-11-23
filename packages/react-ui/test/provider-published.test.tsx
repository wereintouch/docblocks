// @vitest-environment jsdom
// The published's stand: the snapshot's render over the nested read-only
// provider (the remount on the new snapshot, the static content) and the
// not-published's placeholder (the absent snapshot, the viewer's direct
// render).
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { createDoc } from "docblocks-core";

import { Editor } from "../src/Editor";
import { EditorProvider, useEditorContext } from "../src/editor-provider";

const CREATED_AT = "2026-10-10T00:00:00.000Z";

describe("the published's stand (the snapshot's render + the placeholder)", () => {
  afterEach(cleanup);

  it("remounts the nested provider over a new snapshot (the stand key's swap, the same snapshot's keep)", () => {
    // The remount's contract: a new snapshot instance stands a new nested
    // provider (a new store — the doc's stand must not change over a
    // mounted provider), the same snapshot stands no re-mount over the
    // re-render (the key's stable reference keeps the instance).
    const live = createDoc({ id: "doc-pub-2", createdAt: CREATED_AT });
    live.insertText(live.insertBlock("paragraph"), 0, "LIVE");
    const snapshot1 = createDoc({ id: "doc-pub-2", createdAt: CREATED_AT });
    snapshot1.insertText(snapshot1.insertBlock("paragraph"), 0, "SNAP1");
    const snapshot2 = createDoc({ id: "doc-pub-2", createdAt: CREATED_AT });
    snapshot2.insertText(snapshot2.insertBlock("paragraph"), 0, "SNAP2");

    const seenStores: unknown[] = [];
    function StoreProbe() {
      const ctx = useEditorContext();
      seenStores.push(ctx.store);
      return null;
    }

    const view = render(
      <EditorProvider doc={live} mode="published" publishedDoc={snapshot1}>
        <StoreProbe />
        <Editor />
      </EditorProvider>
    );
    const store1 = seenStores[seenStores.length - 1];
    expect(view.container.textContent).toContain("SNAP1");

    // The same snapshot's re-render: the instance stands (the store's
    // reference keeps).
    view.rerender(
      <EditorProvider doc={live} mode="published" publishedDoc={snapshot1}>
        <StoreProbe />
        <Editor />
      </EditorProvider>
    );
    expect(seenStores[seenStores.length - 1]).toBe(store1);

    // The new snapshot: the key's swap stands the remount (a new store,
    // the snapshot's content stands over the live's).
    view.rerender(
      <EditorProvider doc={live} mode="published" publishedDoc={snapshot2}>
        <StoreProbe />
        <Editor />
      </EditorProvider>
    );
    expect(seenStores[seenStores.length - 1]).not.toBe(store1);
    expect(view.container.textContent).toContain("SNAP2");
    expect(view.container.textContent).not.toContain("SNAP1");
  });

  it("renders the snapshot's doc read-only (the live's stand off over the published's mode)", () => {
    const live = createDoc({ id: "doc-pub-1", createdAt: CREATED_AT });
    live.insertText(live.insertBlock("paragraph"), 0, "LIVE");
    const snapshot = createDoc({ id: "doc-pub-1", createdAt: CREATED_AT });
    snapshot.insertText(snapshot.insertBlock("paragraph"), 0, "PUBLISHED");
    const { container } = render(
      <EditorProvider doc={live} mode="published" publishedDoc={snapshot}>
        <Editor />
      </EditorProvider>
    );
    expect(container.textContent).toContain("PUBLISHED");
    expect(container.textContent).not.toContain("LIVE");
  });

  it("stands the not-published's placeholder over the absent's stand (the viewer holds no doc at all)", () => {
    const { container } = render(
      <EditorProvider accessLevel="viewer">
        <Editor />
      </EditorProvider>
    );
    expect(container.querySelector('[data-slot="docblocks/not-published"]')).not.toBeNull();
    expect(container.textContent).toContain("not been published");
    expect(container.querySelector('[data-slot="docblocks/editor"]')).toBeNull();
    expect(container.querySelector('[data-slot="docblocks/block-content"]')).toBeNull();
  });

  it("the viewer's stand renders the snapshot's doc read-only, directly (the security stand — no live doc, no nested stand)", () => {
    // The doc the consumer passes IS the published snapshot (the reader's
    // browser never holds the live document): a doc the viewer may see,
    // nothing else.
    const snapshot = createDoc({ id: "doc-pub-5", createdAt: CREATED_AT });
    snapshot.insertText(snapshot.insertBlock("paragraph"), 0, "PUBLISHED");
    snapshot.insertBlock("divider"); // a non-text tail: the guarantee's write target
    const before = snapshot.toJSON();
    const { container } = render(
      <EditorProvider doc={snapshot} accessLevel="viewer">
        <Editor />
      </EditorProvider>
    );
    expect(container.textContent).toContain("PUBLISHED");
    // The render stands directly over the doc (no nested provider's stand
    // — a single editor root).
    expect(container.querySelectorAll('[data-slot="docblocks/editor"]').length).toBe(1);
    expect(container.querySelector('[data-slot="docblocks/editor"]')?.getAttribute("data-readonly")).toBe("true");
    const blockId = snapshot.getChildren(snapshot.meta.id)[0]!;
    const inner = container.querySelector(`[data-block-id="${blockId}"][data-slot="docblocks/block-content"]`);
    expect(inner?.getAttribute("contenteditable")).toBe("false");
    expect(container.querySelector('[data-slot="docblocks/gutter"]')).toBeNull();
    // The read-only stand never writes into its own doc (the tail's
    // guarantee stands off over the viewer's stand).
    expect(snapshot.toJSON()).toEqual(before);
  });

  it("the editor's published's mode stands the same stand over an unpublished doc", () => {
    const live = createDoc({ id: "doc-pub-3", createdAt: CREATED_AT });
    live.insertText(live.insertBlock("paragraph"), 0, "DRAFT");
    const { container } = render(
      <EditorProvider doc={live} mode="published">
        <Editor />
      </EditorProvider>
    );
    expect(container.querySelector('[data-slot="docblocks/not-published"]')).not.toBeNull();
    expect(container.textContent).not.toContain("DRAFT");
  });

  it("the snapshot stands static (the read-only stand never writes into its own doc)", () => {
    const live = createDoc({ id: "doc-pub-4", createdAt: CREATED_AT });
    live.insertText(live.insertBlock("paragraph"), 0, "LIVE");
    const snapshot = createDoc({ id: "doc-pub-4", createdAt: CREATED_AT });
    snapshot.insertText(snapshot.insertBlock("paragraph"), 0, "PUBLISHED");
    snapshot.insertBlock("divider"); // a non-text tail: the guarantee's write target
    const before = snapshot.toJSON();
    render(
      <EditorProvider doc={live} mode="published" publishedDoc={snapshot}>
        <Editor />
      </EditorProvider>
    );
    expect(snapshot.toJSON()).toEqual(before);
    const sequence = snapshot.getChildren(snapshot.meta.id);
    expect(snapshot.getBlock(sequence[sequence.length - 1]!)).toMatchObject({ type: "divider" });
  });
});
