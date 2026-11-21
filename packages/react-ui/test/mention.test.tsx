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
      doc.setMark(id, 6, 10, { type: "mention", kind: "user", id: "u1" });
    });
    const chip = document.querySelector<HTMLElement>('[data-slot="docblocks/mention"]');
    expect(chip).not.toBeNull();
    expect(chip!.getAttribute("data-mention-kind")).toBe("user");
    expect(chip!.getAttribute("data-mention-id")).toBe("u1");
    expect(chip!.textContent).toBe("Jane");
    expect(chip!.getAttribute("contenteditable")).toBe("false");
  });

  it("the doc kind stands its own attr", () => {
    renderDoc((doc) => {
      const id = doc.insertBlock("paragraph");
      doc.insertText(id, 0, "Spec");
      doc.setMark(id, 0, 4, { type: "mention", kind: "doc", id: "d9" });
    });
    const chip = document.querySelector<HTMLElement>('[data-slot="docblocks/mention"]');
    expect(chip).not.toBeNull();
    expect(chip!.getAttribute("data-mention-kind")).toBe("doc");
    expect(chip!.getAttribute("data-mention-id")).toBe("d9");
    expect(chip!.textContent).toBe("Spec");
  });

  it("the chip stands the kind's inline icon (aria-hidden, the lucide's geometry, no text of its own)", () => {
    renderDoc((doc) => {
      const id = doc.insertBlock("paragraph");
      doc.insertText(id, 0, "Jane and Spec");
      doc.setMark(id, 0, 4, { type: "mention", kind: "user", id: "u1" });
      doc.setMark(id, 9, 13, { type: "mention", kind: "doc", id: "d9" });
    });
    const chips = [...document.querySelectorAll<HTMLElement>('[data-slot="docblocks/mention"]')];
    expect(chips.length).toBe(2);
    const [userChip, docChip] = chips as [HTMLElement, HTMLElement];
    // The icon: the kind's lucide's geometry (the user's head circle /
    // the doc's exit arrow), decorative, and the label stays the only
    // text of the chip.
    const userIcon = userChip.querySelector("svg");
    expect(userIcon).not.toBeNull();
    expect(userIcon!.getAttribute("aria-hidden")).toBe("true");
    const userHead = userIcon!.querySelector("circle");
    expect(userHead).not.toBeNull();
    expect(userHead!.getAttribute("cx")).toBe("12");
    expect(userHead!.getAttribute("r")).toBe("4");
    expect(userChip.textContent).toBe("Jane");
    const docPaths = docChip.querySelectorAll("svg path");
    expect(docPaths.length).toBe(3);
    expect(docPaths[1]?.getAttribute("d")).toBe("m21 3-9 9");
    expect(docChip.textContent).toBe("Spec");
  });

  it("a run without a mention keeps its plain text (no chip)", () => {
    renderDoc((doc) => {
      const id = doc.insertBlock("paragraph");
      doc.insertText(id, 0, "plain text");
    });
    expect(document.querySelector('[data-slot="docblocks/mention"]')).toBeNull();
  });

  it("the chip's label stands the resolver's live label over the target's id (the rename's stand)", () => {
    const provider: MentionProvider = {
      searchUsers: vi.fn().mockResolvedValue([]),
      searchDocs: vi.fn().mockResolvedValue([]),
      // The live label stands the renamed stand (the run's text is the
      // insertion-time label — `Jane` over the renamed `Jane Doe`).
      resolveLabel: vi.fn((kind: string, id: string) => (kind === "user" && id === "u1" ? "Jane Doe" : null)),
    };
    renderDoc((doc) => {
      const id = doc.insertBlock("paragraph");
      doc.insertText(id, 0, "Hello ");
      doc.insertText(id, 6, "Jane");
      doc.setMark(id, 6, 10, { type: "mention", kind: "user", id: "u1" });
    }, provider);
    const chip = document.querySelector<HTMLElement>('[data-slot="docblocks/mention"]');
    expect(chip).not.toBeNull();
    expect(chip!.textContent).toBe("Jane Doe");
  });

  it("the resolver's null / the absent provider stand the insertion-time label (the run's text)", () => {
    const provider: MentionProvider = {
      searchUsers: vi.fn().mockResolvedValue([]),
      searchDocs: vi.fn().mockResolvedValue([]),
      resolveLabel: vi.fn().mockReturnValue(null),
    };
    renderDoc((doc) => {
      const id = doc.insertBlock("paragraph");
      doc.insertText(id, 0, "Jane");
      doc.setMark(id, 0, 4, { type: "mention", kind: "user", id: "u1" });
    }, provider);
    const chip = document.querySelector<HTMLElement>('[data-slot="docblocks/mention"]');
    expect(chip!.textContent).toBe("Jane");
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
  it("the query over the @ phrase (the space is part of the query)", () => {
    expect(deriveMention("Hello @Ja", 6, 9)).toEqual({ closed: false, query: "Ja", queryEnd: 9 });
    expect(deriveMention("Hello @", 6, 7)).toEqual({ closed: false, query: "", queryEnd: 7 });
    // The space stands the query (the whole phrase is searched — the
    // `my doc`'s query, not the `my`'s).
    expect(deriveMention("Hello @my doc", 6, 13)).toEqual({ closed: false, query: "my doc", queryEnd: 13 });
    // The caret past the phrase's start: the query runs over the caret
    // (the phrase is the `@` to the caret's stand).
    expect(deriveMention("Hello @Jane more", 6, 16)).toEqual({
      closed: false,
      query: "Jane more",
      queryEnd: 16,
    });
    // No `@` at the anchor: closed.
    expect(deriveMention("Hello Jane", 6, 9)).toEqual({ closed: true, query: "", queryEnd: 0 });
    // The caret at / before the `@`: closed (the phrase's window is empty).
    expect(deriveMention("Hello @Jane", 6, 6)).toEqual({ closed: true, query: "", queryEnd: 0 });
    expect(deriveMention("Hello @Jane", 6, 3)).toEqual({ closed: true, query: "", queryEnd: 0 });
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
