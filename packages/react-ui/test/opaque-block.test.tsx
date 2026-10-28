// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { fromJSON } from "docblocks-core";
import type { Doc, DocJSON, OpaqueBlock } from "docblocks-core";

import { Editor } from "../src/Editor";
import { EditorProvider } from "../src/EditorProvider";

const CREATED_AT = "2026-10-10T00:00:00.000Z";

/**
 * A v1 document whose root's children hold one unknown-type block (an
 * additive minor's data). The lenient reader boundary keeps it as
 * opaque data; the editor renders the known blocks and stands the unknown
 * one absent (no crash, no data loss — the export preserves it).
 */
function opaqueDoc(): { doc: Doc; paraId: string; futureId: string } {
  const json: DocJSON = {
    v: 1,
    id: "doc-opaque",
    title: "Opaque",
    createdAt: CREATED_AT,
    blocks: {
      "doc-opaque": { type: "root", children: ["para", "future"] },
      para: { type: "paragraph", content: [{ text: "known", marks: {} }] },
      // An unknown type: the reader's opaque stand (the fields as-is).
      future: { type: "future-block", attrs: { futureFlag: "keep" } } as OpaqueBlock,
    },
  };
  return { doc: fromJSON(json), paraId: "para", futureId: "future" };
}

describe("the cross-minor reader's UI stand", () => {
  afterEach(cleanup);

  it("renders the known blocks and stands the unknown one absent (no crash)", () => {
    const { doc, paraId, futureId } = opaqueDoc();
    render(
      <EditorProvider doc={doc}>
        <Editor />
      </EditorProvider>
    );
    // The known block renders.
    expect(document.querySelector(`[data-block-id="${paraId}"]`)).not.toBeNull();
    // The unknown block stands absent (the renderer has no type for it) —
    // not rendered, not corrupt.
    expect(document.querySelector(`[data-block-id="${futureId}"]`)).toBeNull();
    // The data is preserved in the export (no loss on the round trip).
    expect(doc.toJSON().blocks[futureId]).toMatchObject({ type: "future-block", attrs: { futureFlag: "keep" } });
  });
});
