// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { format } from "date-fns";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { act } from "react";

import { Calendar, DatePicker, DateTimePicker, TimeSegments } from "../src/shared/ui";

// The radix Popover drives the open gesture through the pointer-capture
// API, which jsdom does not implement. The stub keeps the gesture testable.
beforeAll(() => {
  Element.prototype.hasPointerCapture = Element.prototype.hasPointerCapture ?? (() => false);
  if (!Element.prototype.setPointerCapture) Element.prototype.setPointerCapture = () => undefined;
  if (!Element.prototype.releasePointerCapture) Element.prototype.releasePointerCapture = () => undefined;
});

const OCT_19 = new Date(2026, 9, 19);

describe("Calendar (the react-day-picker single month)", () => {
  afterEach(() => cleanup());

  it("renders the month caption, the weekday row, the day grid, and the nav buttons", () => {
    render(<Calendar mode="single" selected={OCT_19} onSelect={() => undefined} />);
    // The caption stands the month + year (the default label formatters).
    expect(document.querySelector("[data-slot='calendar']")).not.toBeNull();
    expect(document.querySelector(".rdp-month_caption")?.textContent).toBe("October 2026");
    // The weekday headers (the en-US short names).
    const weekdays = [...document.querySelectorAll(".rdp-weekday")].map((el) => el.textContent);
    expect(weekdays).toEqual(["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"]);
    // The day buttons stand the localized date hook; the selected day
    // stands the single-select data attribute.
    const days = [...document.querySelectorAll("button[data-day]")];
    expect(days.length).toBe(35);
    const selected = days.find((el) => el.getAttribute("data-day") === "10/19/2026");
    expect(selected?.getAttribute("data-selected-single")).toBe("true");
    // The prev / next month nav.
    expect(document.querySelector(".rdp-button_previous")?.tagName).toBe("BUTTON");
    expect(document.querySelector(".rdp-button_next")?.tagName).toBe("BUTTON");
  });

  it("the day pick stands the select modifiers (the range / single data attrs)", () => {
    render(<Calendar mode="single" selected={OCT_19} onSelect={() => undefined} />);
    const day = document.querySelector<HTMLButtonElement>("button[data-day='10/25/2026']");
    expect(day).not.toBeNull();
    expect(day?.getAttribute("data-selected-single")).toBeNull();
  });
});

describe("DatePicker (the popover + the calendar)", () => {
  afterEach(() => cleanup());

  it("the trigger stands the placeholder when empty, the formatted date when set", () => {
    const { rerender } = render(<DatePicker value={null} onSelect={() => undefined} data-slot="date-picker" />);
    const trigger = document.querySelector<HTMLElement>("[data-slot='date-picker']");
    expect(trigger).not.toBeNull();
    expect(trigger?.getAttribute("data-empty")).toBe("true");
    expect(trigger?.textContent).toContain("—");
    rerender(<DatePicker value={OCT_19} onSelect={() => undefined} data-slot="date-picker" />);
    expect(document.querySelector("[data-slot='date-picker']")?.getAttribute("data-empty")).toBeNull();
    // The long form (the date-fns `PPP`); computed over the same formatter
    // the trigger uses, so the pin stands format-version-independent.
    expect(document.querySelector("[data-slot='date-picker']")?.textContent).toContain(format(OCT_19, "PPP"));
  });

  it("the pick commits to onSelect (the local-calendar date)", async () => {
    const picks: (Date | null)[] = [];
    render(<DatePicker value={null} onSelect={(date) => picks.push(date)} />);
    const trigger = screen.getByRole("button", { name: /—/ });
    fireEvent.click(trigger);
    // The calendar mounts in the portaled content (poll the frames).
    const calendar = await poll(() => document.querySelector("[data-slot='calendar']"));
    expect(calendar).not.toBeNull();
    fireEvent.click(document.querySelector("button[data-day='10/20/2026']")!);
    expect(picks).toHaveLength(1);
    expect(picks[0]).toEqual(new Date(2026, 9, 20));
  });

  it("picking the selected day clears it (the day-picker's toggle)", async () => {
    const picks: (Date | null)[] = [];
    render(<DatePicker value={OCT_19} onSelect={(date) => picks.push(date)} />);
    fireEvent.click(screen.getByRole("button", { name: format(OCT_19, "PPP") }));
    const calendar = await poll(() => document.querySelector("[data-slot='calendar']"));
    expect(calendar).not.toBeNull();
    fireEvent.click(document.querySelector("button[data-day='10/19/2026']")!);
    expect(picks).toEqual([null]);
  });
});

/** Polls a predicate over the act-flushed frames (the portal's mount). */
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
      [...document.querySelectorAll<HTMLInputElement>("[data-slot='time-segments'] input")].map(
        (input) => input.value
      );
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
      [...document.querySelectorAll<HTMLInputElement>("[data-slot='time-segments'] input")].map(
        (input) => input.value
      );
    expect(read()).toEqual(["11", "05", "09"]);
  });
});

