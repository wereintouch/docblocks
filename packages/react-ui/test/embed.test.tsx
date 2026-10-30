// @vitest-environment jsdom
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { act } from "react";

import { createDoc } from "docblocks-core";
import type { Block } from "docblocks-core";

import { Editor } from "../src/Editor";
import type { BlockRendererMap } from "../src/blocks/renderers";
import { DEFAULT_EMBED_SANDBOX, EditorProvider, useEditorContext } from "../src/editor-provider";

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
  options?: {
    blobResolver?: (key: string) => string;
    blockRenderers?: BlockRendererMap;
    embedSandbox?: (src: string) => string | null;
  }
) {
  const doc = createDoc({ id: "doc-1", createdAt: CREATED_AT });
  prepare(doc);
  render(
    <EditorProvider
      doc={doc}
      blobResolver={options?.blobResolver}
      blockRenderers={options?.blockRenderers}
      embedSandbox={options?.embedSandbox}
    >
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

  it("stands the safe default sandbox over the iframe (no same-origin access)", () => {
    renderDoc((doc) => doc.insertBlock("embed", { kind: "iframe", src: "https://example.com/page" }));
    const iframe = document.querySelector<HTMLIFrameElement>('[data-block-type="embed"] iframe');
    // The safe default: scripts / forms / popups run, but NO allow-same-origin
    // — the embedded content is an opaque origin and cannot read the parent's
    // DOM / state.
    expect(iframe?.getAttribute("sandbox")).toBe(DEFAULT_EMBED_SANDBOX);
    expect(iframe?.getAttribute("sandbox")).not.toContain("allow-same-origin");
  });

  it("applies the consumer's embedSandbox policy (a trusted origin stands same-origin)", () => {
    renderDoc((doc) => doc.insertBlock("embed", { kind: "iframe", src: "https://trusted.example/page" }), {
      embedSandbox: (src) =>
        src.startsWith("https://trusted.example") ? "allow-scripts allow-same-origin" : "allow-scripts",
    });
    const iframe = document.querySelector<HTMLIFrameElement>('[data-block-type="embed"] iframe');
    // The trusted origin's policy stands (the consumer consciously grants
    // same-origin for it).
    expect(iframe?.getAttribute("sandbox")).toBe("allow-scripts allow-same-origin");
  });

  it("stands no sandbox when the policy returns null (a fully trusted embed)", () => {
    renderDoc((doc) => doc.insertBlock("embed", { kind: "iframe", src: "https://trusted.example/page" }), {
      embedSandbox: () => null,
    });
    const iframe = document.querySelector<HTMLIFrameElement>('[data-block-type="embed"] iframe');
    expect(iframe?.getAttribute("sandbox")).toBeNull();
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

describe("embed pan/zoom (view state)", () => {
  const EMBED_SELECTOR = 'iframe[data-slot="docblocks/embed"]';
  const TOOLBAR_SELECTOR = '[data-slot="docblocks/embed-toolbar"]';
  const ZOOM_LABEL_SELECTOR = '[data-slot="docblocks/embed-zoom"]';

  function renderEmbed() {
    const doc = renderDoc((d) => d.insertBlock("embed", { kind: "iframe", src: "https://example.com/page" }));
    return doc;
  }

  it("the toolbar stands (zoom in / out / reset) over the iframe, hidden until the hover", () => {
    renderEmbed();

    const toolbar = document.querySelector<HTMLElement>(TOOLBAR_SELECTOR);
    expect(toolbar).not.toBeNull();
    // The hover reveal: the toolbar is in the DOM but display-none until the
    // wrapper's `group-hover` (jsdom does not resolve the hover, so it stands
    // `hidden` = display none).
    expect(toolbar!.className).toContain("hidden");
    expect(toolbar!.querySelector('[data-slot="docblocks/embed-zoom-in"]')).not.toBeNull();
    expect(toolbar!.querySelector('[data-slot="docblocks/embed-zoom-out"]')).not.toBeNull();
    expect(toolbar!.querySelector('[data-slot="docblocks/embed-zoom-reset"]')).not.toBeNull();
    // The percent label stands the identity.
    expect(document.querySelector<HTMLElement>(ZOOM_LABEL_SELECTOR)?.textContent).toBe("100%");
    // The iframe stands the identity transform (the natural size, the top-left
    // origin).
    expect(document.querySelector<HTMLIFrameElement>(EMBED_SELECTOR)?.style.transform).toBe(
      "translate(0px, 0px) scale(1)"
    );
  });

  it("the zoom in / out stand the scale; the reset restores the identity", async () => {
    renderEmbed();
    const iframe = document.querySelector<HTMLIFrameElement>(EMBED_SELECTOR)!;
    const label = document.querySelector<HTMLElement>(ZOOM_LABEL_SELECTOR)!;
    const zoomIn = document.querySelector<HTMLButtonElement>("[data-slot='docblocks/embed-zoom-in']")!;
    const zoomOut = document.querySelector<HTMLButtonElement>("[data-slot='docblocks/embed-zoom-out']")!;
    const reset = document.querySelector<HTMLButtonElement>("[data-slot='docblocks/embed-zoom-reset']")!;

    expect(reset.disabled).toBe(true);
    expect(zoomOut.disabled).toBe(false);

    await act(async () => {
      fireEvent.click(zoomIn);
    });
    expect(iframe.style.transform).toContain("scale(1.2)");
    expect(label.textContent).toBe("120%");
    expect(reset.disabled).toBe(false);

    await act(async () => {
      fireEvent.click(zoomIn);
    });
    expect(label.textContent).toBe("144%");

    await act(async () => {
      fireEvent.click(reset);
    });
    expect(iframe.style.transform).toBe("translate(0px, 0px) scale(1)");
    expect(label.textContent).toBe("100%");
    expect(reset.disabled).toBe(true);

    await act(async () => {
      fireEvent.click(zoomOut);
    });
    expect(label.textContent).toBe("83%");
  });

  it("the zoom is clamped to the range and the no-op press writes nothing", async () => {
    renderEmbed();
    const iframe = document.querySelector<HTMLIFrameElement>(EMBED_SELECTOR)!;
    const zoomIn = document.querySelector<HTMLButtonElement>("[data-slot='docblocks/embed-zoom-in']")!;
    const zoomOut = document.querySelector<HTMLButtonElement>("[data-slot='docblocks/embed-zoom-out']")!;

    // Push past the floor: the scale stands at the min, the press writes nothing
    // (the transform is unchanged by the clamped press).
    for (let i = 0; i < 20; i += 1) {
      await act(async () => {
        fireEvent.click(zoomOut);
      });
    }
    expect(iframe.style.transform).toBe("translate(0px, 0px) scale(0.5)");
    expect(zoomOut.disabled).toBe(true);

    // Push past the ceiling.
    for (let i = 0; i < 40; i += 1) {
      await act(async () => {
        fireEvent.click(zoomIn);
      });
    }
    expect(iframe.style.transform).toBe("translate(0px, 0px) scale(4)");
    expect(zoomIn.disabled).toBe(true);
  });

  it("the pan/zoom is PURE view state: the doc, the wire, and toJSON stay invariant", async () => {
    const doc = renderEmbed();
    const before = JSON.stringify(doc.toJSON());
    const iframe = document.querySelector<HTMLIFrameElement>(EMBED_SELECTOR)!;
    const zoomIn = document.querySelector<HTMLButtonElement>("[data-slot='docblocks/embed-zoom-in']")!;

    await act(async () => {
      fireEvent.click(zoomIn);
    });
    await act(async () => {
      fireEvent.click(zoomIn);
    });

    expect(iframe.style.transform).toContain("scale(1.44)");
    // The doc is untouched: the view state is not document data (one pane's
    // pan/zoom never reaches the wire or the other pane).
    expect(JSON.stringify(doc.toJSON())).toBe(before);
  });
});
