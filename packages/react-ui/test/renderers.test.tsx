// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { StrictMode, act } from "react";

import { createDoc } from "docblocks-core";
import type { Block } from "docblocks-core";

import { Editor } from "../src/Editor";
import { EditorProvider, useEditorContext } from "../src/EditorProvider";
import type { BlockRendererMap } from "../src/blocks/renderers";

const CREATED_AT = "2026-10-10T00:00:00.000Z";

// Captures the context at render time (the store handle for the unknown-type test).
let context: ReturnType<typeof useEditorContext> | null = null;
function ContextCapture() {
  context = useEditorContext();
  return null;
}

/** Seed the doc, then render provider + editor + context capture. */
function renderDoc(prepare: (doc: ReturnType<typeof createDoc>) => void, renderers?: BlockRendererMap) {
  const doc = createDoc({ id: "doc-1", createdAt: CREATED_AT });
  prepare(doc);
  render(
    <EditorProvider doc={doc} blockRenderers={renderers}>
      <StrictMode>
        <Editor />
        <ContextCapture />
      </StrictMode>
    </EditorProvider>
  );
  return doc;
}

afterEach(() => {
  cleanup();
  context = null;
});

describe("block renderer registry", () => {
  it("a consumer renderer for divider replaces the built-in", () => {
    renderDoc((doc) => doc.insertBlock("divider"), {
      divider: () => <div data-testid="custom-divider" />,
    });

    expect(screen.getByTestId("custom-divider")).toBeDefined();
    expect(document.querySelector('hr[data-slot="docblocks/divider"]')).toBeNull();
  });

  it("a type without a consumer renderer keeps its built-in", () => {
    const doc = renderDoc(
      (d) => {
        const p = d.insertBlock("paragraph");
        d.insertText(p, 0, "hello");
        d.insertBlock("divider");
      },
      { divider: () => <div data-testid="custom-divider" /> }
    );

    // The consumer renderer wins for divider...
    expect(screen.getByTestId("custom-divider")).toBeDefined();
    // ...and the paragraph keeps its built-in contenteditable.
    const p = doc.toJSON().blocks;
    const paragraphId = Object.keys(p).find((key) => p[key]?.type === "paragraph")!;
    const el = document.querySelector<HTMLElement>(`[data-block-id="${paragraphId}"]`);
    expect(el?.textContent).toBe("hello");
    expect(el?.getAttribute("contenteditable")).toBe("true");
  });

  it("an unknown type renders the placeholder", () => {
    renderDoc((doc) => doc.insertBlock("divider"));
    const store = context!.store;
    const state = store.getState();
    const fake: Block = { type: "future-type" } as unknown as Block;

    // The core readers never surface an unknown type; inject the snapshot
    // through the store to exercise the resolution fallback.
    act(() => {
      store.setState({
        blocks: { ...state.blocks, "future-1": fake },
        rootChildren: [...state.rootChildren, "future-1"],
      });
    });

    const placeholder = document.querySelector('[data-slot="docblocks/placeholder"][data-block-type="future-type"]');
    expect(placeholder?.textContent).toBe("future-type");
  });

  it("a consumer renderer for paragraph replaces the contenteditable", () => {
    const doc = renderDoc(
      (d) => {
        const p = d.insertBlock("paragraph");
        d.insertText(p, 0, "hello");
      },
      {
        paragraph: ({ id, block }) => (
          <div data-testid="custom-paragraph" data-custom-id={id}>
            {block.type}
          </div>
        ),
      }
    );

    const p = doc.toJSON().blocks;
    const paragraphId = Object.keys(p).find((key) => p[key]?.type === "paragraph")!;
    const custom = screen.getByTestId("custom-paragraph");
    expect(custom.getAttribute("data-custom-id")).toBe(paragraphId);
    // The built-in element is gone with it.
    expect(document.querySelector(`[data-block-id="${paragraphId}"]`)).toBeNull();
    expect(document.querySelector("[contenteditable]")).toBeNull();
  });
});
