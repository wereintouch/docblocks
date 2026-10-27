// @vitest-environment jsdom
// The consumer-placed document header (the page/canvas switcher, the avatar,
// the title) and the reusable sliding-pill segment selector it stands on.
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { act, useState } from "react";

import { createDoc } from "docblocks-core";

import { DocHeader } from "../src/DocHeader";
import { SegmentSelector } from "../src/shared/ui";
import { EmojiPicker } from "../src/shared/ui/EmojiPicker";
import { AVATAR_EMOJI } from "../src/shared/ui/emoji-catalog";

const CREATED_AT = "2026-10-10T00:00:00.000Z";

type TestDoc = ReturnType<typeof createDoc>;

function newDoc(): TestDoc {
  return createDoc({ id: "doc-header-doc", createdAt: CREATED_AT });
}

/** A controlled segment over the "a" | "b" values (the component's own state). */
function ControlledSegment() {
  const [value, setValue] = useState<"a" | "b">("a");
  return (
    <SegmentSelector
      options={[
        { value: "a", label: "Option A", icon: <span>icon-a</span> },
        { value: "b", label: "Option B", icon: <span>icon-b</span> },
      ]}
      value={value}
      onChange={setValue}
      ariaLabel="Test segment"
      slot="docblocks/test-segment"
      pillSlot="docblocks/test-segment-pill"
      buttonAttrName="test-segment-button"
    />
  );
}

afterEach(cleanup);

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

describe("SegmentSelector", () => {
  it("stands the options (the active pressed), the sliding pill, and commits the pick", () => {
    render(<ControlledSegment />);
    const a = screen.getByRole("button", { name: "Option A" });
    const b = screen.getByRole("button", { name: "Option B" });
    expect(a.getAttribute("aria-pressed")).toBe("true");
    expect(b.getAttribute("aria-pressed")).toBe("false");
    // The per-button data attribute (the pill's measurement target).
    expect(a.getAttribute("data-test-segment-button")).toBe("a");
    // The sliding pill stands (jsdom has no layout, so its geometry is zero).
    const pillEl = document.querySelector<HTMLElement>('[data-slot="docblocks/test-segment-pill"]');
    expect(pillEl).not.toBeNull();
    // The pill's travel stands the back-out easing (the slight overshoot's
    // settle — the framer-free stand over the base entry).
    expect(pillEl!.className).toContain("ease-[cubic-bezier(0.34,1.56,0.64,1)]");
    // A pick commits to the caller's onChange (the active flips).
    fireEvent.click(b);
    expect(screen.getByRole("button", { name: "Option B" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "Option A" }).getAttribute("aria-pressed")).toBe("false");
  });

  it("the controlled value stands (the caller owns the state, the component has none)", () => {
    const { rerender } = render(
      <SegmentSelector
        options={[
          { value: "x", label: "X", icon: <span>x</span> },
          { value: "y", label: "Y", icon: <span>y</span> },
        ]}
        value="x"
        onChange={() => {}}
        ariaLabel="Static segment"
        slot="docblocks/static-segment"
        pillSlot="docblocks/static-segment-pill"
        buttonAttrName="static-segment-button"
      />
    );
    expect(screen.getByRole("button", { name: "X" }).getAttribute("aria-pressed")).toBe("true");
    // Re-rendering with a different controlled value flips the active stand.
    rerender(
      <SegmentSelector
        options={[
          { value: "x", label: "X", icon: <span>x</span> },
          { value: "y", label: "Y", icon: <span>y</span> },
        ]}
        value="y"
        onChange={() => {}}
        ariaLabel="Static segment"
        slot="docblocks/static-segment"
        pillSlot="docblocks/static-segment-pill"
        buttonAttrName="static-segment-button"
      />
    );
    expect(screen.getByRole("button", { name: "Y" }).getAttribute("aria-pressed")).toBe("true");
  });
});

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

describe("EmojiPicker", () => {
  it("stands the catalog's options (the labels, the selected highlight) and reports the pick / the clear", () => {
    const picks: string[] = [];
    const clears: number[] = [];
    render(<EmojiPicker selected="🦊" onPick={(emoji) => picks.push(emoji)} onClear={() => clears.push(1)} />);
    // Every catalog option stands (the accessible label, the emoji's data pin).
    expect(document.querySelectorAll('[data-slot="docblocks/emoji-picker-option"]').length).toBe(AVATAR_EMOJI.length);
    const fox = screen.getByRole("button", { name: "Fox" }) as HTMLButtonElement;
    expect(fox.getAttribute("data-emoji")).toBe("🦊");
    expect(fox.getAttribute("aria-pressed")).toBe("true"); // the selected stand
    expect(screen.getByRole("button", { name: "Cat" }).getAttribute("aria-pressed")).toBe("false");
    // A pick reports the emoji (not the label).
    fireEvent.click(screen.getByRole("button", { name: "Rocket" }));
    expect(picks).toEqual(["🚀"]);
    // The clear reports.
    fireEvent.click(screen.getByRole("button", { name: "Remove avatar" }));
    expect(clears).toEqual([1]);
  });

  it("stands no selection when the avatar is absent", () => {
    render(<EmojiPicker selected={null} onPick={() => {}} onClear={() => {}} />);
    expect(
      [...document.querySelectorAll<HTMLElement>('[data-slot="docblocks/emoji-picker-option"]')].every(
        (el) => el.getAttribute("aria-pressed") === "false"
      )
    ).toBe(true);
  });
});
