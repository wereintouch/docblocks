// @vitest-environment jsdom
// The consumer-placed document header (the page/canvas switcher, the avatar,
// the title) and the reusable sliding-pill segment selector it stands on.
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useState } from "react";

import { createDoc } from "docblocks-core";

import { DocHeader } from "../src/DocHeader";
import { SegmentSelector } from "../src/shared/ui";

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

  it("the avatar edit commits one setAvatar (one undo step); the Escape cancels without a write", () => {
    const doc = newDoc();
    render(<DocHeader doc={doc} view="page" onViewChange={() => {}} />);
    // Escape cancels (no write).
    fireEvent.click(screen.getByRole("button", { name: "Edit the document avatar" }));
    let input = screen.getByRole("textbox", { name: "Document avatar" });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(doc.meta.avatar).toBeUndefined();
    // The commit stands one setAvatar (one undo step).
    fireEvent.click(screen.getByRole("button", { name: "Edit the document avatar" }));
    input = screen.getByRole("textbox", { name: "Document avatar" });
    fireEvent.change(input, { target: { value: "🦊" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(doc.meta.avatar).toBe("🦊");
    doc.undo();
    expect(doc.meta.avatar).toBeUndefined();
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
