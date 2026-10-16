// @vitest-environment jsdom
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { act } from "react";

import { createDoc } from "docblocks-core";
import type { BlockId } from "docblocks-core";

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

/** The mermaid code block id of a fresh doc (the first root child). */
function firstBlockId(doc: ReturnType<typeof createDoc>): BlockId {
  return doc.getChildren(doc.meta.id)[0]!;
}

describe("the code/preview mode selector (the mermaidMode attr)", () => {
  afterEach(cleanup);

  it("stands in the header's center slot (right of the language button) for a mermaid block", () => {
    const { container } = render(
      <EditorProvider doc={mermaidDoc("graph TD\n A-->B")} blockRenderers={{ code: MermaidCodeRenderer }}>
        <Editor />
      </EditorProvider>
    );
    const selector = container.querySelector('[data-slot="docblocks/mermaid-mode"]');
    expect(selector, "the selector should stand in the header").not.toBeNull();
    // The center slot: the first child of the actions group (between the
    // language button and the right controls).
    const actions = container.querySelector('[data-slot="docblocks/code-header-actions"]');
    expect(actions?.firstElementChild).toBe(selector);
  });

  it("does not stand for a non-mermaid code block", () => {
    const { container } = render(
      <EditorProvider doc={codeDoc()} blockRenderers={{ code: MermaidCodeRenderer }}>
        <Editor />
      </EditorProvider>
    );
    expect(container.querySelector('[data-slot="docblocks/mermaid-mode"]')).toBeNull();
  });

  it("defaults to code: the code button is pressed and the code body stands", () => {
    const { container } = render(
      <EditorProvider doc={mermaidDoc("graph TD\n A-->B")} blockRenderers={{ code: MermaidCodeRenderer }}>
        <Editor />
      </EditorProvider>
    );
    expect(container.querySelector('[data-mermaid-mode-button="code"]')?.getAttribute("aria-pressed")).toBe("true");
    expect(container.querySelector('[data-mermaid-mode-button="preview"]')?.getAttribute("aria-pressed")).toBe("false");
    const body = container.querySelector('[data-slot="docblocks/code-body"]');
    expect(body, "the code body should stand").not.toBeNull();
    expect(body!.classList.contains("hidden")).toBe(false);
  });

  it("switching to preview writes the attr and hides the code body (the diagram stands)", () => {
    const doc = mermaidDoc("graph TD\n A-->B");
    const id = firstBlockId(doc);
    const { container } = render(
      <EditorProvider doc={doc} blockRenderers={{ code: MermaidCodeRenderer }}>
        <Editor />
      </EditorProvider>
    );
    act(() => {
      fireEvent.click(container.querySelector('[data-mermaid-mode-button="preview"]') as Element);
    });
    expect(doc.getBlock(id)).toMatchObject({ type: "code", attrs: { mermaidMode: "preview" } });
    const body = container.querySelector('[data-slot="docblocks/code-body"]');
    expect(body!.classList.contains("hidden")).toBe(true);
    // The diagram area stands in the body's place (loading/diagram/error).
    expect(container.querySelector('[data-slot="docblocks/mermaid"]')).not.toBeNull();
    expect(container.querySelector('[data-mermaid-mode-button="preview"]')?.getAttribute("aria-pressed")).toBe("true");
  });

  it("switching back to code writes the attr and the code body stands again", () => {
    const doc = mermaidDoc("graph TD\n A-->B");
    const id = firstBlockId(doc);
    doc.updateBlock(id, { mermaidMode: "preview" });
    const { container } = render(
      <EditorProvider doc={doc} blockRenderers={{ code: MermaidCodeRenderer }}>
        <Editor />
      </EditorProvider>
    );
    const body = container.querySelector('[data-slot="docblocks/code-body"]');
    expect(body!.classList.contains("hidden")).toBe(true);
    act(() => {
      fireEvent.click(container.querySelector('[data-mermaid-mode-button="code"]') as Element);
    });
    expect(doc.getBlock(id)).toMatchObject({ type: "code", attrs: { mermaidMode: "code" } });
    expect(body!.classList.contains("hidden")).toBe(false);
  });

  it("a repeat of the current mode is a no-op (the doc stands unchanged)", () => {
    const doc = mermaidDoc("graph TD\n A-->B");
    const { container } = render(
      <EditorProvider doc={doc} blockRenderers={{ code: MermaidCodeRenderer }}>
        <Editor />
      </EditorProvider>
    );
    const before = JSON.stringify(doc.toJSON());
    act(() => {
      fireEvent.click(container.querySelector('[data-mermaid-mode-button="code"]') as Element);
    });
    expect(JSON.stringify(doc.toJSON())).toBe(before);
  });
});

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
