// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { BlockId } from "docblocks-core";
import { createDoc } from "docblocks-core";

import type { BlockRendererMap } from "../src/blocks";
import { Editor } from "../src/Editor";
import { EditorProvider } from "../src/editor-provider";

const CREATED_AT = "2026-10-10T00:00:00.000Z";
type TestDoc = ReturnType<typeof createDoc>;

/** A fresh doc: the flagged paragraph (the renderer's anomaly) over the neighbors. */
function docWithParagraphs(): { doc: TestDoc; flagged: BlockId } {
  const doc = createDoc({ id: "doc-boundary", createdAt: CREATED_AT });
  const before = doc.insertBlock("paragraph");
  doc.insertText(before, 0, "before");
  const flaggedId = doc.insertBlock("paragraph");
  doc.insertText(flaggedId, 0, "flagged");
  const after = doc.insertBlock("paragraph");
  doc.insertText(after, 0, "after");
  return { doc, flagged: flaggedId };
}

/** A consumer renderer that throws over the block carrying the anomaly's text. */
function throwingParagraphRenderers(): BlockRendererMap {
  return {
    paragraph: ({ id, block }) => {
      const text = "content" in block ? ((block.content ?? []) as Array<{ text: string }>).map((run) => run.text).join("") : "";
      if (text.includes("flag")) throw new Error("the renderer's stand over the anomalous block");
      return <div data-slot="test-renderer" data-block-id={id} />;
    },
  };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/** The boundary's own error logs (the React dev-logging of the captured error stands separate). */
function boundaryErrors(spy: ReturnType<typeof vi.spyOn>): number {
  return spy.mock.calls.filter((args: unknown[]) => String(args[0]).includes("a block renderer threw")).length;
}

describe("the block render error boundary", () => {
  it("contains the renderer's synchronous throw to the block (the editor and the neighbors stand)", () => {
    const { doc } = docWithParagraphs();
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    render(
      <EditorProvider doc={doc} blockRenderers={throwingParagraphRenderers()}>
        <Editor />
      </EditorProvider>
    );

    // The failed block stands the placeholder stand (the type badge over
    // the render-error note).
    const failed = document.querySelector('[data-slot="docblocks/render-error"]');
    expect(failed).not.toBeNull();
    expect(failed?.getAttribute("data-block-type")).toBe("paragraph");
    expect(failed?.textContent).toContain("Could not be rendered");
    // The editor stands (the throw did not unmount the root).
    expect(document.querySelector('[data-slot="docblocks/editor"]')).not.toBeNull();
    // The neighbors render through the same renderer (the non-anomalous
    // blocks stand intact).
    const rendered = document.querySelectorAll('[data-slot="test-renderer"]').length;
    expect(rendered).toBe(2);
    expect(boundaryErrors(errorSpy)).toBe(1);
  });

  it("retries the render over the data change (the peer's fix over the failed state)", async () => {
    const { doc, flagged } = docWithParagraphs();
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    render(
      <EditorProvider doc={doc} blockRenderers={throwingParagraphRenderers()}>
        <Editor />
      </EditorProvider>
    );
    expect(document.querySelector('[data-slot="docblocks/render-error"]')).not.toBeNull();

    // The peer's fix: the anomaly's text is removed (the data identity
    // changes over the failed state — the boundary resets and retries).
    act(() => {
      doc.deleteText(flagged, 0, 4);
    });
    expect(document.querySelector('[data-slot="docblocks/render-error"]')).toBeNull();
    expect(document.querySelectorAll('[data-slot="test-renderer"]').length).toBe(3);
    expect(boundaryErrors(errorSpy)).toBe(1); // the retry rendered clean
  });

  it("re-throws and re-stands the placeholder when the data is still anomalous", async () => {
    const { doc, flagged } = docWithParagraphs();
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    render(
      <EditorProvider doc={doc} blockRenderers={throwingParagraphRenderers()}>
        <Editor />
      </EditorProvider>
    );
    expect(document.querySelector('[data-slot="docblocks/render-error"]')).not.toBeNull();

    // A change that keeps the anomaly (the data identity changes, the
    // render still throws): the boundary retries and stands the placeholder
    // again.
    act(() => {
      doc.insertText(flagged, 7, "x");
    });
    expect(document.querySelector('[data-slot="docblocks/render-error"]')).not.toBeNull();
    expect(boundaryErrors(errorSpy)).toBe(2);
  });
});
