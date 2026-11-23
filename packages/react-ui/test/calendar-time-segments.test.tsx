// @vitest-environment jsdom
// The TimeSegments (the HH:MM:SS box)'s suite: the digit typing's wire (the
// auto-advance, the two-digit normalize on the blur), the clear button's
// null wire, the disabled clear's no-wire, and the external value change's
// draft's stand (the reset, the focused group's sync over the blur).
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { TimeSegments } from "../src/shared/ui";

// The radix Popover drives the open gesture through the pointer-capture
// API, which jsdom does not implement. The stub keeps the gesture testable.
beforeAll(() => {
  // The calendar's default month stands "today" (react-day-picker's
  // `dateLib.today()`), so the suite pins the system time to a fixed
  // October 2026 date — the day cells the tests target stand in the
  // displayed month regardless of the run date. The timers the portal
  // poll leans on (`setTimeout`) stay real.
  vi.useFakeTimers({
    toNotFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "setImmediate", "clearImmediate"],
  });
  vi.setSystemTime(new Date(2026, 9, 1));
  Element.prototype.hasPointerCapture = Element.prototype.hasPointerCapture ?? (() => false);
  if (!Element.prototype.setPointerCapture) Element.prototype.setPointerCapture = () => undefined;
  if (!Element.prototype.releasePointerCapture) Element.prototype.releasePointerCapture = () => undefined;
});

afterAll(() => {
  vi.useRealTimers();
});

describe("TimeSegments (the HH:MM:SS box)", () => {
  afterEach(() => cleanup());

  it("the digit typing stands the wire (the auto-advance, the two-digit normalize on the blur)", () => {
    const wires: (string | null)[] = [];
    render(<TimeSegments id="time" value={null} onChange={(wire) => wires.push(wire)} />);
    const [hours] = [...document.querySelectorAll<HTMLInputElement>("[data-slot='time-segments'] input")];
    fireEvent.change(hours!, { target: { value: "1" } });
    expect(wires.at(-1)).toBe("01:00:00");
    // The auto-advance stands the focus on the minutes (the two digits
    // complete the segment).
    fireEvent.change(hours!, { target: { value: "14" } });
    const minutes = document.getElementById("time-m");
    expect(document.activeElement === minutes).toBe(true);
    fireEvent.change(minutes!, { target: { value: "5" } });
    expect(wires.at(-1)).toBe("14:05:00");
  });

  it("the clear button stands the null wire (the segments stand empty)", () => {
    const wires: (string | null)[] = [];
    const { rerender } = render(<TimeSegments value={"10:20:30"} onChange={(wire) => wires.push(wire)} clearable />);
    const clear = document.querySelector<HTMLElement>("[data-slot='time-segments'] button");
    expect(clear).not.toBeNull();
    fireEvent.click(clear!);
    expect(wires.at(-1)).toBeNull();
    rerender(<TimeSegments value={null} onChange={(wire) => wires.push(wire)} clearable />);
    expect(document.querySelector("[data-slot='time-segments'] button")).toBeNull();
  });

  it("the disabled clear stands no wire (the pointer and the keyboard activation)", () => {
    const wires: (string | null)[] = [];
    render(<TimeSegments value={"10:20:30"} onChange={(wire) => wires.push(wire)} clearable disabled />);
    const clear = document.querySelector<HTMLButtonElement>("[data-slot='time-segments'] button");
    expect(clear!.disabled).toBe(true);
    // The disabled stand: the guard stands the wire over every activation.
    fireEvent.click(clear!);
    fireEvent.keyDown(clear!, { key: "Enter" });
    fireEvent.keyDown(clear!, { key: " " });
    expect(wires).toHaveLength(0);
  });

  it("the external value change stands the draft (the reset and the clear over the untyped group)", () => {
    const read = () =>
      [...document.querySelectorAll<HTMLInputElement>("[data-slot='time-segments'] input")].map((input) => input.value);
    const { rerender } = render(<TimeSegments value={"10:20:30"} onChange={() => undefined} />);
    expect(read()).toEqual(["10", "20", "30"]);
    // The external replacement while no segment holds the focus.
    rerender(<TimeSegments value={"11:05:09"} onChange={() => undefined} />);
    expect(read()).toEqual(["11", "05", "09"]);
    // The external clear.
    rerender(<TimeSegments value={null} onChange={() => undefined} />);
    expect(read()).toEqual(["", "", ""]);
  });

  it("the external value change over the focused group stands the draft (the sync lands on the blur)", () => {
    const { rerender } = render(<TimeSegments value={"10:20:30"} onChange={() => undefined} />);
    const [hours] = [...document.querySelectorAll<HTMLInputElement>("[data-slot='time-segments'] input")];
    hours!.focus();
    fireEvent.change(hours!, { target: { value: "1" } });
    // The external replacement while the group holds the focus: the draft stands.
    rerender(<TimeSegments value={"11:05:09"} onChange={() => undefined} />);
    expect(hours!.value).toBe("1");
    // The focus leave stands the external value over the draft.
    fireEvent.blur(hours!, { relatedTarget: document.body });
    const read = () =>
      [...document.querySelectorAll<HTMLInputElement>("[data-slot='time-segments'] input")].map((input) => input.value);
    expect(read()).toEqual(["11", "05", "09"]);
  });
});
