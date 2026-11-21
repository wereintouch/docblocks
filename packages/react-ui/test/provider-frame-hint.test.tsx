// @vitest-environment jsdom
// The editor frame and the empty-block's hint: the root's Card's wrap and
// the `data-placeholder`'s stand (the default's hint, the
// `commandPalettePlaceholder`'s override, the nested provider's
// inheritance).
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { createDoc } from "docblocks-core";

import { Editor } from "../src/Editor";
import { EditorProvider } from "../src/editor-provider";

const CREATED_AT = "2026-10-10T00:00:00.000Z";

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