describe("DateTimePicker (the calendar + the time box)", () => {
  afterEach(() => cleanup());

  it("the trigger stands the compact date + time (the date-only value stands the date only)", () => {
    const { rerender } = render(<DateTimePicker value={null} onSelect={() => undefined} data-slot="dt-picker" />);
    expect(document.querySelector("[data-slot='dt-picker']")?.getAttribute("data-empty")).toBe("true");
    rerender(<DateTimePicker value={new Date(2026, 9, 1)} onSelect={() => undefined} data-slot="dt-picker" />);
    expect(document.querySelector("[data-slot='dt-picker']")?.textContent).toContain("01.10.2026");
    rerender(<DateTimePicker value={new Date(2026, 9, 1, 18, 5)} onSelect={() => undefined} data-slot="dt-picker" />);
    expect(document.querySelector("[data-slot='dt-picker']")?.textContent).toContain("01.10.2026 18:05");
  });

  it("the pick + the time stand the commit on the close (the Escape; the no-op close stands none)", async () => {
    const picks: (Date | null)[] = [];
    render(<DateTimePicker value={new Date(2026, 9, 1, 18, 0)} onSelect={(date) => picks.push(date)} />);
    fireEvent.click(screen.getByRole("button", { name: /01\.10\.2026 18:00/ }));
    const calendar = await poll(() => document.querySelector("[data-slot='calendar']"));
    expect(calendar).not.toBeNull();
    const segments = document.querySelector("[data-slot='time-segments']");
    expect(segments).not.toBeNull();

    // The day pick + the minutes type (the 30 stands); the Escape closes
    // and commits.
    fireEvent.click(document.querySelector("button[data-day='10/15/2026']")!);
    const [, minutes] = [...document.querySelectorAll<HTMLInputElement>("[data-slot='time-segments'] input")];
    fireEvent.change(minutes!, { target: { value: "30" } });
    fireEvent.keyDown(document.querySelector("[data-slot='popover-content']")!, { key: "Escape", bubbles: true });
    expect(picks).toHaveLength(1);
    expect(picks[0]).toEqual(new Date(2026, 9, 15, 18, 30));

    // The no-op close stands no commit (the draft stands the value — the
    // controlled `value` never moved, so the trigger name stands the same).
    picks.length = 0;
    fireEvent.click(screen.getByRole("button", { name: /01\.10\.2026 18:00/ }));
    await poll(() => document.querySelector("[data-slot='calendar']"));
    fireEvent.keyDown(document.querySelector("[data-slot='popover-content']")!, { key: "Escape", bubbles: true });
    expect(picks).toEqual([]);
  });

  it("the same-day pick stands no reset (the draft date stands; the no-op close stands none)", async () => {
    const picks: (Date | null)[] = [];
    render(<DateTimePicker value={new Date(2026, 9, 1, 18, 0)} onSelect={(date) => picks.push(date)} />);
    fireEvent.click(screen.getByRole("button", { name: /01\.10\.2026 18:00/ }));
    const calendar = await poll(() => document.querySelector("[data-slot='calendar']"));
    expect(calendar).not.toBeNull();
    // The value's day stands selected (the draft's day): the re-pick is the
    // day-picker's toggle (the undefined stand) — the draft date stands,
    // the Escape close commits nothing (the draft stands the value). The
    // day buttons' data-day is the un-padded en-US locale date.
    fireEvent.click(document.querySelector("button[data-day='10/1/2026']")!);
    fireEvent.keyDown(document.querySelector("[data-slot='popover-content']")!, { key: "Escape", bubbles: true });
    expect(picks).toEqual([]);

    // The re-open: the same-day re-pick lost nothing — the typed minutes
    // commit over the draft's date (the deferred commit's contract).
    fireEvent.click(screen.getByRole("button", { name: /01\.10\.2026 18:00/ }));
    await poll(() => document.querySelector("[data-slot='calendar']"));
    fireEvent.click(document.querySelector("button[data-day='10/1/2026']")!);
    const [, minutes] = [...document.querySelectorAll<HTMLInputElement>("[data-slot='time-segments'] input")];
    fireEvent.change(minutes!, { target: { value: "30" } });
    fireEvent.keyDown(document.querySelector("[data-slot='popover-content']")!, { key: "Escape", bubbles: true });
    expect(picks).toEqual([new Date(2026, 9, 1, 18, 30)]);
  });

  it("the time ids stand per instance (the second instance's box stands its own ids)", async () => {
    const readHoursId = () => document.querySelector<HTMLInputElement>("[data-slot='time-segments'] input")!.id;
    const first = render(<DateTimePicker value={null} onSelect={() => undefined} aria-label="picker-a" />);
    fireEvent.click(screen.getByRole("button", { name: "picker-a" }));
    await poll(() => document.querySelector("[data-slot='time-segments']"));
    const hoursIdA = readHoursId();
    expect(hoursIdA).not.toBe("");
    // The second instance's box stands its own ids (a shared literal id
    // would collide over the auto-advance's global lookup).
    first.unmount();
    render(<DateTimePicker value={null} onSelect={() => undefined} aria-label="picker-b" />);
    fireEvent.click(screen.getByRole("button", { name: "picker-b" }));
    await poll(() => document.querySelector("[data-slot='time-segments']"));
    expect(readHoursId()).not.toBe(hoursIdA);
  });
});
