// @vitest-environment jsdom
// The mermaid preview's viewport: the pan/zoom's stand, the persisted
// view's restore, the height's stretch, the resize's drag + the fit's
// button.
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { createDoc } from "docblocks-core";
import type { BlockId } from "docblocks-core";

import { Editor } from "../src/Editor";
import { EditorProvider } from "../src/editor-provider";
import { MermaidCodeRenderer } from "../src/mermaid/index";

const CREATED_AT = "2026-10-11T00:00:00.000Z";

/** The mermaid code block of a fresh doc, with the given diagram text (optionally a display mode). */
function mermaidDoc(text: string, mode?: "code" | "preview") {
  const doc = createDoc({ id: "doc-1", createdAt: CREATED_AT });
  doc.insertText(
    doc.insertBlock("code", { language: "mermaid", ...(mode !== undefined ? { mermaidMode: mode } : {}) }),
    0,
    text
  );
  return doc;
}

/** The mermaid code block id of a fresh doc (the first root child). */
function firstBlockId(doc: ReturnType<typeof createDoc>): BlockId {
  return doc.getChildren(doc.meta.id)[0]!;
}

describe("the preview's viewport (the pan/zoom + the height's stand)", () => {
  afterEach(cleanup);

  it("stands the viewport over the preview's mode (the wrapper + the layer + the toolbar)", () => {
    const { container } = render(
      <EditorProvider doc={mermaidDoc("graph TD\n A-->B", "preview")} blockRenderers={{ code: MermaidCodeRenderer }}>
        <Editor />
      </EditorProvider>
    );
    const viewport = container.querySelector<HTMLElement>('[data-slot="docblocks/mermaid-viewport"]');
    expect(viewport, "the viewport over the preview's mode").not.toBeNull();
    expect(viewport!.querySelector('[data-slot="docblocks/mermaid-viewport-layer"]')).not.toBeNull();
    expect(viewport!.querySelector('[data-slot="docblocks/mermaid-viewport-toolbar"]')).not.toBeNull();
    expect(viewport!.querySelector('[data-slot="docblocks/mermaid-zoom-in"]')).not.toBeNull();
    expect(viewport!.querySelector('[data-slot="docblocks/mermaid-zoom-reset"]')).not.toBeNull();
    // The default's auto's stand (no `height`'s attr): no inline's height.
    expect(viewport!.style.height).toBe("");
  });

  it("stands no viewport over the code's mode (the diagram's stand hidden)", () => {
    const { container } = render(
      <EditorProvider doc={mermaidDoc("graph TD\n A-->B")} blockRenderers={{ code: MermaidCodeRenderer }}>
        <Editor />
      </EditorProvider>
    );
    expect(container.querySelector('[data-slot="docblocks/mermaid-viewport"]')).toBeNull();
  });

  it("restores the persisted view over the attrs (the transform's stand + the label's percent)", () => {
    const doc = mermaidDoc("graph TD\n A-->B", "preview");
    doc.updateBlock(firstBlockId(doc), { zoom: 0.5, panX: 10, panY: -5 });
    const { container } = render(
      <EditorProvider doc={doc} blockRenderers={{ code: MermaidCodeRenderer }}>
        <Editor />
      </EditorProvider>
    );
    const layer = container.querySelector<HTMLElement>('[data-slot="docblocks/mermaid-viewport-layer"]');
    expect(layer?.style.transform).toBe("translate(10px, -5px) scale(0.5)");
    expect(container.querySelector('[data-slot="docblocks/mermaid-zoom"]')?.textContent).toBe("50%");
  });

  it("stands the height attr's stretch (the inline's height's stand)", () => {
    const doc = mermaidDoc("graph TD\n A-->B", "preview");
    doc.updateBlock(firstBlockId(doc), { height: 320 });
    const { container } = render(
      <EditorProvider doc={doc} blockRenderers={{ code: MermaidCodeRenderer }}>
        <Editor />
      </EditorProvider>
    );
    expect(container.querySelector<HTMLElement>('[data-slot="docblocks/mermaid-viewport"]')?.style.height).toBe(
      "320px"
    );
  });

  it("writes the zoom over the toolbar's click (the debounce's rest's stand)", async () => {
    const doc = mermaidDoc("graph TD\n A-->B", "preview");
    const id = firstBlockId(doc);
    const { container } = render(
      <EditorProvider doc={doc} blockRenderers={{ code: MermaidCodeRenderer }}>
        <Editor />
      </EditorProvider>
    );
    fireEvent.click(container.querySelector('[data-slot="docblocks/mermaid-zoom-in"]')!);
    const codeAttrs = () => (doc.getBlock(id) as { attrs?: Record<string, unknown> } | null)?.attrs;
    await waitFor(() => expect(codeAttrs()?.zoom).toBe(1.2), { timeout: 2_000 });
    // The identity parts stand the null's persist (the null idiom's stand).
    expect(codeAttrs()?.panX).toBeNull();
  });

  it("stands the resize handle's absence over the view mode (the read-only's gate)", () => {
    const { container } = render(
      <EditorProvider
        doc={mermaidDoc("graph TD\n A-->B", "preview")}
        blockRenderers={{ code: MermaidCodeRenderer }}
        mode="view"
      >
        <Editor />
      </EditorProvider>
    );
    const viewport = container.querySelector<HTMLElement>('[data-slot="docblocks/mermaid-viewport"]');
    expect(viewport, "the viewport stands over the view mode (the observing gestures' parity)").not.toBeNull();
    expect(viewport!.querySelector('[data-slot="docblocks/mermaid-resize"]')).toBeNull();
  });
});

