// @vitest-environment jsdom
// The attr-menus' read-only stands (the access's contract): the code
// header's controls (the language's picker's display-only stand, the
// collapse's / the caption's / the more's stands off — the write's
// entries), the caption line's display-only stand, and the image's
// figure's controls (the align's / the caption's stands off — the
// download's read-only stand keeps).
import { cleanup, render } from "@testing-library/react";
import type { BlobStore } from "docblocks-react-ui";
import { afterEach, describe, expect, it } from "vitest";

import { act } from "react";

import { createDoc } from "docblocks-core";
import type { BlockId, Doc } from "docblocks-core";

import { Editor } from "../src/Editor";
import { EditorProvider } from "../src/editor-provider";

const CREATED_AT = "2026-10-10T00:00:00.000Z";

/** The blob store stub (the image's url + the image's subtype). */
const blobStore: BlobStore = {
  resolve: async () => ({ url: "https://cdn.test/pic.png", meta: { subtype: "image", name: "pic.png" } }),
  upload: async () => "up-1",
};

/** Flush the async blob resolve (the promise settles on a microtask). */
async function flushResolve(): Promise<void> {
  await act(async () => {});
}

/** A doc with a code block (the language's attr) and an image block (the caption's attr). */
function makeDoc(id: string): { doc: ReturnType<typeof createDoc>; codeId: BlockId; imageId: BlockId } {
  const doc = createDoc({ id, createdAt: CREATED_AT });
  const codeId = doc.insertBlock("code");
  doc.updateBlock(codeId, { language: "ts", caption: "the code caption" });
  const imageId = doc.insertBlock("image", { src: "blob-key", caption: "the image caption" });
  return { doc, codeId, imageId };
}

/** Renders the doc over the mode (the absent stand is the edit's mode). */
async function renderDoc(doc: Doc, mode?: "edit" | "view") {
  const view = render(
    <EditorProvider doc={doc} mode={mode} blobStore={blobStore}>
      <Editor />
    </EditorProvider>
  );
  await flushResolve();
  return view;
}

describe("the attr-menus' read-only stands (the view / published's modes)", () => {
  afterEach(cleanup);

  it("the code's header stands the write's controls off and the copy's stand on (the view's mode)", async () => {
    const { doc } = makeDoc("doc-attr-1");
    const { container } = await renderDoc(doc, "view");
    // The language's display-only stand (the picker's entry stands off —
    // no trigger button).
    const language = container.querySelector('[data-slot="docblocks/code-language"]');
    expect(language).not.toBeNull();
    expect(language?.tagName).toBe("SPAN");
    expect(container.querySelector('[data-slot="docblocks/code-language-menu"]')).toBeNull();
    // The write's controls stand off (the collapse's, the caption's
    // toggle's, the more's).
    expect(container.querySelector('[data-slot="docblocks/code-collapse"]')).toBeNull();
    expect(container.querySelector('[data-slot="docblocks/code-caption-toggle"]')).toBeNull();
    expect(container.querySelector('[data-slot="docblocks/code-more"]')).toBeNull();
    // The copy's read-only stand keeps.
    expect(container.querySelector('[data-slot="docblocks/code-copy"]')).not.toBeNull();
  });

  it("the code's header stands the full's controls over the edit's mode (the parity pin)", async () => {
    const { doc } = makeDoc("doc-attr-2");
    const { container } = await renderDoc(doc);
    const language = container.querySelector('[data-slot="docblocks/code-language"]');
    expect(language?.tagName).toBe("BUTTON");
    expect(container.querySelector('[data-slot="docblocks/code-collapse"]')).not.toBeNull();
    expect(container.querySelector('[data-slot="docblocks/code-caption-toggle"]')).not.toBeNull();
    expect(container.querySelector('[data-slot="docblocks/code-more"]')).not.toBeNull();
    expect(container.querySelector('[data-slot="docblocks/code-copy"]')).not.toBeNull();
  });

  it("the caption stands the display-only stand over the view's mode and the input over the edit's (the caption's presence)", async () => {
    const { doc } = makeDoc("doc-attr-3");
    const { container } = await renderDoc(doc, "view");
    // The caption stands display-only (no input, no write's entry).
    const codeCaption = container.querySelector('[data-slot="docblocks/code-caption"]');
    expect(codeCaption).not.toBeNull();
    expect(codeCaption?.tagName).toBe("SPAN");
    expect(codeCaption?.textContent).toBe("the code caption");
    const imageCaption = container.querySelector('[data-slot="docblocks/image-caption"]');
    expect(imageCaption?.tagName).toBe("SPAN");
    cleanup();
    const { container: editContainer } = await renderDoc(makeDoc("doc-attr-4").doc);
    expect(editContainer.querySelector('[data-slot="docblocks/code-caption"]')?.tagName).toBe("INPUT");
    expect(editContainer.querySelector('[data-slot="docblocks/image-caption"]')?.tagName).toBe("INPUT");
  });

  it("the image's figure stands the align's and the caption's controls off and the download's stand on (the view's mode)", async () => {
    const { doc } = makeDoc("doc-attr-5");
    const { container } = await renderDoc(doc, "view");
    expect(container.querySelector('[data-slot="docblocks/image-figure"]')).not.toBeNull();
    expect(container.querySelector('[data-slot="docblocks/image-align"]')).toBeNull();
    expect(container.querySelector('[data-slot="docblocks/image-caption-toggle"]')).toBeNull();
    expect(container.querySelector('[data-slot="docblocks/image-download"]')).not.toBeNull();
  });

  it("the image's figure stands the full's controls over the edit's mode (the parity pin)", async () => {
    const { doc } = makeDoc("doc-attr-6");
    const { container } = await renderDoc(doc);
    expect(container.querySelector('[data-slot="docblocks/image-align"]')).not.toBeNull();
    expect(container.querySelector('[data-slot="docblocks/image-caption-toggle"]')).not.toBeNull();
  });
});
