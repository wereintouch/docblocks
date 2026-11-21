// @vitest-environment jsdom
// The editor's top-level render boundary: a throw outside a block's
// renderer (the attributes panel's consumer zone here) is contained to the
// editor's content — the consumer's application stays mounted, the failure
// note stands a retry, and the consumer's own fallback / reset key hold.
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createDoc } from "docblocks-core";

import { Editor } from "../src/Editor";
import { EditorErrorBoundary } from "../src/EditorErrorBoundary";
import { EditorProvider } from "../src/editor-provider";

const CREATED_AT = "2026-10-10T00:00:00.000Z";

/** The throwing stand: a component that fails while the flag stands. */
function Boom({ failing }: { failing: () => boolean }) {
  if (failing()) throw new Error("the chrome's throw");
  return <span data-testid="rendered">rendered</span>;
}

beforeEach(() => {
  // The boundary reports the throw to the console — the test asserts the
  // UI stand, not the log's noise.
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("EditorErrorBoundary", () => {
  it("stands the failure note over a throw and the retry re-renders the content", () => {
    let failing = true;
    const child = () => <Boom failing={() => failing} />;
    const { rerender } = render(<EditorErrorBoundary>{child()}</EditorErrorBoundary>);
    const note = document.querySelector<HTMLElement>('[data-slot="docblocks/editor-error"]');
    expect(note).not.toBeNull();
    expect(note!.getAttribute("role")).toBe("alert");
    expect(document.querySelector("[data-testid='rendered']")).toBeNull();

    failing = false;
    fireEvent.click(document.querySelector<HTMLElement>("[data-slot='docblocks/editor-error-retry']")!);
    expect(document.querySelector("[data-testid='rendered']")).not.toBeNull();
    expect(document.querySelector("[data-slot='docblocks/editor-error']")).toBeNull();
    rerender(<EditorErrorBoundary>{child()}</EditorErrorBoundary>);
  });

  it("a reset key change re-renders the failed content", () => {
    let failing = true;
    const { rerender } = render(
      <EditorErrorBoundary resetKey={0}>
        <Boom failing={() => failing} />
      </EditorErrorBoundary>
    );
    expect(document.querySelector("[data-slot='docblocks/editor-error']")).not.toBeNull();
    failing = false;
    // The same key stands the note (no implicit retry).
    rerender(
      <EditorErrorBoundary resetKey={0}>
        <Boom failing={() => failing} />
      </EditorErrorBoundary>
    );
    expect(document.querySelector("[data-slot='docblocks/editor-error']")).not.toBeNull();
    rerender(
      <EditorErrorBoundary resetKey={1}>
        <Boom failing={() => failing} />
      </EditorErrorBoundary>
    );
    expect(document.querySelector("[data-testid='rendered']")).not.toBeNull();
  });

  it("the consumer's fallback receives the error and the retry", () => {
    let failing = true;
    const fallback = vi.fn(({ error, retry }: { error: unknown; retry: () => void }) => (
      <button data-testid="consumer-fallback" onClick={retry}>
        {error instanceof Error ? error.message : "failed"}
      </button>
    ));
    render(
      <EditorErrorBoundary fallback={fallback}>
        <Boom failing={() => failing} />
      </EditorErrorBoundary>
    );
    const node = document.querySelector<HTMLElement>("[data-testid='consumer-fallback']");
    expect(node?.textContent).toBe("the chrome's throw");
    failing = false;
    fireEvent.click(node!);
    expect(document.querySelector("[data-testid='rendered']")).not.toBeNull();
  });
});

describe("the editor's top-level boundary", () => {
  it("a consumer attribute zone's throw stands the editor's note over the mounted application", () => {
    const doc = createDoc({ id: "doc-1", title: "T", createdAt: CREATED_AT });
    doc.setAttribute("owner", { id: "u1" });
    render(
      <div data-testid="consumer-root">
        <EditorProvider
          doc={doc}
          renderAttribute={() => {
            throw new Error("the consumer zone's throw");
          }}
        >
          <Editor />
        </EditorProvider>
      </div>
    );
    expect(document.querySelector("[data-slot='docblocks/attributes-toggle']")).not.toBeNull();

    // The panel's expansion renders the consumer's zone → the throw: the
    // editor's content stands the failure note, the consumer's root holds.
    act(() => {
      fireEvent.click(document.querySelector<HTMLElement>("[data-slot='docblocks/attributes-toggle']")!);
    });
    expect(document.querySelector("[data-slot='docblocks/editor-error']")).not.toBeNull();
    expect(document.querySelector("[data-testid='consumer-root']")).not.toBeNull();

    // The retry re-renders the content (the panel collapses on the fresh
    // mount — the failing zone stands unrendered).
    act(() => {
      fireEvent.click(document.querySelector<HTMLElement>("[data-slot='docblocks/editor-error-retry']")!);
    });
    expect(document.querySelector("[data-slot='docblocks/editor-error']")).toBeNull();
    expect(document.querySelector("[data-slot='docblocks/attributes-toggle']")).not.toBeNull();
  });
});
