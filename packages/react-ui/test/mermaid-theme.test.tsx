// @vitest-environment jsdom
// The mermaid renderer's editor-theme follow: the dark class
// stands the dark theme, the flip re-stands the default.
import { cleanup, render, waitFor } from "@testing-library/react";
import mermaid from "mermaid";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createDoc } from "docblocks-core";

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

describe("the editor-theme follow", () => {
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
