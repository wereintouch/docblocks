// @vitest-environment jsdom
import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { createDoc } from "docblocks-core";

import { Editor } from "../src/Editor";
import { EditorProvider } from "../src/EditorProvider";
import { MermaidCodeRenderer } from "../src/mermaid/index";

const CREATED_AT = "2026-10-11T00:00:00.000Z";

// jsdom scope note: `mermaid.render` rejects for an invalid diagram (the
// parse fails before any layout work), but a valid diagram never completes
// here (the d3 layout pass needs a real DOM) — so the valid-diagram pin
// lives in the browser (test/e2e/mermaid.spec.ts), not in this suite.

/** The mermaid code block of a fresh doc, with the given diagram text. */
function mermaidDoc(text: string) {
  const doc = createDoc({ id: "doc-1", createdAt: CREATED_AT });
  doc.insertText(doc.insertBlock("code", { language: "mermaid" }), 0, text);
  return doc;
}

/** A non-mermaid code block. */
function codeDoc() {
  const doc = createDoc({ id: "doc-2", createdAt: CREATED_AT });
  doc.insertText(doc.insertBlock("code", { language: "ts" }), 0, "const x = 1;");
  return doc;
}

describe("MermaidCodeRenderer", () => {
  afterEach(cleanup);

  it("shows the error state (no svg) for an invalid diagram", async () => {
    const { container } = render(
      <EditorProvider doc={mermaidDoc("graph TD\n A -->")} blockRenderers={{ code: MermaidCodeRenderer }}>
        <Editor />
      </EditorProvider>
    );
    await waitFor(
      () => {
        expect(container.querySelector('[data-slot="docblocks/mermaid"][data-state="error"]')).not.toBeNull();
      },
      { timeout: 5_000 }
    );
    // No diagram (the error state renders the raw text + the message;
    // the Alert's triangle is chrome, not a diagram): the diagram
    // container is not mounted at all.
    expect(container.querySelector('[data-slot="docblocks/mermaid-diagram"]')).toBeNull();
    expect(container.querySelector('[data-slot="docblocks/mermaid-error"]')).not.toBeNull();
  });

  it("falls through to the plain code rendering for a non-mermaid code block", async () => {
    const { container } = render(
      <EditorProvider doc={codeDoc()} blockRenderers={{ code: MermaidCodeRenderer }}>
        <Editor />
      </EditorProvider>
    );
    // No diagram preview at all: the block is the built-in code view.
    await waitFor(
      () => {
        expect(container.querySelector('[data-slot="docblocks/block-content"]')).not.toBeNull();
      },
      { timeout: 1_000 }
    );
    expect(container.querySelector('[data-slot="docblocks/mermaid"]')).toBeNull();
    // No diagram svg anywhere in the content (the block's gutter grip
    // icon is chrome, not a preview).
    expect(container.querySelector('[data-slot="docblocks/block-content"] svg')).toBeNull();
  });

  it("keeps the nested content of a code block in the fallthrough rendering", () => {
    const doc = createDoc({ id: "doc-3", createdAt: CREATED_AT });
    const code = doc.insertBlock("code", { language: "ts" });
    doc.insertText(code, 0, "const x = 1;");
    const child = doc.insertBlock("paragraph", { indent: 1 });
    doc.insertText(child, 0, "nested");
    const { container } = render(
      <EditorProvider doc={doc} blockRenderers={{ code: MermaidCodeRenderer }}>
        <Editor />
      </EditorProvider>
    );
    // The override renders the built-in code view; the derived nested
    // content (the flat model's "children") stands as a nested slot AFTER
    // the replaced view — a sequence concern the custom renderer does not
    // thread (it is never dropped).
    const codeWrapper = container.querySelector<HTMLElement>(`[data-block-id="${code}"]`)!;
    const nested = codeWrapper.nextElementSibling;
    expect(nested, "the nested slot should stand after the replaced view").not.toBeNull();
    expect(nested!.getAttribute("data-slot")).toBe("docblocks/nested");
    expect(nested!.querySelector(`[data-block-id="${child}"]`), "the child renders inside").not.toBeNull();
  });
});
