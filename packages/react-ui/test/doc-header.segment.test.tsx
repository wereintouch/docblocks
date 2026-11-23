// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { SegmentSelector } from "../src/shared/ui";
import { ControlledSegment } from "./doc-header.helpers";

describe("SegmentSelector", () => {
  it("the active button's hover keeps its label color over the pill's fill (the ghost's hover restyle stands none)", () => {
    const renderSeg = (pillTheme: "accent" | "primary") =>
      render(
        <SegmentSelector
          options={[
            { value: "a", label: "Option A" },
            { value: "b", label: "Option B" },
          ]}
          value="a"
          onChange={() => {}}
          ariaLabel="Hover segment"
          slot="docblocks/hover-segment"
          pillSlot="docblocks/hover-segment-pill"
          buttonAttrName="hover-segment-button"
          size="text"
          pillTheme={pillTheme}
        />
      );
    // The `primary`'s stand (the prominent's fill): the label reads the
    // `primary-foreground` and re-stands it on the hover (the ghost's
    // `hover:text-accent-foreground` must not win the cascade — the dark's
    // label would stand unreadable over the fill).
    renderSeg("primary");
    const primaryActive = screen.getByRole("button", { name: "Option A" });
    expect(primaryActive.className).toContain("text-primary-foreground");
    expect(primaryActive.className).toContain("hover:text-primary-foreground");
    cleanup();
    // The `accent`'s stand (the soft's highlight): the same no-wash stand
    // over the `foreground`.
    renderSeg("accent");
    const accentActive = screen.getByRole("button", { name: "Option A" });
    expect(accentActive.className).toContain("text-foreground");
    expect(accentActive.className).toContain("hover:text-foreground");
  });

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
