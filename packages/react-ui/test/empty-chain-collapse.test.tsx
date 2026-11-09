// @vitest-environment jsdom
// The empty text chain's collapse (the read-only's stand): the pure's
// filter (the consecutive empty's text nodes over one indent stand as one)
// + the render's parity (the view's mode stands the chain over one's block,
// the edit's mode stands the chain's stand no stand).
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { createDoc } from "docblocks-core";

import { Editor } from "../src/Editor";
import { collapseEmptyTextChains } from "../src/blocks/flat";
import type { FlatNode } from "../src/blocks/flat";
import { EditorProvider } from "../src/editor-provider";

const CREATED_AT = "2026-10-10T00:00:00.000Z";

const node = (id: string, indent: number, children: FlatNode[] = []): FlatNode => ({ id, indent, children });

describe("collapseEmptyTextChains (the pure's filter)", () => {
  it("stands the consecutive empty's chain over one (the first's node stands the chain)", () => {
    const nodes = [node("a", 0), node("b", 0), node("c", 0)];
    const out = collapseEmptyTextChains(nodes, () => true);
    expect(out).toEqual([node("a", 0)]);
  });

  it("a non-empty's node breaks the chain (the chains' stands no stand over each other)", () => {
    const nodes = [node("a", 0), node("b", 0), node("c", 0), node("d", 0)];
    const out = collapseEmptyTextChains(nodes, (id) => id !== "b");
    expect(out).toEqual([node("a", 0), node("b", 0), node("c", 0)]);
  });

  it("an indent's change starts a new chain (the deeper's node stands over)", () => {
    const nodes = [node("a", 0), node("b", 0), node("c", 1), node("d", 1)];
    const out = collapseEmptyTextChains(nodes, () => true);
    expect(out).toEqual([node("a", 0), node("c", 1)]);
  });

  it("a node with children stands not empty (the sublist's stand keeps the row)", () => {
    const child = node("child", 1);
    const nodes = [node("a", 0, [child]), node("b", 0)];
    const out = collapseEmptyTextChains(nodes, () => true);
    expect(out).toEqual([node("a", 0, [child]), node("b", 0)]);
  });

  it("a single's empty node stands (the chain's minimum's two's stand)", () => {
    const nodes = [node("a", 0), node("b", 0)];
    const out = collapseEmptyTextChains(nodes, (id) => id === "a");
    expect(out).toEqual([node("a", 0), node("b", 0)]);
  });
});

describe("the empty chain's render (the view's mode over the edit's parity)", () => {
  afterEach(cleanup);

  /** A doc: three empty paragraphs + a texted one (the chain + the break). */
  function makeDoc(id: string): ReturnType<typeof createDoc> {
    const doc = createDoc({ id, createdAt: CREATED_AT });
    doc.insertBlock("paragraph");
    doc.insertBlock("paragraph");
    doc.insertBlock("paragraph");
    const last = doc.insertBlock("paragraph");
    doc.insertText(last, 0, "tail");
    return doc;
  }

  it("the view's mode stands the chain over one's block (the data's stand untouched)", () => {
    const doc = makeDoc("doc-cc-1");
    const { container } = render(
      <EditorProvider doc={doc} mode="view">
        <Editor />
      </EditorProvider>
    );
    const inners = container.querySelectorAll('[data-slot="docblocks/block-content"]');
    expect(inners, "the chain stands over one + the tail's block stands over").toHaveLength(2);
    expect(container.textContent).toContain("tail");
    // The data's stand: the sequence stands no stand (the collapse is the
    // render's filter, not the data's write).
    expect(doc.getChildren(doc.meta.id)).toHaveLength(4);
  });

  it("the edit's mode stands the chain's stand no stand (the default's parity)", () => {
    const doc = makeDoc("doc-cc-2");
    const { container } = render(
      <EditorProvider doc={doc}>
        <Editor />
      </EditorProvider>
    );
    expect(container.querySelectorAll('[data-slot="docblocks/block-content"]')).toHaveLength(4);
  });

  it("the published's mode stands the chain over one's block (the snapshot's parity)", () => {
    const doc = makeDoc("doc-cc-3");
    const snapshot = createDoc({ id: "doc-cc-3", createdAt: CREATED_AT });
    snapshot.insertBlock("paragraph");
    snapshot.insertBlock("paragraph");
    const { container } = render(
      <EditorProvider doc={doc} mode="published" publishedDoc={snapshot}>
        <Editor />
      </EditorProvider>
    );
    // The snapshot's two empties stand over one (the snapshot's doc renders
    // over the nested's read-only provider).
    const inners = container.querySelectorAll('[data-slot="docblocks/block-content"]');
    expect(inners).toHaveLength(1);
  });
});
