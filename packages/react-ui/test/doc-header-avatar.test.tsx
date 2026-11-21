// @vitest-environment jsdom
// The header avatar slot's consumer contract: the built-in render, the
// content replacement over both stands, and the slot's removal.
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { act } from "react";

import { createDoc } from "docblocks-core";

import { DocHeader } from "../src/DocHeader";
import type { DocHeaderAvatarContentContext } from "../src/DocHeader";

const CREATED_AT = "2026-10-10T00:00:00.000Z";

function newDoc() {
  return createDoc({ id: "doc-header-avatar-doc", createdAt: CREATED_AT });
}

/** Waits for a predicate's non-null value over a deadline (the popover's async open). */
async function poll<T>(pred: () => T | null): Promise<T | null> {
  const deadline = Date.now() + 1000;
  for (;;) {
    let value: T | null = null;
    await act(async () => {
      value = pred();
    });
    if (value !== null) return value;
    if (Date.now() >= deadline) return null;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

/** A probing content render: reports every context it stands. */
function probeContent(contexts: DocHeaderAvatarContentContext[]) {
  return (context: DocHeaderAvatarContentContext) => {
    contexts.push(context);
    return <span data-testid="custom-avatar" />;
  };
}

afterEach(cleanup);

describe("the DocHeader avatar slot", () => {
  it("stands the built-in content without the props (the emoji over the avatar, the + affordance over none)", () => {
    const doc = newDoc();
    doc.setAvatar("🦊");
    render(<DocHeader doc={doc} view="page" onViewChange={() => {}} />);
    const filled = document.querySelector<HTMLElement>('[data-slot="docblocks/doc-header-avatar"]');
    expect(filled?.tagName).toBe("BUTTON");
    expect(filled?.textContent).toBe("🦊");
    expect(filled?.getAttribute("aria-label")).toBe("Edit the document avatar");
    expect(filled?.className).toContain("bg-muted");
    cleanup();
    doc.setAvatar(null);
    render(<DocHeader doc={doc} view="page" onViewChange={() => {}} />);
    const empty = document.querySelector<HTMLElement>('[data-slot="docblocks/doc-header-avatar"]');
    expect(empty?.textContent).toBe("+");
    expect(empty?.className).toContain("border-dashed");
  });

  it("renderAvatarContent stands the consumer's content inside the trigger; the click opens the picker and a pick commits", async () => {
    const doc = newDoc();
    const contexts: DocHeaderAvatarContentContext[] = [];
    render(<DocHeader doc={doc} view="page" onViewChange={() => {}} renderAvatarContent={probeContent(contexts)} />);
    const custom = screen.getByTestId("custom-avatar");
    const trigger = custom.closest('[data-slot="docblocks/doc-header-avatar"]');
    // The library owns the wrapper and its accessible name.
    expect(trigger?.tagName).toBe("BUTTON");
    expect(trigger?.getAttribute("aria-label")).toBe("Edit the document avatar");
    expect(contexts.at(-1)).toEqual({ avatar: null, editable: true });
    // The click on the content opens the picker (the trigger's own handler).
    fireEvent.click(custom);
    expect(await poll(() => document.querySelector('[data-slot="docblocks/emoji-picker"]'))).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Fox" }));
    expect(doc.meta.avatar).toBe("🦊");
    expect(await poll(() => document.querySelector('[data-slot="docblocks/emoji-picker"]'))).toBeNull();
  });

  it("the read-only stand renders the content inside the span with editable: false (no picker's entry)", () => {
    const doc = newDoc();
    doc.setAvatar("📘");
    const contexts: DocHeaderAvatarContentContext[] = [];
    render(
      <DocHeader
        doc={doc}
        view="page"
        onViewChange={() => {}}
        mode="view"
        onModeChange={() => {}}
        renderAvatarContent={probeContent(contexts)}
      />
    );
    const slot = screen.getByTestId("custom-avatar").closest('[data-slot="docblocks/doc-header-avatar"]');
    expect(slot?.tagName).toBe("SPAN");
    expect(slot?.getAttribute("aria-label")).toBe("Document avatar");
    expect(contexts.at(-1)).toEqual({ avatar: "📘", editable: false });
    // The read-only stand keeps the picker's entry off.
    fireEvent.click(screen.getByTestId("custom-avatar"));
    expect(document.querySelector('[data-slot="docblocks/emoji-picker"]')).toBeNull();
  });

  it("calls the content callback on every render (the library memoizes nothing)", () => {
    const doc = newDoc();
    const contexts: DocHeaderAvatarContentContext[] = [];
    const content = probeContent(contexts);
    const { rerender } = render(
      <DocHeader doc={doc} view="page" onViewChange={() => {}} renderAvatarContent={content} />
    );
    const afterMount = contexts.length;
    expect(afterMount).toBeGreaterThan(0);
    act(() => doc.setTitle("Changed"));
    rerender(<DocHeader doc={doc} view="page" onViewChange={() => {}} renderAvatarContent={content} />);
    expect(contexts.length).toBeGreaterThan(afterMount);
  });

  it("reports the published's stand avatar from the snapshot (the live's avatar stands off)", () => {
    const doc = newDoc();
    doc.setAvatar("🦊");
    const snapshot = newDoc();
    snapshot.setAvatar("📘");
    const contexts: DocHeaderAvatarContentContext[] = [];
    render(
      <DocHeader
        doc={doc}
        view="page"
        onViewChange={() => {}}
        mode="published"
        publishedDoc={snapshot}
        renderAvatarContent={probeContent(contexts)}
      />
    );
    expect(contexts.at(-1)).toEqual({ avatar: "📘", editable: false });
    expect(screen.getByTestId("custom-avatar").closest('[data-slot="docblocks/doc-header-avatar"]')?.tagName).toBe(
      "SPAN"
    );
  });

  it("hideAvatar removes the slot (no wrapper, no focus stop, no content call) and keeps the rest of the panel", () => {
    const doc = newDoc();
    doc.setAvatar("🦊");
    const contexts: DocHeaderAvatarContentContext[] = [];
    render(
      <DocHeader
        doc={doc}
        view="page"
        onViewChange={() => {}}
        hideAvatar
        renderAvatarContent={probeContent(contexts)}
      />
    );
    expect(document.querySelector('[data-slot="docblocks/doc-header-avatar"]')).toBeNull();
    expect(screen.queryByRole("button", { name: "Edit the document avatar" })).toBeNull();
    expect(contexts).toEqual([]);
    expect(document.querySelector('[data-slot="docblocks/doc-header-view"]')).not.toBeNull();
    expect(document.querySelector('[data-slot="docblocks/doc-header-title"]')).not.toBeNull();
  });
});
