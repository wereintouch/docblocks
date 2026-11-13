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

  it("keeps the embed src as a URL, not a blob id", () => {
    renderDoc((doc) => doc.insertBlock("embed", { kind: "iframe", src: "https://example.com/page" }));

    const iframe = document.querySelector<HTMLIFrameElement>('[data-block-type="embed"] iframe');
    expect(iframe?.getAttribute("src")).toBe("https://example.com/page");
  });

  it("stands the default sandbox over the iframe (the same-origin grant — the real-app's own storage stands)", () => {
    renderDoc((doc) => doc.insertBlock("embed", { kind: "iframe", src: "https://example.com/page" }));
    const iframe = document.querySelector<HTMLIFrameElement>('[data-block-type="embed"] iframe');
    // The default grants the same-origin: the embedded app runs with its own
    // origin's storage / cookies (the real-app's boot requirement), scripts /
    // forms / popups stand. The frame's document stands a separate document —
    // a cross-origin embed cannot reach the parent's DOM or state.
    expect(iframe?.getAttribute("sandbox")).toBe(DEFAULT_EMBED_SANDBOX);
    expect(iframe?.getAttribute("sandbox")).toContain("allow-same-origin");
  });

  it("applies the consumer's embedSandbox policy (the restriction's stand — the opaque origin over the untrusted)", () => {
    renderDoc((doc) => doc.insertBlock("embed", { kind: "iframe", src: "https://example.com/page" }), {
      embedSandbox: () => "allow-scripts",
    });
    const iframe = document.querySelector<HTMLIFrameElement>('[data-block-type="embed"] iframe');
    // The consumer's policy stands the opaque-origin's posture (the
    // allow-same-origin's refuse — the untrusted embed's restriction).
    expect(iframe?.getAttribute("sandbox")).toBe("allow-scripts");
    expect(iframe?.getAttribute("sandbox")).not.toContain("allow-same-origin");
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

  it("stands the unsafe src over the placeholder (the renderer's gate — the iframe stands no mount)", () => {
    renderDoc((doc) => doc.insertBlock("embed", { kind: "iframe", src: "https://example.com/seed" }));
    const store = context!.store;
    const state = store.getState();
    // The legacy / the remote crafted data (the write posture rejects it at
    // the command / the validator's strict stand) stands the same raw-data
    // path: the store's snapshot injection.
    const unsafe: Block = {
      type: "embed",
      attrs: { kind: "iframe", src: "javascript:alert(1)" },
    } as unknown as Block;
    const dataHtml: Block = {
      type: "embed",
      attrs: { kind: "iframe", src: "data:text/html,<script>alert(1)</script>" },
    } as unknown as Block;

    act(() => {
      store.setState({
        blocks: { ...state.blocks, "embed-unsafe": unsafe, "embed-unsafe-data": dataHtml },
        rootChildren: [...state.rootChildren, "embed-unsafe", "embed-unsafe-data"],
      });
    });

    // Both the crafted blocks stand the placeholder, the iframe stands no
    // mount (the `javascript:` / the foreign `data:` would stand the XSS
    // over the consumer's sandbox grant / the phishing surface); the safe
    // seed stands its iframe (the control).
    for (const id of ["embed-unsafe", "embed-unsafe-data"]) {
      const wrapper = document.querySelector<HTMLElement>(
        `[data-slot="docblocks/block"][data-block-type="embed"][data-block-id="${id}"]`
      );
      expect(wrapper).not.toBeNull();
      expect(wrapper!.querySelector('iframe[data-slot="docblocks/embed"]')).toBeNull();
      expect(wrapper!.querySelector('[data-slot="docblocks/embed-blocked"]')).not.toBeNull();
    }
    expect(document.querySelectorAll('iframe[data-slot="docblocks/embed"]').length).toBe(1);
    expect(document.querySelector('iframe[data-slot="docblocks/embed"]')?.getAttribute("src")).toBe(
      "https://example.com/seed"
    );
  });

  it("stands the html kind's data:text/html snippet (the kind's purpose — the iframe stands)", () => {
    renderDoc((doc) => doc.insertBlock("embed", { kind: "html", src: "data:text/html,<h1>hi</h1>" }));
    const iframe = document.querySelector<HTMLIFrameElement>('[data-kind="html"] iframe[data-slot="docblocks/embed"]');
    expect(iframe).not.toBeNull();
    expect(iframe!.getAttribute("src")).toBe("data:text/html,<h1>hi</h1>");
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

describe("embed height (the stretched stand)", () => {
  const HANDLE_SELECTOR = "[data-slot='docblocks/embed-resize']";
  const WRAPPER_SELECTOR = '[data-block-type="embed"]';
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

describe("embed url edit (the toolbar's edit affordance)", () => {
  const EDIT_BUTTON_SELECTOR = '[data-slot="docblocks/embed-edit-url"]';
  const PANEL_SELECTOR = '[data-slot="docblocks/embed-edit"]';
  const INPUT_SELECTOR = "[data-slot='docblocks/embed-edit-input']";
  const SAVE_SELECTOR = "[data-slot='docblocks/embed-edit-save']";
  const CANCEL_SELECTOR = "[data-slot='docblocks/embed-edit-cancel']";
  const HINT_SELECTOR = "[data-slot='docblocks/embed-edit-hint']";
  const SRC = "https://example.com/page";

  function renderEmbed() {
    const doc = renderDoc((d) => d.insertBlock("embed", { kind: "iframe", src: SRC }));
    return { doc, embedId: doc.getChildren(doc.toJSON().id)[0]! };
  }

  it("the edit button stands over the edit mode (the editing surface); absent over the view mode", () => {
    renderDoc((d) => d.insertBlock("embed", { kind: "iframe", src: SRC }));
    const button = document.querySelector(EDIT_BUTTON_SELECTOR);
    expect(button).not.toBeNull();
    expect(button!.getAttribute("aria-label")).toBe("Edit URL");
    // The panel stands closed until the button's click.
    expect(document.querySelector(PANEL_SELECTOR)).toBeNull();

    cleanup();
    renderDoc((d) => d.insertBlock("embed", { kind: "iframe", src: SRC }), { mode: "view" });
    expect(document.querySelector(EDIT_BUTTON_SELECTOR)).toBeNull();
    expect(document.querySelector(PANEL_SELECTOR)).toBeNull();
  });

  it("the edit's open pre-fills the input with the current src (the focus's stand)", async () => {
    renderEmbed();
    const button = document.querySelector<HTMLButtonElement>(EDIT_BUTTON_SELECTOR)!;

    await act(async () => {
      fireEvent.click(button);
    });
    const input = document.querySelector<HTMLInputElement>(INPUT_SELECTOR);
    expect(input).not.toBeNull();
    expect(input!.value).toBe(SRC);
    // The keyboard's flow: the input's focused when the panel stands.
    expect(input).toBe(document.activeElement);
  });

  it("the commit's Enter writes the new src (the iframe's navigation, the panel's close)", async () => {
    const { doc, embedId } = renderEmbed();
    const button = document.querySelector<HTMLButtonElement>(EDIT_BUTTON_SELECTOR)!;

    await act(async () => {
      fireEvent.click(button);
    });
    const input = document.querySelector<HTMLInputElement>(INPUT_SELECTOR)!;
    await act(async () => {
      fireEvent.change(input, { target: { value: "https://other.example/app" } });
      fireEvent.keyDown(input, { key: "Enter" });
    });
    // The doc's write: the `src`'s new value, the kind's untouched.
    expect(doc.getBlock(embedId)).toMatchObject({ attrs: { kind: "iframe", src: "https://other.example/app" } });
    // The iframe's navigation: the new src over the attr.
    const iframe = document.querySelector<HTMLIFrameElement>("[data-slot='docblocks/embed']");
    expect(iframe?.getAttribute("src")).toBe("https://other.example/app");
    // The panel's closed over the commit.
    expect(document.querySelector(PANEL_SELECTOR)).toBeNull();
  });

  it("the Escape's cancel closes the panel (the src's untouched)", async () => {
    const { doc, embedId } = renderEmbed();
    await act(async () => {
      fireEvent.click(document.querySelector<HTMLButtonElement>(EDIT_BUTTON_SELECTOR)!);
    });
    const input = document.querySelector<HTMLInputElement>(INPUT_SELECTOR)!;
    await act(async () => {
      fireEvent.change(input, { target: { value: "https://other.example/app" } });
      fireEvent.keyDown(input, { key: "Escape" });
    });
    expect(document.querySelector(PANEL_SELECTOR)).toBeNull();
    expect(doc.getBlock(embedId)).toMatchObject({ attrs: { src: SRC } });
  });

  it("the cancel's button closes the panel (the src's untouched)", async () => {
    const { doc, embedId } = renderEmbed();
    await act(async () => {
      fireEvent.click(document.querySelector<HTMLButtonElement>(EDIT_BUTTON_SELECTOR)!);
    });
    await act(async () => {
      fireEvent.click(document.querySelector<HTMLButtonElement>(CANCEL_SELECTOR)!);
    });
    expect(document.querySelector(PANEL_SELECTOR)).toBeNull();
    expect(doc.getBlock(embedId)).toMatchObject({ attrs: { src: SRC } });
  });

  it("the unsafe's draft stands the hint + the save's no-commit (the slash form's rule)", async () => {
    const { doc, embedId } = renderEmbed();
    await act(async () => {
      fireEvent.click(document.querySelector<HTMLButtonElement>(EDIT_BUTTON_SELECTOR)!);
    });
    const input = document.querySelector<HTMLInputElement>(INPUT_SELECTOR)!;
    await act(async () => {
      fireEvent.change(input, { target: { value: "javascript:alert(1)" } });
    });
    // The hint's stand over the unsafe's scheme, the save's disabled.
    expect(document.querySelector(HINT_SELECTOR)).not.toBeNull();
    expect(document.querySelector<HTMLButtonElement>(SAVE_SELECTOR)!.disabled).toBe(true);
    await act(async () => {
      fireEvent.keyDown(document.querySelector<HTMLInputElement>(INPUT_SELECTOR)!, { key: "Enter" });
    });
    // The no-commit: the src's untouched, the panel's open (the fix's chance).
    expect(doc.getBlock(embedId)).toMatchObject({ attrs: { src: SRC } });
    expect(document.querySelector(PANEL_SELECTOR)).not.toBeNull();
  });

  it("the empty's draft stands the save's disabled (the no-commit)", async () => {
    const { doc, embedId } = renderEmbed();
    await act(async () => {
      fireEvent.click(document.querySelector<HTMLButtonElement>(EDIT_BUTTON_SELECTOR)!);
    });
    const input = document.querySelector<HTMLInputElement>(INPUT_SELECTOR)!;
    await act(async () => {
      fireEvent.change(input, { target: { value: "   " } });
    });
    expect(document.querySelector<HTMLButtonElement>(SAVE_SELECTOR)!.disabled).toBe(true);
    await act(async () => {
      fireEvent.keyDown(document.querySelector<HTMLInputElement>(INPUT_SELECTOR)!, { key: "Enter" });
    });
    expect(doc.getBlock(embedId)).toMatchObject({ attrs: { src: SRC } });
  });

  it("the unchanged's draft writes nothing (the no-op's stand)", async () => {
    const { doc, embedId } = renderEmbed();
    await act(async () => {
      fireEvent.click(document.querySelector<HTMLButtonElement>(EDIT_BUTTON_SELECTOR)!);
    });
    const input = document.querySelector<HTMLInputElement>(INPUT_SELECTOR)!;
    await act(async () => {
      // Trim the pre-fill: the whitespace's trim lands the unchanged's src.
      fireEvent.change(input, { target: { value: `${SRC}  ` } });
      fireEvent.click(document.querySelector<HTMLButtonElement>(SAVE_SELECTOR)!);
    });
    expect(document.querySelector(PANEL_SELECTOR)).toBeNull();
    expect(doc.getBlock(embedId)).toMatchObject({ attrs: { src: SRC } });
  });
});
