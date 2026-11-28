// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
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
        `[data-slot="docblocks/block"][data-block-type="embed"][data-block-id="${id}"]:not([data-slot="docblocks/row"])`
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
