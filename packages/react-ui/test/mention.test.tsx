// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createDoc } from "docblocks-core";
import type { TextRun } from "docblocks-core";

import { Editor } from "../src/Editor";
import { segmentOf } from "../src/editing/cross-copy";
import { deriveMention } from "../src/editing/mention";
import { EditorProvider, useEditorContext } from "../src/editor-provider";
import type { MentionProvider } from "../src/editor-provider";

const CREATED_AT = "2026-10-10T00:00:00.000Z";
type TestDoc = ReturnType<typeof createDoc>;

let capturedProvider: MentionProvider | null = null;
function ContextCapture() {
  capturedProvider = useEditorContext().mentionProvider;
  return null;
}

function renderDoc(prepare: (doc: TestDoc) => void, mentionProvider?: MentionProvider) {
  const doc = createDoc({ id: "doc-1", createdAt: CREATED_AT });
  prepare(doc);
  render(
    <EditorProvider doc={doc} mentionProvider={mentionProvider}>
      <Editor />
      <ContextCapture />
    </EditorProvider>
  );
  return doc;
}

afterEach(() => {
  cleanup();
  capturedProvider = null;
});

describe("the mention chip render", () => {
  it("renders the chip (the label display, the kind attr, atomic)", () => {
    renderDoc((doc) => {
      const id = doc.insertBlock("paragraph");
      doc.insertText(id, 0, "Hello ");
      doc.insertText(id, 6, "Jane");
      doc.setMark(id, 6, 10, { type: "mention", kind: "user", id: "u1", label: "Jane" });
    });
    const chip = document.querySelector<HTMLElement>('[data-slot="docblocks/mention"]');
    expect(chip).not.toBeNull();
    expect(chip!.getAttribute("data-mention-kind")).toBe("user");
    expect(chip!.textContent).toBe("Jane");
    expect(chip!.getAttribute("contenteditable")).toBe("false");
  });

  it("the doc kind stands its own attr", () => {
    renderDoc((doc) => {
      const id = doc.insertBlock("paragraph");
      doc.insertText(id, 0, "Spec");
      doc.setMark(id, 0, 4, { type: "mention", kind: "doc", id: "d9", label: "Spec" });
    });
    const chip = document.querySelector<HTMLElement>('[data-slot="docblocks/mention"]');
    expect(chip).not.toBeNull();
    expect(chip!.getAttribute("data-mention-kind")).toBe("doc");
    expect(chip!.textContent).toBe("Spec");
  });

  it("a run without a mention keeps its plain text (no chip)", () => {
    renderDoc((doc) => {
      const id = doc.insertBlock("paragraph");
      doc.insertText(id, 0, "plain text");
    });
    expect(document.querySelector('[data-slot="docblocks/mention"]')).toBeNull();
  });
});

describe("the mentionProvider context", () => {
  it("exposes the provider (and null when none)", () => {
    const provider: MentionProvider = {
      searchUsers: vi.fn().mockResolvedValue([]),
      searchDocs: vi.fn().mockResolvedValue([]),
    };
    renderDoc(() => {}, provider);
    expect(capturedProvider).toBe(provider);

    cleanup();
    capturedProvider = null;
    renderDoc(() => {});
    expect(capturedProvider).toBeNull();
  });
});

describe("deriveMention", () => {
  it("the query over the @ phrase", () => {
    expect(deriveMention("Hello @Ja", 6, 9)).toEqual({ closed: false, query: "Ja", queryEnd: 9 });
    expect(deriveMention("Hello @", 6, 7)).toEqual({ closed: false, query: "", queryEnd: 7 });
    // No `@` at the anchor: closed.
    expect(deriveMention("Hello Jane", 6, 9)).toEqual({ closed: true, query: "", queryEnd: 0 });
    // The caret out of the query window (past a boundary): closed (the query
    // is derived but the picker closes).
    expect(deriveMention("Hello @Jane more", 6, 16)).toEqual({ closed: true, query: "Jane", queryEnd: 11 });
  });
});

describe("the mention clipboard form", () => {
  it("copies as @label plain text (the html carries the mention span)", () => {
    const runs: TextRun[] = [
      { text: "Hello ", marks: {} },
      { text: "Jane", marks: { mention: { kind: "user", id: "u1", label: "Jane" } } },
      { text: " and hi", marks: {} },
    ];
    const segment = segmentOf(runs, 0, 17);
    expect(segment.text).toBe("Hello @Jane and hi");
    expect(segment.html).toContain('data-mention="user"');
    expect(segment.html).toContain("Jane");
  });

  it("a run without a mention keeps its raw text", () => {
    const runs: TextRun[] = [{ text: "Hello Jane", marks: {} }];
    expect(segmentOf(runs, 0, 10).text).toBe("Hello Jane");
  });
});
