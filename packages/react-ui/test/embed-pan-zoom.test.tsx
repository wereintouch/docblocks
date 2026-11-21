// @vitest-environment jsdom
// The embed's pan/zoom's view state (the toolbar's reveal stand, the zoom's
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

describe("embed pan/zoom (view state)", () => {
  const EMBED_SELECTOR = 'iframe[data-slot="docblocks/embed"]';
  const TOOLBAR_SELECTOR = '[data-slot="docblocks/embed-toolbar"]';
  const ZOOM_LABEL_SELECTOR = '[data-slot="docblocks/embed-zoom"]';

  function renderEmbed() {
    const doc = renderDoc((d) => d.insertBlock("embed", { kind: "iframe", src: "https://example.com/page" }));
    return doc;
  }

  it("the toolbar stands (zoom in / out / reset) over the iframe, the opacity's hidden until the reveal (the hover / the focus-within's)", () => {
    renderEmbed();

    const toolbar = document.querySelector<HTMLElement>(TOOLBAR_SELECTOR);
    expect(toolbar).not.toBeNull();
    // The hover / focus reveal: the toolbar is in the DOM but the opacity-0 +
    // the pointer-events-none until the wrapper's `group-hover` /
    // `group-focus-within` (the opacity's hide — not the display's — so the
    // controls stay in the Tab's path, the keyboard's reachable's stand). jsdom
    // does not resolve the hover / the focus, so it stands the at-rest's stand.
    expect(toolbar!.className).toContain("opacity-0");
    expect(toolbar!.className).toContain("pointer-events-none");
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

  it("the pan/zoom persists over the block's attrs (the debounce's write; the reload's restore)", async () => {
    const doc = renderEmbed();
    const embedId = doc.getChildren(doc.toJSON().id)[0]!;
    const iframe = document.querySelector<HTMLIFrameElement>(EMBED_SELECTOR)!;
    const zoomIn = document.querySelector<HTMLButtonElement>("[data-slot='docblocks/embed-zoom-in']")!;
    const reset = document.querySelector<HTMLButtonElement>("[data-slot='docblocks/embed-zoom-reset']")!;

    // The gesture's bursts stand the view; the doc's write stands the
    // debounce (the burst's middle: nothing yet).
    await act(async () => {
      fireEvent.click(zoomIn);
    });
    await act(async () => {
      fireEvent.click(zoomIn);
    });
    expect(iframe.style.transform).toContain("scale(1.44)");
    expect(doc.getBlock(embedId)).toMatchObject({
      type: "embed",
      attrs: { kind: "iframe", src: "https://example.com/page" },
    });

    // The rest: the debounce lands the view over the block's attrs (the
    // persisted stand — the reload / the new tab's embed stands it; the
    // identity's parts stand the null idiom).
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 320));
    });
    expect(doc.getBlock(embedId)).toMatchObject({
      type: "embed",
      attrs: { kind: "iframe", src: "https://example.com/page", zoom: 1.44, panX: null, panY: null },
    });

    // The reset's stand: the attrs stand the cleared view (the null idiom's
    // restore: null / absent = the identity).
    await act(async () => {
      fireEvent.click(reset);
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 320));
    });
    expect(iframe.style.transform).toBe("translate(0px, 0px) scale(1)");
    expect(doc.getBlock(embedId)).toMatchObject({
      type: "embed",
      attrs: { kind: "iframe", src: "https://example.com/page", zoom: null, panX: null, panY: null },
    });
  });

  it("restores the persisted view over the mount (the reload's stand)", () => {
    // The doc stands the persisted view (the peer's / the reload's attrs):
    // the fresh mount's embed stands it (the view's init over the block's
    // attrs — no flash of the identity).
    const doc = renderDoc((d) => {
      const id = d.insertBlock("embed", { kind: "iframe", src: "https://example.com/page" });
      d.updateBlock(id, { zoom: 2, panX: -10, panY: 5 });
    });
    const iframe = document.querySelector<HTMLIFrameElement>(EMBED_SELECTOR)!;
    expect(iframe.style.transform).toBe("translate(-10px, 5px) scale(2)");
    // The restore stands no re-write (the view equals the block's attrs —
    // the no-op's stand, no wire's update).
    expect(doc.getBlock(doc.getChildren(doc.toJSON().id)[0]!)).toMatchObject({
      attrs: { zoom: 2, panX: -10, panY: 5 },
    });
  });
});
