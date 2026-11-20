// @vitest-environment jsdom
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import mermaid from "mermaid";
import { afterEach, describe, expect, it, vi } from "vitest";

import { act } from "react";

import { createDoc } from "docblocks-core";
import type { BlockId } from "docblocks-core";

import { Editor } from "../src/Editor";
import { EditorProvider } from "../src/editor-provider";
import { MermaidCodeRenderer } from "../src/mermaid/index";

const CREATED_AT = "2026-10-11T00:00:00.000Z";

// jsdom scope note: `mermaid.render` rejects for an invalid diagram (the
// parse fails before any layout work), but a valid diagram never completes
// here (the d3 layout pass needs a real DOM) — so the valid-diagram pin
// lives in the browser (test/e2e/mermaid.spec.ts), not in this suite.

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

  it("stands right of the language button (the header's left group) for a mermaid block", () => {
    const { container } = render(
      <EditorProvider doc={mermaidDoc("graph TD\n A-->B")} blockRenderers={{ code: MermaidCodeRenderer }}>
        <Editor />
      </EditorProvider>
    );
    const selector = container.querySelector('[data-slot="docblocks/mermaid-mode"]');
    expect(selector, "the selector should stand in the header").not.toBeNull();
    // The segment stands in the header's left group — the same parent as the
    // language button — and NOT in the right actions group.
    const language = container.querySelector('[data-slot="docblocks/code-language"]');
    const actions = container.querySelector('[data-slot="docblocks/code-header-actions"]');
    expect(language?.parentElement).toBe(selector?.parentElement);
    expect(actions?.contains(selector)).toBe(false);
  });

  it("does not stand for a non-mermaid code block", () => {
    const { container } = render(
      <EditorProvider doc={codeDoc()} blockRenderers={{ code: MermaidCodeRenderer }}>
        <Editor />
      </EditorProvider>
    );
    expect(container.querySelector('[data-slot="docblocks/mermaid-mode"]')).toBeNull();
  });

  it("defaults to code: the code tab is selected and the diagram stands hidden", () => {
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
    // The modes are exclusive: the code mode renders no diagram.
    expect(container.querySelector('[data-slot="docblocks/mermaid"]')).toBeNull();
    // The shared sliding pill stands in the segment (the highlight itself,
    // aria-hidden; jsdom measures zero geometry — the geometry is live-checked
    // by the e2e).
    const pill = container.querySelector('[data-slot="docblocks/mermaid-mode-pill"]');
    expect(pill).not.toBeNull();
    expect(pill?.getAttribute("aria-hidden")).toBe("true");
  });

  it("switching to preview writes the attr, hides the code body, and shows the diagram", () => {
    const doc = mermaidDoc("graph TD\n A-->B");
    const id = firstBlockId(doc);
    const { container } = render(
      <EditorProvider doc={doc} blockRenderers={{ code: MermaidCodeRenderer }}>
        <Editor />
      </EditorProvider>
    );
    // The modes are exclusive: the code mode renders no diagram.
    expect(container.querySelector('[data-slot="docblocks/mermaid"]')).toBeNull();
    act(() => {
      fireEvent.click(container.querySelector('[data-mermaid-mode-button="preview"]') as Element);
    });
    expect(doc.getBlock(id)).toMatchObject({ type: "code", attrs: { mermaidMode: "preview" } });
    const body = container.querySelector('[data-slot="docblocks/code-body"]');
    expect(body!.classList.contains("hidden")).toBe(true);
    // The diagram stands in the body's place (loading/diagram/error).
    expect(container.querySelector('[data-slot="docblocks/mermaid"]')).not.toBeNull();
    expect(container.querySelector('[data-mermaid-mode-button="preview"]')?.getAttribute("aria-pressed")).toBe("true");
  });

  it("switching back to code writes the attr, the code body stands, and the diagram drops", () => {
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
    // The modes are exclusive: the code mode renders no diagram.
    expect(container.querySelector('[data-slot="docblocks/mermaid"]')).toBeNull();
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
      // The plain toggle button's onClick (a real click).
      fireEvent.click(container.querySelector('[data-mermaid-mode-button="code"]') as Element);
    });
    expect(JSON.stringify(doc.toJSON())).toBe(before);
  });
});

