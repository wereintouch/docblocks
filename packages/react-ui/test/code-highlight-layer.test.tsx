// @vitest-environment jsdom
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { createDoc } from "docblocks-core";
import type { BlockId } from "docblocks-core";

import { Editor } from "../src/Editor";
import { EditorProvider } from "../src/EditorProvider";

const CREATED_AT = "2026-10-14T00:00:00.000Z";
type TestDoc = ReturnType<typeof createDoc>;

const PYTHON = "def main():\n    return 1\n";

function renderCodeDoc(prepare: (doc: TestDoc, id: BlockId) => void): { doc: TestDoc; id: BlockId } {
  const doc = createDoc({ id: "doc-1", createdAt: CREATED_AT });
  const id = doc.insertBlock("code");
  prepare(doc, id);
  render(
    <EditorProvider doc={doc}>
      <Editor />
    </EditorProvider>
  );
  return { doc, id };
}

/** The highlight layer (the background `<pre>`). */
function layerOf(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[data-slot="docblocks/code-highlight"]');
}

/** The inner editable of the code block. */
function innerOf(id: BlockId): HTMLElement {
  const el = document.querySelector<HTMLElement>(`[data-block-id="${id}"][data-slot="docblocks/block-content"]`);
  expect(el, "the code inner editable should be present").not.toBeNull();
  return el!;
}

/** The inner's logical text (the rendered line anchors carry no characters). */
function innerText(el: HTMLElement): string {
  const clone = el.cloneNode(true) as HTMLElement;
  clone.querySelectorAll('[data-slot="docblocks/line-anchor"]').forEach((a) => a.remove());
  return clone.textContent ?? "";
}

/** Wait for the grammar load to settle the highlighted fragment. */
async function expectHighlighted(): Promise<void> {
  await waitFor(() => expect(layerOf()?.innerHTML).toContain("hljs-keyword"), { timeout: 3000 });
}

describe("the code highlight layer (the background highlight)", () => {
  afterEach(cleanup);

  it("stands the highlighted fragment behind the inner for a curated language", async () => {
    const { id } = renderCodeDoc((d, blockId) => {
      d.updateBlock(blockId, { language: "python" });
      d.insertText(blockId, 0, PYTHON);
    });

    const layer = layerOf();
    expect(layer, "the layer should be mounted for a curated language").not.toBeNull();
    expect(layer!.getAttribute("aria-hidden")).toBe("true");

    const inner = innerOf(id);
    expect(inner.className).toContain("text-transparent");
    expect(inner.className).toContain("caret-");
    // the doc's source stands verbatim in the inner (the layer is a projection)
    expect(innerText(inner)).toBe(PYTHON);

    await expectHighlighted();
    expect(layerOf()!.innerHTML).toContain("hljs-title");
  });

  it("is a pure view state (the doc data is untouched by the layer)", async () => {
    const { doc, id } = renderCodeDoc((d, blockId) => {
      d.updateBlock(blockId, { language: "python" });
      d.insertText(blockId, 0, PYTHON);
    });
    const before = JSON.stringify(doc.toJSON());
    await expectHighlighted();
    expect(JSON.stringify(doc.toJSON())).toBe(before);
    expect(doc.getText(id)).toBe(PYTHON);
  });

  it("stands no layer (and the visible text) for plain, unknown, and mermaid languages", () => {
    const { doc, id } = renderCodeDoc((d, blockId) => d.insertText(blockId, 0, PYTHON));
    expect(layerOf()).toBeNull(); // the absent language
    expect(innerOf(id).className).not.toContain("text-transparent");

    act(() => {
      doc.updateBlock(id, { language: "nail" });
    });
    expect(layerOf()).toBeNull(); // the unknown language
    expect(innerOf(id).className).not.toContain("text-transparent");

    act(() => {
      doc.updateBlock(id, { language: "mermaid" });
    });
    expect(layerOf()).toBeNull(); // the mermaid language
    expect(innerOf(id).className).not.toContain("text-transparent");
  });

  it("matches the inner's wrap mode (the shared scroll box keeps the alignment)", () => {
    const { doc, id } = renderCodeDoc((d, blockId) => {
      d.updateBlock(blockId, { language: "python" });
      d.insertText(blockId, 0, PYTHON);
    });

    const layer = layerOf()!;
    const inner = innerOf(id);
    expect(layer.className).toContain("whitespace-pre-wrap");
    expect(inner.className).toContain("whitespace-pre-wrap");

    act(() => {
      doc.updateBlock(id, { wrap: false });
    });
    const layerAfter = layerOf()!;
    const innerAfter = innerOf(id);
    expect(layerAfter.className).toContain("whitespace-pre");
    expect(layerAfter.className).not.toContain("whitespace-pre-wrap");
    expect(innerAfter.className).toContain("whitespace-pre");
    expect(innerAfter.className).not.toContain("whitespace-pre-wrap");
  });

  it("follows a text edit (the fragment re-paints over the changed text)", async () => {
    const { doc, id } = renderCodeDoc((d, blockId) => {
      d.updateBlock(blockId, { language: "python" });
      d.insertText(blockId, 0, "def main():");
    });
    await expectHighlighted();
    expect(layerOf()!.innerHTML).not.toContain("hljs-number");

    act(() => {
      doc.insertText(id, "def main():".length, "\n    return 1");
    });
    await waitFor(() => expect(layerOf()?.innerHTML).toContain("hljs-number"), { timeout: 3000 });
    expect(innerText(innerOf(id))).toBe("def main():\n    return 1");
  });

  it("re-highlights on a language change", async () => {
    const { doc, id } = renderCodeDoc((d, blockId) => {
      d.updateBlock(blockId, { language: "python" });
      d.insertText(blockId, 0, '{"x": 1}\n');
    });
    // python paints the string, no attr token
    await waitFor(() => expect(layerOf()?.innerHTML).toContain("hljs-string"), { timeout: 3000 });
    expect(layerOf()!.innerHTML).not.toContain("hljs-attr");

    act(() => {
      doc.updateBlock(id, { language: "json" });
    });
    // the json grammar paints the key as an attr (the fragment re-painted,
    // not merely reset to the raw text)
    await waitFor(() => expect(layerOf()?.innerHTML).toContain("hljs-attr"), { timeout: 3000 });
    expect(innerText(innerOf(id))).toBe('{"x": 1}\n');
  });

  it("keeps the raw text visible while a fresh language grammar loads", async () => {
    const { id } = renderCodeDoc((d, blockId) => {
      d.updateBlock(blockId, { language: "go" });
      d.insertText(blockId, 0, "package main\n");
    });
    const layer = layerOf()!;
    // the raw state stands from the first frame (the grammar is not loaded yet)
    expect(layer.textContent).toBe("package main\n");
    await waitFor(() => expect(layerOf()?.innerHTML).toContain("hljs-"), { timeout: 3000 });
    expect(innerOf(id).className).toContain("text-transparent");
  });
});

describe("the non-code text blocks stand untouched", () => {
  afterEach(cleanup);

  it("the paragraph inner keeps its visible text (no transparent ink, no layer)", () => {
    const doc = createDoc({ id: "doc-1", createdAt: CREATED_AT });
    const id = doc.insertBlock("paragraph");
    doc.insertText(id, 0, "plain text");
    render(
      <EditorProvider doc={doc}>
        <Editor />
      </EditorProvider>
    );
    const inner = document.querySelector<HTMLElement>(`[data-block-id="${id}"][data-slot="docblocks/block-content"]`);
    expect(inner?.className).not.toContain("text-transparent");
    expect(layerOf()).toBeNull();
  });
});
