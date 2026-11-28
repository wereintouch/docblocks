// @vitest-environment jsdom
// The embed's stretched height (the handle's drag / the keyboard's step, the
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { act } from "react";

import { createDoc } from "docblocks-core";

import { Editor } from "../src/Editor";
import type { BlockRendererMap } from "../src/blocks/renderers";
import { EditorProvider } from "../src/editor-provider";

const CREATED_AT = "2026-10-10T00:00:00.000Z";
type TestDoc = ReturnType<typeof createDoc>;

/** Seed the doc, then render provider + editor. */
function renderDoc(
  prepare: (doc: TestDoc) => void,
  options?: {
    blockRenderers?: BlockRendererMap;
    embedSandbox?: (src: string) => string | null;
    mode?: "edit" | "view" | "published";
  }
) {
  const doc = createDoc({ id: "doc-1", createdAt: CREATED_AT });
  prepare(doc);
  render(
    <EditorProvider
      doc={doc}
      blockRenderers={options?.blockRenderers}
      embedSandbox={options?.embedSandbox}
      mode={options?.mode}
    >
      <Editor />
    </EditorProvider>
  );
  return doc;
}

afterEach(() => {
  cleanup();
});

describe("embed height (the stretched stand)", () => {
  const HANDLE_SELECTOR = "[data-slot='docblocks/embed-resize']";
  const WRAPPER_SELECTOR = '[data-block-type="embed"]:not([data-slot="docblocks/row"])';
  const MIN = 300; // the token's default (jsdom's fallback)

  function renderEmbedStretched() {
    const doc = renderDoc((d) => d.insertBlock("embed", { kind: "iframe", src: "https://example.com/page" }));
    const wrapper = document.querySelector<HTMLElement>(WRAPPER_SELECTOR)!;
    // The jsdom's zero rect's stand: the wrapper's 800x<height>'s rect —
    // the height's stand: the inline style's stretch or the token's default
    // (the live's stand: the stretched's wrapper is actually taller).
    wrapper.getBoundingClientRect = () => {
      const h = wrapper.style.height === "" ? MIN : Number.parseFloat(wrapper.style.height);
      return {
        width: 800,
        height: h,
        top: 0,
        left: 0,
        right: 800,
        bottom: h,
        x: 0,
        y: 0,
        toJSON: () => null,
      } as DOMRect;
    };
    return { doc, wrapper };
  }

  it("the handle stands over the edit mode (the slider's aria); absent over the view mode", () => {
    renderDoc((d) => d.insertBlock("embed", { kind: "iframe", src: "https://example.com/page" }));
    const handle = document.querySelector<HTMLElement>(HANDLE_SELECTOR);
    expect(handle).not.toBeNull();
    expect(handle!.getAttribute("role")).toBe("slider");
    expect(handle!.getAttribute("aria-orientation")).toBe("vertical");
    expect(handle!.getAttribute("aria-valuemin")).toBe(String(MIN));

    cleanup();
    renderDoc((d) => d.insertBlock("embed", { kind: "iframe", src: "https://example.com/page" }), { mode: "view" });
    expect(document.querySelector(HANDLE_SELECTOR)).toBeNull();
  });

  it("the drag stretches the wrapper's height; the rest's write stands the `height` attr", async () => {
    const { doc, wrapper } = renderEmbedStretched();
    const embedId = doc.getChildren(doc.toJSON().id)[0]!;
    const handle = document.querySelector<HTMLElement>(HANDLE_SELECTOR)!;

    await act(async () => {
      fireEvent.pointerDown(handle, { button: 0, pointerId: 1, clientY: 0 });
      fireEvent.pointerMove(handle, { pointerId: 1, clientY: 100 });
    });
    // The live's stand: the wrapper's height grows over the drag...
    expect(wrapper.style.height).toBe(`${MIN + 100}px`);

    // ...and the rest's commit lands the stretched px over the block's attrs.
    await act(async () => {
      fireEvent.pointerUp(handle, { pointerId: 1, clientY: 100 });
    });
    expect(doc.getBlock(embedId)).toMatchObject({ attrs: { height: MIN + 100 } });
  });

  it("the drag over the minimum clamps (the stretch's only stand; the no-op's clear's no-write)", async () => {
    const { doc, wrapper } = renderEmbedStretched();
    const embedId = doc.getChildren(doc.toJSON().id)[0]!;
    const handle = document.querySelector<HTMLElement>(HANDLE_SELECTOR)!;

    await act(async () => {
      fireEvent.pointerDown(handle, { button: 0, pointerId: 1, clientY: 0 });
      fireEvent.pointerMove(handle, { pointerId: 1, clientY: -50 });
    });
    // The clamp's stand: the height's live's stand the minimum (the
    // wrapper's height's no-shrink over the token's stand).
    expect(wrapper.style.height).toBe(`${MIN}px`);

    await act(async () => {
      fireEvent.pointerUp(handle, { pointerId: 1, clientY: -50 });
    });
    // The no-op's stand: the unwritten's default writes nothing.
    expect(doc.getBlock(embedId)).toMatchObject({ attrs: { kind: "iframe", src: "https://example.com/page" } });

    // The stretch: the drag down's stand the `height` attr's write.
    await act(async () => {
      fireEvent.pointerDown(handle, { button: 0, pointerId: 2, clientY: 0 });
      fireEvent.pointerMove(handle, { pointerId: 2, clientY: 100 });
      fireEvent.pointerUp(handle, { pointerId: 2, clientY: 100 });
    });
    expect(doc.getBlock(embedId)).toMatchObject({ attrs: { height: MIN + 100 } });

    // The stretched's clear: the drag back over the minimum's stand the
    // null idiom's write (the default's restore).
    await act(async () => {
      fireEvent.pointerDown(handle, { button: 0, pointerId: 3, clientY: 0 });
      fireEvent.pointerMove(handle, { pointerId: 3, clientY: -350 });
      fireEvent.pointerUp(handle, { pointerId: 3, clientY: -350 });
    });
    expect(doc.getBlock(embedId)).toMatchObject({ attrs: { height: null } });
  });

  it("the keyboard's arrows stretch / clear over the step (the one key press's one write)", async () => {
    const { doc } = renderEmbedStretched();
    const embedId = doc.getChildren(doc.toJSON().id)[0]!;
    const handle = document.querySelector<HTMLElement>(HANDLE_SELECTOR)!;

    await act(async () => {
      fireEvent.keyDown(handle, { key: "ArrowDown" });
    });
    expect(doc.getBlock(embedId)).toMatchObject({ attrs: { height: MIN + 16 } });

    await act(async () => {
      fireEvent.keyDown(handle, { key: "ArrowUp" });
    });
    // The step's back over the minimum's stand the clear's write (the
    // default's restore).
    expect(doc.getBlock(embedId)).toMatchObject({ attrs: { height: null } });
  });

  it("restores the stretched height over the mount (the reload's stand)", () => {
    const doc = renderDoc((d) => {
      const id = d.insertBlock("embed", { kind: "iframe", src: "https://example.com/page" });
      d.updateBlock(id, { height: 500 });
    });
    const wrapper = document.querySelector<HTMLElement>(WRAPPER_SELECTOR)!;
    expect(wrapper.style.height).toBe("500px");
    expect(doc.getBlock(doc.getChildren(doc.toJSON().id)[0]!)).toMatchObject({ attrs: { height: 500 } });
  });
});