describe("the viewport's resize's drag + the fit's button", () => {
  afterEach(cleanup);

  /** The jsdom's no-layout stand: the wrapper's measured box (the rect's stub over the instance). */
  function stubWrapperRect(container: HTMLElement, height: number): HTMLElement {
    const wrapper = container.querySelector<HTMLElement>('[data-slot="docblocks/mermaid-viewport"]')!;
    wrapper.getBoundingClientRect = () =>
      ({
        x: 0,
        y: 0,
        width: 800,
        height,
        top: 0,
        left: 0,
        right: 800,
        bottom: height,
        toJSON: () => ({}),
      }) as DOMRect;
    return wrapper;
  }

  it("stands the drag's linear's stand (the no-accumulation's pin)", () => {
    const doc = mermaidDoc("graph TD\n A-->B", "preview");
    const id = firstBlockId(doc);
    const { container } = render(
      <EditorProvider doc={doc} blockRenderers={{ code: MermaidCodeRenderer }}>
        <Editor />
      </EditorProvider>
    );
    const wrapper = stubWrapperRect(container, 600);
    const handle = container.querySelector<HTMLElement>('[data-slot="docblocks/mermaid-resize"]')!;
    fireEvent.pointerDown(handle, { clientX: 100, clientY: 100, button: 0, pointerId: 1 });
    // The move's 30 px, then the 40's: the height stands the START's
    // delta (the accumulated session's stand super-linearizes it). The
    // moves stand on the handle (the pointer capture's stand: the drag's
    // events target the capturing's element, the bubbling reaches the
    // wrapper's pan's handler, which stands the no-op over the null's
    // session).
    fireEvent.pointerMove(handle, { clientX: 100, clientY: 130, pointerId: 1 });
    expect(wrapper.style.height).toBe("630px");
    fireEvent.pointerMove(handle, { clientX: 100, clientY: 140, pointerId: 1 });
    expect(wrapper.style.height, "the 40 px's stand over the 70's accumulate").toBe("640px");
    fireEvent.pointerUp(handle, { clientX: 100, clientY: 140, pointerId: 1 });
    const attrs = (doc.getBlock(id) as { attrs?: Record<string, unknown> } | null)?.attrs;
    expect(attrs?.height, "the commit's write over the rest").toBe(640);
  });

  it("fits the diagram over the button (the scale's cap + the centering's stand)", async () => {
    const doc = mermaidDoc("graph TD\n A-->B", "preview");
    const id = firstBlockId(doc);
    const { container } = render(
      <EditorProvider doc={doc} blockRenderers={{ code: MermaidCodeRenderer }}>
        <Editor />
      </EditorProvider>
    );
    stubWrapperRect(container, 600);
    // The diagram's box's stand (the svg's stub over the layer — the
    // jsdom's no-render's stand: the spinner's svg (the loading's
    // skeleton) stands removed first — the measure takes the first svg).
    const layer = container.querySelector<HTMLElement>('[data-slot="docblocks/mermaid-viewport-layer"]')!;
    for (const existing of Array.from(layer.querySelectorAll("svg"))) existing.remove();
    const svgEl = document.createElement("svg");
    Object.defineProperty(svgEl, "clientWidth", { value: 400, configurable: true });
    Object.defineProperty(svgEl, "clientHeight", { value: 1200, configurable: true });
    layer.appendChild(svgEl);
    const codeAttrs = () => (doc.getBlock(id) as { attrs?: Record<string, unknown> } | null)?.attrs;
    fireEvent.click(container.querySelector('[data-slot="docblocks/mermaid-fit"]')!);
    // The fit's view's stand (the transform's sync's write over the state
    // — the persist's debounce's rest follows over the attrs).
    const layerEl = container.querySelector<HTMLElement>('[data-slot="docblocks/mermaid-viewport-layer"]')!;
    expect(layerEl.style.transform).toBe("translate(300px, 0px) scale(0.5)");
    // The fit's scale = min(800/400, 600/1200, 1) = 0.5 (the cap's no-
    // upscaling's stand); the centering: the x's 300's stand ((800 -
    // 400 * 0.5) / 2), the y's identity's null's persist.
    await waitFor(() => expect(codeAttrs()?.zoom).toBe(0.5), { timeout: 2_000 });
    expect(codeAttrs()?.panX).toBe(300);
    expect(codeAttrs()?.panY).toBeNull();
  });
});
