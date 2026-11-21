// @vitest-environment jsdom
// The viewport's geometry's re-clamp (the async svg's stand): the settled
// geometry's centering over the observer's notification.
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { act } from "react";

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
