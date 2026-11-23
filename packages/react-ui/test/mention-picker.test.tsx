// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { act } from "react";

import { createDoc } from "docblocks-core";

import { MentionPicker } from "../src/editing/mention";
import { EditorProvider } from "../src/editor-provider";
import type { MentionEntry, MentionProvider } from "../src/editor-provider";

const CREATED_AT = "2026-10-10T00:00:00.000Z";

afterEach(cleanup);

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
