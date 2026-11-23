// @vitest-environment jsdom
// The FigureBorderSelector (the border's width dots)'s stands: the dots'
// render (the handle over the current dot, the aria slider), the
// keyboard's step (the clamped stand), the focus's contract (the tabIndex +
// the arrows over the focus), the pointer's snap (the magnet's drag), and
// the filled-progress's accent (the fill / the dots / the handle's seat).
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { useState } from "react";

import { FigureBorderSelector } from "../src/shared/ui";

afterEach(cleanup);

describe("FigureBorderSelector (the border's width dots)", () => {
  it("renders the dots (the handle stands on the current dot, the aria slider stands)", () => {
    render(<FigureBorderSelector points={4} value={1} onChange={() => undefined} label="Border width" />);
    const slider = screen.getByRole("slider", { name: "Border width" });
    expect(slider.getAttribute("aria-valuemax")).toBe("3");
    expect(slider.getAttribute("aria-valuenow")).toBe("1");
    expect(slider.getAttribute("aria-valuetext")).toBe("2");
    // The four dots (the track's line + the handle + the dots' spans: 4 dots).
    const dots = slider.querySelectorAll(".rounded-full");
    expect(dots.length).toBe(5); // the 4 dots + the handle
  });

  it("steps by the keyboard (the arrows / the edges, the clamped stand)", () => {
    const changes: number[] = [];
    function StatefulSelector({ start }: { start: number }) {
      const [value, setValue] = useState(start);
      return (
        <FigureBorderSelector
          points={4}
          value={value}
          onChange={(index) => {
            changes.push(index);
            setValue(index);
          }}
          label="Border width"
        />
      );
    }
    render(<StatefulSelector start={0} />);
    const slider = screen.getByRole("slider", { name: "Border width" });

    fireEvent.keyDown(slider, { key: "ArrowLeft" }); // the floor (0)
    expect(changes).toEqual([]);
    fireEvent.keyDown(slider, { key: "ArrowRight" });
    fireEvent.keyDown(slider, { key: "ArrowRight" });
    expect(changes).toEqual([1, 2]);

    changes.length = 0;
    cleanup();
    render(<StatefulSelector start={2} />);
    fireEvent.keyDown(screen.getByRole("slider", { name: "Border width" }), { key: "End" });
    fireEvent.keyDown(screen.getByRole("slider", { name: "Border width" }), { key: "Home" });
    expect(changes).toEqual([3, 0]);
  });

  it("stands focusable (the tabIndex 0 + the arrows over the focused slider)", () => {
    const changes: number[] = [];
    function StatefulSelector({ start }: { start: number }) {
      const [value, setValue] = useState(start);
      return (
        <FigureBorderSelector
          points={4}
          value={value}
          onChange={(index) => {
            changes.push(index);
            setValue(index);
          }}
          label="Border width"
        />
      );
    }
    render(<StatefulSelector start={1} />);
    const slider = screen.getByRole("slider", { name: "Border width" });
    // The slider contract: the control stands in the tab order (the
    // tabIndex 0) and receives the focus.
    expect(slider.getAttribute("tabindex")).toBe("0");
    slider.focus();
    expect(document.activeElement).toBe(slider);
    // The arrows stand the step while the focus is on the slider.
    fireEvent.keyDown(slider, { key: "ArrowRight" });
    expect(changes).toEqual([2]);
    fireEvent.keyDown(slider, { key: "End" });
    expect(changes).toEqual([2, 3]);
  });

  it("snaps to the nearest dot on the pointer's stand (the magnet's drag)", () => {
    const changes: number[] = [];
    function StatefulSelector() {
      const [value, setValue] = useState(0);
      return (
        <FigureBorderSelector
          points={4}
          value={value}
          onChange={(index) => {
            changes.push(index);
            setValue(index);
          }}
          label="Border width"
        />
      );
    }
    render(<StatefulSelector />);
    const slider = screen.getByRole("slider", { name: "Border width" });
    // The press + the move stand the snap's arithmetic on the stubbed
    // rect (the drag's real geometry is the e2e's pin).
    const rect = { left: 0, width: 64, top: 0, height: 20, right: 64, bottom: 20, x: 0, y: 0, toJSON: () => ({}) };
    Object.defineProperty(slider, "getBoundingClientRect", { value: () => rect, configurable: true });
    fireEvent.pointerDown(slider, { clientX: 58 }); // ~90% -> the dot 3
    expect(changes).toEqual([3]);
    fireEvent.pointerMove(slider, { clientX: 8, buttons: 1 }); // ~12% -> the dot 0
    expect(changes).toEqual([3, 0]);
  });

  it("stands the filled-progress accent (the fill's width per value, the dots' accent at/left, the handle's seat)", () => {
    // The dot / fill / handle positions (the i / (points - 1) ratio).
    const expectedPct = [0, (1 / 3) * 100, (2 / 3) * 100, 100];
    for (let value = 0; value <= 3; value += 1) {
      render(<FigureBorderSelector points={4} value={value} onChange={() => undefined} label="Border width" />);
      const slider = screen.getByRole("slider", { name: "Border width" });
      // The fill segment (the accent's line — the only div with an inline width).
      const fill = Array.from(slider.querySelectorAll("div")).find((el) => el.style.width !== "");
      expect(fill, `the fill's segment at value ${value}`).toBeDefined();
      expect(fill!.className).toContain("bg-(--primary)");
      expect(parseFloat(fill!.style.width)).toBeCloseTo(expectedPct[value]!, 3);
      // The dots at / left of the handle stand the accent; the right ones the border.
      const dots = Array.from(slider.querySelectorAll<HTMLElement>("span.rounded-full")).filter((el) =>
        el.className.includes("size-1")
      );
      expect(dots.length).toBe(4);
      dots.forEach((dot, index) => {
        if (index <= value) expect(dot.className).toContain("bg-(--primary)");
        else expect(dot.className).toContain("bg-(--border)");
      });
      // The handle stands at the current dot's position (the fill's end).
      const handle = Array.from(slider.querySelectorAll<HTMLElement>("span.rounded-full")).find((el) =>
        el.className.includes("size-2.5")
      );
      expect(handle).toBeDefined();
      expect(parseFloat(handle!.style.left)).toBeCloseTo(expectedPct[value]!, 3);
      cleanup();
    }
  });
});
