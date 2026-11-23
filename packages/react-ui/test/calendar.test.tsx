// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { format } from "date-fns";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { act } from "react";

import { Calendar, DatePicker, DateTimePicker } from "../src/shared/ui";

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

  it("the pick + the time stand the commit on the Enter (the no-op Escape stands none)", async () => {
    const picks: (Date | null)[] = [];
    render(<DateTimePicker value={new Date(2026, 9, 1, 18, 0)} onSelect={(date) => picks.push(date)} />);
    fireEvent.click(screen.getByRole("button", { name: /01\.10\.2026 18:00/ }));
    const calendar = await poll(() => document.querySelector("[data-slot='calendar']"));
    expect(calendar).not.toBeNull();
    const segments = document.querySelector("[data-slot='time-segments']");
    expect(segments).not.toBeNull();

    // The day pick + the minutes type (the 30 stands); the Enter closes
    // and commits.
    fireEvent.click(document.querySelector("button[data-day='10/15/2026']")!);
    const [, minutes] = [...document.querySelectorAll<HTMLInputElement>("[data-slot='time-segments'] input")];
    fireEvent.change(minutes!, { target: { value: "30" } });
    fireEvent.keyDown(document.querySelector("[data-slot='popover-content']")!, { key: "Enter", bubbles: true });
    expect(picks).toHaveLength(1);
    expect(picks[0]).toEqual(new Date(2026, 9, 15, 18, 30));
    await poll<boolean | null>(() => (document.querySelector("[data-slot='calendar']") === null ? true : null));

    // The no-op Escape stands no commit (the draft stands the value — the
    // cancel's drop over the unchanged draft).
    picks.length = 0;
    fireEvent.click(screen.getByRole("button", { name: /01\.10\.2026 18:00/ }));
    await poll(() => document.querySelector("[data-slot='calendar']"));
    fireEvent.keyDown(document.querySelector("[data-slot='popover-content']")!, { key: "Escape", bubbles: true });
    expect(picks).toEqual([]);
  });

  it("the Escape cancels the draft (the close stands no commit over the changed draft)", async () => {
    const picks: (Date | null)[] = [];
    render(<DateTimePicker value={new Date(2026, 9, 1, 18, 0)} onSelect={(date) => picks.push(date)} />);
    fireEvent.click(screen.getByRole("button", { name: /01\.10\.2026 18:00/ }));
    await poll(() => document.querySelector("[data-slot='calendar']"));
    // The day pick + the minutes type stand the draft; the Escape drops
    // it (no commit) + closes.
    fireEvent.click(document.querySelector("button[data-day='10/15/2026']")!);
    const [, minutes] = [...document.querySelectorAll<HTMLInputElement>("[data-slot='time-segments'] input")];
    fireEvent.change(minutes!, { target: { value: "30" } });
    fireEvent.keyDown(document.querySelector("[data-slot='popover-content']")!, { key: "Escape", bubbles: true });
    await poll<boolean | null>(() => (document.querySelector("[data-slot='calendar']") === null ? true : null));
    expect(picks).toEqual([]);
    // The trigger stands the open-time's value (the draft's drop).
    expect(screen.getByRole("button", { name: /01\.10\.2026 18:00/ }).textContent).toContain("01.10.2026 18:00");
  });

  it("the Escape's cancel resets over the re-open (the next session's commit stands)", async () => {
    const picks: (Date | null)[] = [];
    render(<DateTimePicker value={new Date(2026, 9, 1, 18, 0)} onSelect={(date) => picks.push(date)} />);
    const trigger = () => screen.getByRole("button", { name: /01\.10\.2026 18:00/ });
    fireEvent.click(trigger());
    await poll(() => document.querySelector("[data-slot='calendar']"));
    const [hours] = [...document.querySelectorAll<HTMLInputElement>("[data-slot='time-segments'] input")];
    fireEvent.change(hours!, { target: { value: "09" } });
    fireEvent.keyDown(document.querySelector("[data-slot='popover-content']")!, { key: "Escape", bubbles: true });
    await poll<boolean | null>(() => (document.querySelector("[data-slot='calendar']") === null ? true : null));
    expect(picks).toEqual([]);
    // The re-open stands the value's draft (the cancel's drop); the commit
    // stand is alive over the next session.
    fireEvent.click(trigger());
    await poll(() => document.querySelector("[data-slot='calendar']"));
    const [hours2, minutes2] = [...document.querySelectorAll<HTMLInputElement>("[data-slot='time-segments'] input")];
    fireEvent.change(hours2!, { target: { value: "10" } });
    fireEvent.change(minutes2!, { target: { value: "15" } });
    fireEvent.keyDown(document.querySelector("[data-slot='popover-content']")!, { key: "Enter", bubbles: true });
    expect(picks).toEqual([new Date(2026, 9, 1, 10, 15)]);
  });

  it("the Enter over the day's button stands the day's select (the popover stays open)", async () => {
    const picks: (Date | null)[] = [];
    render(<DateTimePicker value={new Date(2026, 9, 1, 18, 0)} onSelect={(date) => picks.push(date)} />);
    fireEvent.click(screen.getByRole("button", { name: /01\.10\.2026 18:00/ }));
    await poll(() => document.querySelector("[data-slot='calendar']"));
    const day = document.querySelector<HTMLButtonElement>("button[data-day='10/5/2026']")!;
    // The day's button's native activation's stand: the Enter stands the
    // pick (not the commit) — the popover stays open over the time's input.
    fireEvent.keyDown(day, { key: "Enter", bubbles: true });
    expect(document.querySelector("[data-slot='calendar']")).not.toBeNull();
    expect(picks).toEqual([]);
    // The pick stands over the activation's click; the content's Enter
    // commits (the seed's time over the picked day).
    fireEvent.click(day);
    fireEvent.keyDown(document.querySelector("[data-slot='popover-content']")!, { key: "Enter", bubbles: true });
    expect(picks).toEqual([new Date(2026, 9, 5, 18, 0)]);
  });

  it("the same-day pick stands no reset (the draft date stands; the no-op close stands none)", async () => {
    const picks: (Date | null)[] = [];
    render(<DateTimePicker value={new Date(2026, 9, 1, 18, 0)} onSelect={(date) => picks.push(date)} />);
    fireEvent.click(screen.getByRole("button", { name: /01\.10\.2026 18:00/ }));
    const calendar = await poll(() => document.querySelector("[data-slot='calendar']"));
    expect(calendar).not.toBeNull();
    // The value's day stands selected (the draft's day): the re-pick is the
    // day-picker's toggle (the undefined stand) — the draft date stands,
    // the Escape cancel commits nothing (the draft stands the value). The
    // day buttons' data-day is the un-padded en-US locale date.
    fireEvent.click(document.querySelector("button[data-day='10/1/2026']")!);
    fireEvent.keyDown(document.querySelector("[data-slot='popover-content']")!, { key: "Escape", bubbles: true });
    expect(picks).toEqual([]);

    // The re-open: the same-day re-pick lost nothing — the typed minutes
    // commit over the draft's date (the Enter's close; the deferred
    // commit's contract).
    fireEvent.click(screen.getByRole("button", { name: /01\.10\.2026 18:00/ }));
    await poll(() => document.querySelector("[data-slot='calendar']"));
    fireEvent.click(document.querySelector("button[data-day='10/1/2026']")!);
    const [, minutes] = [...document.querySelectorAll<HTMLInputElement>("[data-slot='time-segments'] input")];
    fireEvent.change(minutes!, { target: { value: "30" } });
    fireEvent.keyDown(document.querySelector("[data-slot='popover-content']")!, { key: "Enter", bubbles: true });
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
