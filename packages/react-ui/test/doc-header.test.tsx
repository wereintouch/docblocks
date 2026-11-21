// @vitest-environment jsdom
// The consumer-placed document header (the page/canvas switcher, the avatar,
// the title) and the reusable sliding-pill segment selector it stands on.
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { DocHeader } from "../src/DocHeader";
import { newDoc, poll } from "./doc-header.helpers";

describe("DocHeader", () => {
  it("stands the composition (the mode switcher, the avatar, the title — the Untitled placeholder over the absent title)", () => {
    const doc = newDoc();
    render(<DocHeader doc={doc} view="page" onViewChange={() => {}} />);
    const header = document.querySelector('[data-slot="docblocks/doc-header"]')!;
    // The order left to right: the view switcher, the avatar, the title.
    const order = [
      header.querySelector('[data-slot="docblocks/doc-header-view"]'),
      header.querySelector('[data-slot="docblocks/doc-header-avatar"]'),
      header.querySelector('[data-slot="docblocks/doc-header-title"]'),
    ];
    expect(order.every((el) => el !== null)).toBe(true);
    const positions = order.map((el) => el!.getBoundingClientRect().x);
    expect(positions).toEqual([...positions].sort((x, y) => x - y));
    // The absent title stands the muted "Untitled" placeholder (not an empty button).
    expect(screen.getByText("Untitled")).not.toBeNull();
  });

  it("the title edit's caret seats at the end (no select-all)", () => {
    const doc = newDoc();
    doc.setTitle("Original title");
    render(<DocHeader doc={doc} view="page" onViewChange={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit the document title" }));
    const input = screen.getByRole("textbox", { name: "Document title" }) as HTMLInputElement;
    expect(input.value).toBe("Original title");
    // The caret stands after the last character (a select-all would stand 0..len).
    expect(input.selectionStart).toBe("Original title".length);
    expect(input.selectionEnd).toBe("Original title".length);
    // The edit is focused (the commit on the blur is armed).
    expect(document.activeElement).toBe(input);
  });

  it("the empty title commit stands the Untitled placeholder (the undo reverts)", () => {
    const doc = newDoc();
    doc.setTitle("Gone");
    render(<DocHeader doc={doc} view="page" onViewChange={() => {}} />);
    // The empty-string commit (Enter on the cleared input).
    fireEvent.click(screen.getByRole("button", { name: "Edit the document title" }));
    const input = screen.getByRole("textbox", { name: "Document title" }) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(doc.meta.title).toBe("");
    // The display stands the muted "Untitled" placeholder.
    expect(screen.queryByText("Gone")).toBeNull();
    expect(screen.getByText("Untitled")).not.toBeNull();
    // The commit is one undo step (the revert restores the title).
    doc.undo();
    expect(doc.meta.title).toBe("Gone");
  });

  it("renders the title and the avatar placeholder from the doc's meta", () => {
    const doc = newDoc();
    doc.setTitle("My doc");
    render(<DocHeader doc={doc} view="page" onViewChange={() => {}} />);
    expect(screen.getByText("My doc")).not.toBeNull();
    // The absent avatar stands the placeholder affordance.
    expect(screen.getByRole("button", { name: "Edit the document avatar" })).not.toBeNull();
  });

  it("re-renders on the remote meta change (the doc's onChange feed)", () => {
    const doc = newDoc();
    doc.setTitle("Before");
    const { rerender } = render(<DocHeader doc={doc} view="page" onViewChange={() => {}} />);
    expect(screen.getByText("Before")).not.toBeNull();
    // A (peer) meta change re-renders the panel from the doc's own read.
    doc.setTitle("After");
    rerender(<DocHeader doc={doc} view="page" onViewChange={() => {}} />);
    expect(screen.getByText("After")).not.toBeNull();
  });

  it("the title edit commits one setTitle (one undo step); the Escape cancels without a write", () => {
    const doc = newDoc();
    doc.setTitle("Original");
    render(<DocHeader doc={doc} view="page" onViewChange={() => {}} />);
    // Escape cancels (no write).
    fireEvent.click(screen.getByRole("button", { name: "Edit the document title" }));
    let input = screen.getByRole("textbox", { name: "Document title" });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(doc.meta.title).toBe("Original");
    // The commit stands one setTitle (one undo step).
    fireEvent.click(screen.getByRole("button", { name: "Edit the document title" }));
    input = screen.getByRole("textbox", { name: "Document title" });
    fireEvent.change(input, { target: { value: "Changed" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(doc.meta.title).toBe("Changed");
    doc.undo();
    expect(doc.meta.title).toBe("Original");
  });

  it("the title edit's no-op stand (the same value) writes nothing (no extra undo step)", () => {
    const doc = newDoc();
    doc.setTitle("Same"); // one undo step (the seed)
    render(<DocHeader doc={doc} view="page" onViewChange={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit the document title" }));
    const input = screen.getByRole("textbox", { name: "Document title" });
    fireEvent.keyDown(input, { key: "Enter" }); // the no-op commit (the unchanged value)
    expect(doc.meta.title).toBe("Same");
    // A single undo reverts the seed (the no-op commit added no step).
    doc.undo();
    expect(doc.meta.title).toBe(""); // the pre-seed title
    expect(doc.canUndo).toBe(false); // no further step (the no-op added none)
  });

  it("the avatar pick opens the popover, commits one setAvatar (one undo step), and closes; the Escape closes without a write", async () => {
    const doc = newDoc();
    render(<DocHeader doc={doc} view="page" onViewChange={() => {}} />);
    // The Escape closes the popover without a write.
    fireEvent.click(screen.getByRole("button", { name: "Edit the document avatar" }));
    expect(await poll(() => document.querySelector('[data-slot="docblocks/emoji-picker"]'))).not.toBeNull();
    fireEvent.keyDown(document.querySelector("[data-slot='popover-content']")!, { key: "Escape", bubbles: true });
    expect(await poll(() => document.querySelector('[data-slot="docblocks/emoji-picker"]'))).toBeNull();
    expect(doc.meta.avatar).toBeUndefined();
    // A pick commits one setAvatar (one undo step) and closes the popover.
    fireEvent.click(screen.getByRole("button", { name: "Edit the document avatar" }));
    expect(await poll(() => document.querySelector('[data-slot="docblocks/emoji-picker"]'))).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Fox" }));
    expect(doc.meta.avatar).toBe("🦊");
    expect(await poll(() => document.querySelector('[data-slot="docblocks/emoji-picker"]'))).toBeNull();
    expect(doc.canUndo).toBe(true);
    doc.undo();
    expect(doc.meta.avatar).toBeUndefined();
  });

  it("the avatar's clear option removes it (the dashed plus stand); a clear over the absent avatar is a no-op", async () => {
    const doc = newDoc();
    render(<DocHeader doc={doc} view="page" onViewChange={() => {}} />);
    // The clear over the absent avatar is a no-op (no undo step).
    fireEvent.click(screen.getByRole("button", { name: "Edit the document avatar" }));
    await poll(() => document.querySelector('[data-slot="docblocks/emoji-picker"]'));
    fireEvent.click(screen.getByRole("button", { name: "Remove avatar" }));
    expect(doc.canUndo).toBe(false);
    // Set an avatar, then clear it (one undo step).
    doc.setAvatar("🦊");
    fireEvent.click(screen.getByRole("button", { name: "Edit the document avatar" }));
    await poll(() => document.querySelector('[data-slot="docblocks/emoji-picker"]'));
    fireEvent.click(screen.getByRole("button", { name: "Remove avatar" }));
    expect(doc.meta.avatar).toBeUndefined();
    expect(screen.getByRole("button", { name: "Edit the document avatar" }).textContent).toBe("+");
    doc.undo();
    expect(doc.meta.avatar).toBe("🦊");
  });

  it("the avatar's same-emoji pick is the no-op stand (no write, no undo step)", async () => {
    const doc = newDoc();
    doc.setAvatar("🦊"); // one undo step (the seed)
    render(<DocHeader doc={doc} view="page" onViewChange={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit the document avatar" }));
    await poll(() => document.querySelector('[data-slot="docblocks/emoji-picker"]'));
    fireEvent.click(screen.getByRole("button", { name: "Fox" })); // the standing emoji
    expect(doc.meta.avatar).toBe("🦊");
    // A single undo reverts the seed (the no-op pick added no step).
    doc.undo();
    expect(doc.meta.avatar).toBeUndefined();
    expect(doc.canUndo).toBe(false);
  });

  it("the mode switcher is controlled: onViewChange fires on a switch, and no-op on the current view", () => {
    const doc = newDoc();
    const onViewChange = vi.fn();
    render(<DocHeader doc={doc} view="page" onViewChange={onViewChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Canvas view" }));
    expect(onViewChange).toHaveBeenCalledWith("canvas");
    onViewChange.mockClear();
    fireEvent.click(screen.getByRole("button", { name: "Page view" }));
    expect(onViewChange).not.toHaveBeenCalled();
  });
});