describe("MermaidCodeRenderer", () => {
  afterEach(cleanup);

  it("shows the error state (no svg) for an invalid diagram", async () => {
    const { container } = render(
      // The error state stands in the preview mode (the diagram only renders there).
      <EditorProvider doc={mermaidDoc("graph TD\n A -->", "preview")} blockRenderers={{ code: MermaidCodeRenderer }}>
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
    // content (the flat model's "children") stands as the sequence's own
    // row — the row's threading stands no nested slot over the flat page,
    // and the child is never dropped.
    const codeWrapper = container.querySelector<HTMLElement>(`[data-block-id="${code}"]`)!;
    expect(codeWrapper.nextElementSibling).toBeNull();
    const childRow = container.querySelector<HTMLElement>(`[data-block-id="${child}"]`);
    expect(childRow, "the child renders as its own row").not.toBeNull();
    expect(childRow?.textContent).toContain("nested");
  });
});

describe("the editor-theme follow (EXT-02)", () => {
  afterEach(() => {
    cleanup();
    document.querySelectorAll("body > div.dark").forEach((el) => el.remove());
    vi.restoreAllMocks();
  });

  it("stands the dark theme for a dark editor and re-renders on a flip", async () => {
    const spy = vi.spyOn(mermaid, "initialize");
    const doc = mermaidDoc("graph TD\n A-->B", "preview");
    // The dark class stands on a wrapper element (set imperatively — the
    // theme contract is the `dark` class on the editor root or an
    // ancestor).
    const darkEl = document.createElement("div");
    darkEl.className = "dark";
    document.body.appendChild(darkEl);
    render(
      <EditorProvider doc={doc} blockRenderers={{ code: MermaidCodeRenderer }}>
        <Editor />
      </EditorProvider>,
      { container: darkEl }
    );

    // The dark class stands on the wrapper: the theme effect detects it
    // and the diagram's effect re-runs with the dark stand (the
    // module-scope light stand and the first mount stand precede it in
    // the call log).
    await waitFor(
      () => {
        const last = spy.mock.calls.at(-1);
        expect(last).toBeDefined();
        expect(last![0]?.theme).toBe("dark");
      },
      { timeout: 1_000 }
    );

    // A flip to light (the class leaves the ancestor chain) re-stands
    // the default theme.
    darkEl.classList.remove("dark");
    await waitFor(
      () => {
        const last = spy.mock.calls.at(-1);
        expect(last).toBeDefined();
        expect(last![0]?.theme).toBe("default");
      },
      { timeout: 1_000 }
    );
  });
});

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

describe("the viewport's geometry's re-clamp (the async svg's stand)", () => {
  afterEach(() => {
    cleanup();
    delete (globalThis as { ResizeObserver?: unknown }).ResizeObserver;
  });

  it("centers the diagram over the settled geometry without a gesture (the large diagram's load-time stand)", async () => {
    // The observer's stand: the browser's RO fires over the post-mount
    // geometry settle and the async svg's landing; the unit test records
    // the callbacks and notifies them over the stubbed boxes.
    const notifications: ResizeObserverCallback[] = [];
    class StubResizeObserver {
      constructor(callback: ResizeObserverCallback) {
        notifications.push(callback);
      }
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    }
    (globalThis as { ResizeObserver?: unknown }).ResizeObserver = StubResizeObserver;

    const doc = mermaidDoc("graph TD\n A-->B", "preview");
    const id = firstBlockId(doc);
    const { container } = render(
      <EditorProvider doc={doc} blockRenderers={{ code: MermaidCodeRenderer }}>
        <Editor />
      </EditorProvider>
    );
    const wrapper = container.querySelector<HTMLElement>('[data-slot="docblocks/mermaid-viewport"]')!;
    wrapper.getBoundingClientRect = () =>
      ({
        x: 0,
        y: 0,
        width: 900,
        height: 700,
        top: 0,
        left: 0,
        right: 900,
        bottom: 700,
        toJSON: () => ({}),
      }) as DOMRect;
    // The svg's async landing (the loading skeleton's own svg stands
    // removed — the measure takes the first svg of the layer).
    const layer = container.querySelector<HTMLElement>('[data-slot="docblocks/mermaid-viewport-layer"]')!;
    for (const existing of Array.from(layer.querySelectorAll("svg"))) existing.remove();
    const svgEl = document.createElement("svg");
    Object.defineProperty(svgEl, "clientWidth", { value: 300, configurable: true });
    Object.defineProperty(svgEl, "clientHeight", { value: 500, configurable: true });
    layer.appendChild(svgEl);

    const layerEl = container.querySelector<HTMLElement>('[data-slot="docblocks/mermaid-viewport-layer"]')!;
    // The mount's stand: no geometry (the jsdom's zero boxes) — the
    // identity, unclamped.
    expect(layerEl.style.transform).toBe("translate(0px, 0px) scale(1)");
    act(() => {
      for (const notify of notifications) notify([], {} as ResizeObserver);
    });
    // The settled stand: the centering over both axes (the 300×500
    // diagram in the 900×700 box — the canonical's clamp).
    expect(layerEl.style.transform).toBe("translate(300px, 100px) scale(1)");
    // The canonical's persist's no-op: the centered stand IS the
    // identity's canonical, so nothing lands on the wire (the attrs stay
    // the null idiom).
    await new Promise((resolve) => setTimeout(resolve, 400));
    const attrs = (doc.getBlock(id) as { attrs?: Record<string, unknown> } | null)?.attrs;
    expect(attrs?.zoom ?? null).toBeNull();
    expect(attrs?.panX ?? null).toBeNull();
    expect(attrs?.panY ?? null).toBeNull();
  });
});
