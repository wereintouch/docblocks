// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { act } from "react";

import { createDoc } from "docblocks-core";
import type { TextRun } from "docblocks-core";

import { Editor } from "../src/Editor";
import { segmentOf } from "../src/editing/cross-copy";
import { MentionPicker, deriveMention } from "../src/editing/mention";
import { EditorProvider, useEditorContext } from "../src/editor-provider";
import type { MentionEntry, MentionProvider } from "../src/editor-provider";

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

describe("the mention picker's search stand (the failure vs. the empty)", () => {
  // A bare ref (the picker reads `rootRef.current` only; jsdom has no
  // layout, so the anchor stand stays at the `opacity-0` first frame and the
  // content still renders, which is what these assertions read).
  const rootRef = { current: null as HTMLElement | null };

  // Seed one page paragraph carrying the `@` phrase (`@` at offset 6) and
  // stand the picker over it. The live caret falls back to `atOffset + 1`, so
  // the query is empty and the search stands for the (empty) query.
  function renderPicker(provider: MentionProvider) {
    const doc = createDoc({ id: "doc-1", createdAt: CREATED_AT });
    const blockId = doc.insertBlock("paragraph");
    doc.insertText(blockId, 0, "Hello @");
    const utils = render(
      <EditorProvider doc={doc} mentionProvider={provider}>
        <MentionPicker
          rootRef={rootRef}
          state={{ blockId, parentId: "root", atOffset: 6, active: 0 }}
          provider={provider}
          active={0}
          onItemsChange={() => {}}
          onHover={() => {}}
          onPick={() => {}}
          onClose={() => {}}
        />
      </EditorProvider>
    );
    return { doc, ...utils };
  }

  it("stands the error stand (not the empty) over a refused search", async () => {
    const provider: MentionProvider = {
      searchUsers: vi.fn(async (): Promise<MentionEntry[]> => {
        throw new Error("users boom");
      }),
      searchDocs: vi.fn(async (): Promise<MentionEntry[]> => []),
    };
    renderPicker(provider);

    // The failed section stands the error note (with the retry), not the
    // "No matches" empty stand — a failure is distinct from a correct empty.
    await screen.findByText(/Couldn't load mention results/);
    expect(document.querySelector("[data-slot='docblocks/mention-error']")).not.toBeNull();
    expect(document.querySelector("[data-slot='docblocks/mention-retry']")).not.toBeNull();
    expect(document.querySelector("[data-slot='docblocks/mention-empty']")).toBeNull();
  });

  it("stands the succeeded section over a partial failure (the error stand stands the failed part)", async () => {
    const provider: MentionProvider = {
      searchUsers: vi.fn(async (): Promise<MentionEntry[]> => {
        throw new Error("users boom");
      }),
      searchDocs: vi.fn(async (): Promise<MentionEntry[]> => [{ id: "d1", label: "Spec" }]),
    };
    renderPicker(provider);

    // The docs section stands its entries; the failed users section stands
    // the error note (not an empty users section, not the "No matches").
    await screen.findByText("Spec");
    expect(document.querySelector("[data-slot='docblocks/mention-docs']")).not.toBeNull();
    expect(document.querySelector("[data-slot='docblocks/mention-users']")).toBeNull();
    expect(document.querySelector("[data-slot='docblocks/mention-error']")).not.toBeNull();
    expect(document.querySelector("[data-slot='docblocks/mention-empty']")).toBeNull();
  });

  it("the retry re-runs the search (a recovered provider stands the result and clears the error)", async () => {
    let fail = true;
    const provider: MentionProvider = {
      searchUsers: vi.fn(async (): Promise<MentionEntry[]> => {
        if (fail) throw new Error("boom");
        return [{ id: "u1", label: "Jane" }];
      }),
      searchDocs: vi.fn(async (): Promise<MentionEntry[]> => []),
    };
    renderPicker(provider);

    await screen.findByText(/Couldn't load mention results/);
    const retry = document.querySelector<HTMLButtonElement>("[data-slot='docblocks/mention-retry']");
    expect(retry).not.toBeNull();

    fail = false;
    fireEvent.click(retry!);
    // The retry re-runs the search; the recovered provider stands the user
    // and the error stand clears.
    await screen.findByText("Jane");
    expect(document.querySelector("[data-slot='docblocks/mention-users']")).not.toBeNull();
    expect(document.querySelector("[data-slot='docblocks/mention-error']")).toBeNull();
  });

  it("the correct empty stands the empty stand (not the error)", async () => {
    const provider: MentionProvider = {
      searchUsers: vi.fn(async (): Promise<MentionEntry[]> => []),
      searchDocs: vi.fn(async (): Promise<MentionEntry[]> => []),
    };
    renderPicker(provider);

    // A correct empty (both sections resolve empty) stands "No matches",
    // not the error stand.
    await screen.findByText("No matches");
    expect(document.querySelector("[data-slot='docblocks/mention-empty']")).not.toBeNull();
    expect(document.querySelector("[data-slot='docblocks/mention-error']")).toBeNull();
  });

  it("the consumer's renderEmptyState stands the picker's empty (the built-in's stand without it)", async () => {
    const provider: MentionProvider = {
      searchUsers: vi.fn(async (): Promise<MentionEntry[]> => []),
      searchDocs: vi.fn(async (): Promise<MentionEntry[]> => []),
    };
    const doc = createDoc({ id: "doc-1", createdAt: CREATED_AT });
    const blockId = doc.insertBlock("paragraph");
    doc.insertText(blockId, 0, "Hello @");
    render(
      <EditorProvider
        doc={doc}
        mentionProvider={provider}
        mentionInteractions={{
          renderCard: () => null,
          renderEmptyState: (query: string) => (
            <span data-slot="test-empty">start typing: {JSON.stringify(query)}</span>
          ),
        }}
      >
        <MentionPicker
          rootRef={{ current: null as HTMLElement | null }}
          state={{ blockId, parentId: "root", atOffset: 6, active: 0 }}
          provider={provider}
          active={0}
          onItemsChange={() => {}}
          onHover={() => {}}
          onPick={() => {}}
          onClose={() => {}}
        />
      </EditorProvider>
    );
    // The consumer's content stands (the blank query over the `@` only),
    // not the built-in's "No matches".
    await screen.findByText('start typing: ""');
    expect(document.querySelector("[data-slot='docblocks/mention-empty']")).not.toBeNull();
    expect(screen.queryByText("No matches")).toBeNull();

    // The consumer's `null` stands the built-in's stand (the default).
    cleanup();
    render(
      <EditorProvider
        doc={doc}
        mentionProvider={provider}
        mentionInteractions={{
          renderCard: () => null,
          renderEmptyState: () => null,
        }}
      >
        <MentionPicker
          rootRef={{ current: null as HTMLElement | null }}
          state={{ blockId, parentId: "root", atOffset: 6, active: 0 }}
          provider={provider}
          active={0}
          onItemsChange={() => {}}
          onHover={() => {}}
          onPick={() => {}}
          onClose={() => {}}
        />
      </EditorProvider>
    );
    await screen.findByText("No matches");
  });

  it("a search that resolves after the picker closes stands no stale result", async () => {
    let resolveUsers: (value: MentionEntry[]) => void = () => {};
    const provider: MentionProvider = {
      searchUsers: vi.fn(
        (): Promise<MentionEntry[]> =>
          new Promise((resolve) => {
            resolveUsers = resolve;
          })
      ),
      searchDocs: vi.fn(async (): Promise<MentionEntry[]> => []),
    };
    const { unmount } = renderPicker(provider);

    // The search is in flight (the provider was called) before the picker
    // closes (unmounts) while the request is pending.
    await vi.waitFor(() => expect(provider.searchUsers).toHaveBeenCalled());
    unmount();

    // The late resolution must not stand a stale result (the picker is gone;
    // the cancelled token drops it) and must not throw.
    await act(async () => {
      resolveUsers([{ id: "u1", label: "Stale" }]);
      await Promise.resolve();
    });
    expect(document.querySelector("[data-slot='docblocks/mention-menu']")).toBeNull();
    expect(document.body.textContent).not.toContain("Stale");
  });
});
