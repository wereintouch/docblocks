// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createDoc } from "docblocks-core";

import { Editor } from "../src/Editor";
import { codeBlockHtmlOf } from "../src/blocks/code/code-clipboard";
import { EditorProvider } from "../src/editor-provider";

const CREATED_AT = "2026-10-14T00:00:00.000Z";
type TestDoc = ReturnType<typeof createDoc>;

function renderCodeDoc(prepare: (doc: TestDoc) => void): TestDoc {
  const doc = createDoc({ id: "doc-1", createdAt: CREATED_AT });
  prepare(doc);
  render(
    <EditorProvider doc={doc}>
      <Editor />
    </EditorProvider>
  );
  return doc;
}

describe("the code block header", () => {
  afterEach(cleanup);

  it("copies the block's plain text (indentation stands) and shows the circle-check feedback", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    const doc = renderCodeDoc((d) => {
      d.insertText(d.insertBlock("code"), 0, "if a:\n\tb()");
    });
    void doc;
    const copy = document.querySelector<HTMLElement>('[data-slot="docblocks/code-copy"]');
    expect(copy).not.toBeNull();
    act(() => {
      fireEvent.click(copy as Element);
    });
    await waitFor(() => {
      expect(document.querySelector('[data-slot="docblocks/code-copy"][data-copied="true"]')).not.toBeNull();
    });
    expect(writeText).toHaveBeenCalledWith("if a:\n\tb()");
  });

  it("copies the html + plain's payload (the ClipboardItem's stand — the language's class over the code's element)", async () => {
    const write = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { write, writeText: vi.fn().mockResolvedValue(undefined) } });
    // The `ClipboardItem`'s stand (the jsdom's absent stand — the component's
    // gate reads the global's presence).
    class ClipboardItemMock {
      constructor(private readonly payloads: Record<string, Blob>) {}
      get types(): string[] {
        return Object.keys(this.payloads);
      }
      getType(type: string): Blob {
        return this.payloads[type]!;
      }
    }
    const globalRef = globalThis as { ClipboardItem?: unknown };
    const previous = globalRef.ClipboardItem;
    globalRef.ClipboardItem = ClipboardItemMock;
    try {
      renderCodeDoc((d) => {
        d.insertText(d.insertBlock("code", { language: "python" }), 0, "if a:\n\tb()");
      });
      const copy = document.querySelector<HTMLElement>('[data-slot="docblocks/code-copy"]');
      expect(copy).not.toBeNull();
      act(() => {
        fireEvent.click(copy as Element);
      });
      await waitFor(() => {
        expect(document.querySelector("[data-slot='docblocks/code-copy'][data-copied='true']")).not.toBeNull();
      });
      expect(write).toHaveBeenCalledTimes(1);
      const item = write.mock.calls[0]![0]![0] as ClipboardItemMock;
      expect(item.types).toEqual(expect.arrayContaining(["text/html", "text/plain"]));
      expect(await item.getType("text/plain").text()).toBe("if a:\n\tb()");
      expect(await item.getType("text/html").text()).toBe(
        '<pre><code class="language-python">if a:\n\tb()</code></pre>'
      );
    } finally {
      globalRef.ClipboardItem = previous;
    }
  });
});

describe("the clipboard html's payload (the attribute context's stand)", () => {
  it("escapes the quote in the language's class attribute (the raw write's stand)", () => {
    // The `language` is a free data string (a raw `Y.Doc` write / a fence's
    // info can carry a quote): the `"` must not open a new attribute over
    // the third-party paste target.
    expect(codeBlockHtmlOf("body", 'x"onmouseover=alert(1)')).toBe(
      '<pre><code class="language-x&quot;onmouseover=alert(1)">body</code></pre>'
    );
  });

  it("escapes the quote in the code's body", () => {
    expect(codeBlockHtmlOf('say "hi"', "python")).toBe(
      '<pre><code class="language-python">say &quot;hi&quot;</code></pre>'
    );
  });
});
