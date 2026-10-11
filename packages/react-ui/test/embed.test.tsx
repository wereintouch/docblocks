// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { act } from "react";

import { createDoc } from "docblocks-core";
import type { Block } from "docblocks-core";

import { Editor } from "../src/Editor";
import { EditorProvider, useEditorContext } from "../src/EditorProvider";
import type { BlockRendererMap } from "../src/blocks/renderers";

const CREATED_AT = "2026-10-10T00:00:00.000Z";
type TestDoc = ReturnType<typeof createDoc>;

// Captures the context at render time (the store handle for the unknown-kind test).
let context: ReturnType<typeof useEditorContext> | null = null;
function ContextCapture() {
  context = useEditorContext();
  return null;
}

/** Seed the doc, then render provider + editor (+ context capture). */
function renderDoc(
  prepare: (doc: TestDoc) => void,
  options?: { blobResolver?: (key: string) => string; blockRenderers?: BlockRendererMap }
) {
  const doc = createDoc({ id: "doc-1", createdAt: CREATED_AT });
  prepare(doc);
  render(
    <EditorProvider doc={doc} blobResolver={options?.blobResolver} blockRenderers={options?.blockRenderers}>
      <Editor />
      <ContextCapture />
    </EditorProvider>
  );
  return doc;
}

afterEach(() => {
  cleanup();
  context = null;
});

describe("built-in renderer: embed", () => {
  it("renders the wrapper and a plain iframe with src, kind, and the title fallback", () => {
    renderDoc((doc) => doc.insertBlock("embed", { kind: "github", src: "https://github.com/x/y" }));

    const wrapper = document.querySelector<HTMLElement>('[data-slot="docblocks/block"][data-block-type="embed"]');
    expect(wrapper).not.toBeNull();
    expect(wrapper!.getAttribute("data-kind")).toBe("github");
    expect(wrapper!.getAttribute("data-block-id")).not.toBeNull();

    const iframe = wrapper!.querySelector<HTMLIFrameElement>('iframe[data-slot="docblocks/embed"]');
    expect(iframe).not.toBeNull();
    expect(iframe!.getAttribute("src")).toBe("https://github.com/x/y");
    // No title attr given: the aria title falls back to the kind.
    expect(iframe!.getAttribute("title")).toBe("github");
    expect(iframe!.getAttribute("loading")).toBe("lazy");

    // Not text-editable: no inner editable, no gutter handle.
    expect(wrapper!.querySelector('[data-slot="docblocks/block-content"]')).toBeNull();
    expect(wrapper!.querySelector("[contenteditable]")).toBeNull();
    expect(wrapper!.querySelector('[data-slot="docblocks/gutter"]')).toBeNull();
  });

  it("uses the attrs title when given", () => {
    renderDoc((doc) => doc.insertBlock("embed", { kind: "figma", src: "https://figma.com/file", title: "Design" }));

    const iframe = document.querySelector<HTMLIFrameElement>('[data-block-type="embed"] iframe');
    expect(iframe?.getAttribute("title")).toBe("Design");
  });

  it("does not apply the blob resolver (src is a URL, not a blob key)", () => {
    renderDoc((doc) => doc.insertBlock("embed", { kind: "iframe", src: "https://example.com/page" }), {
      blobResolver: () => "https://resolved.example/other",
    });

    const iframe = document.querySelector<HTMLIFrameElement>('[data-block-type="embed"] iframe');
    expect(iframe?.getAttribute("src")).toBe("https://example.com/page");
  });

  it("an unknown kind (newer data) still renders the same iframe", () => {
    renderDoc((doc) => doc.insertBlock("embed", { kind: "iframe", src: "https://example.com/seed" }));
    const store = context!.store;
    const state = store.getState();
    // The core readers never surface an unknown kind; inject the snapshot
    // through the store, the same way the unknown-type fallback is exercised.
    const fake: Block = {
      type: "embed",
      attrs: { kind: "youtube", src: "https://youtube.com/watch" },
    } as unknown as Block;

    act(() => {
      store.setState({
        blocks: { ...state.blocks, "embed-unknown": fake },
        rootChildren: [...state.rootChildren, "embed-unknown"],
      });
    });

    const iframe = document.querySelector<HTMLIFrameElement>(
      '[data-kind="youtube"] iframe[data-slot="docblocks/embed"]'
    );
    expect(iframe).not.toBeNull();
    expect(iframe!.getAttribute("src")).toBe("https://youtube.com/watch");
    expect(iframe!.getAttribute("title")).toBe("youtube");
  });
});

describe("renderer registry: embed", () => {
  it("a consumer renderer for embed replaces the built-in", () => {
    renderDoc((doc) => doc.insertBlock("embed", { kind: "loom", src: "https://loom.com/x" }), {
      blockRenderers: {
        embed: ({ id, block }) => (
          <div
            data-testid="custom-embed"
            data-custom-id={id}
            data-custom-src={block.type === "embed" ? block.attrs.src : ""}
          />
        ),
      },
    });

    const custom = document.querySelector('[data-testid="custom-embed"]');
    expect(custom).not.toBeNull();
    expect(custom!.getAttribute("data-custom-src")).toBe("https://loom.com/x");
    expect(document.querySelector('iframe[data-slot="docblocks/embed"]')).toBeNull();
  });
});
