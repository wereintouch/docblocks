// @vitest-environment jsdom
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { act, useState } from "react";

import type { DatabaseFilterPayload } from "docblocks-core";

import type { BridgeColumn } from "../src/database/bridge";
import { FilterBuilder } from "../src/database/filter-builder";
import { refEntryKey } from "../src/database/grid/use-ref-tables";
import type { RefTableDataMap } from "../src/database/grid/use-ref-tables";
import { DocblocksI18nProvider } from "../src/i18n";

// The filter builder's spec (the ref value inputs, the date's pickers, the group's structure).

// The radix Select drives the cell's pick through the pointer-capture API
// (setPointerCapture / hasPointerCapture), which jsdom does not implement.
// The stub keeps the open/pick gesture testable in the unit suite.
beforeAll(() => {
  Element.prototype.hasPointerCapture = vi.fn(() => false);
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => cleanup());

describe("the filter builder — the ref value inputs (the enum's dict options / the row-link's displays)", () => {
  const statusCol: BridgeColumn = {
    id: "status",
    name: "Status",
    type: "text",
    refKind: "enum",
    refTableId: "table-statuses",
  };
  const ownerCol: BridgeColumn = {
    id: "owner",
    name: "Owner",
    type: "text",
    refKind: "row",
    refTableId: "table-people",
  };
  const refTableData: RefTableDataMap = {
    [refEntryKey({ tableId: "table-statuses" })]: {
      rowIds: ["todo", "done"],
      displays: { todo: "todo", done: "done" },
      colors: {},
    },
    [refEntryKey({ tableId: "table-people" })]: {
      rowIds: ["r-people-1"],
      displays: { "r-people-1": "Ann" },
      colors: {},
    },
  };

  it("stands the ref table's displays over the enum and the row-link conditions (the pick commits the value)", () => {
    // The controlled stand: the payload lives in the test component's
    // state (the builder's `value` prop re-renders over the draft
    // changes).
    function Harness({ onPayload }: { onPayload: (next: DatabaseFilterPayload | null) => void }) {
      const [payload, setPayload] = useState<DatabaseFilterPayload | null>(null);
      return (
        <FilterBuilder
          value={payload}
          columns={[statusCol, ownerCol]}
          onChange={(next) => {
            setPayload(next);
            onPayload(next);
          }}
          refTableData={refTableData}
        />
      );
    }
    const payloads: (DatabaseFilterPayload | null)[] = [];
    render(<Harness onPayload={(next) => payloads.push(next)} />);
    // The empty filter stands no condition yet — the add-condition press
    // stands the first row (over the first column — the enum):
    // the value select stands the dict's options.
    fireEvent.click(document.querySelector<HTMLElement>("[data-slot='docblocks/filter-add-condition']")!);
    const condition = () => document.querySelector<HTMLElement>("[data-slot='docblocks/filter-condition']")!;
    expect(condition().getAttribute("data-column-id")).toBe("status");
    const valueSelect = () => condition().querySelector<HTMLSelectElement>("[data-slot='docblocks/filter-value']")!;
    expect([...valueSelect().options].map((entry) => entry.value)).toEqual(["", "todo", "done"]);

    // The row-link's condition stands the linked table's rows over the
    // displays (the join over the bridge), the pick commits the row id.
    fireEvent.change(condition().querySelector<HTMLSelectElement>("[data-slot='docblocks/filter-column']")!, {
      target: { value: "owner" },
    });
    expect(condition().getAttribute("data-column-id")).toBe("owner");
    const ownerSelect = condition().querySelector<HTMLSelectElement>("[data-slot='docblocks/filter-value']")!;
    expect([...ownerSelect.options].map((entry) => `${entry.value}|${entry.textContent}`)).toEqual([
      "|—",
      "r-people-1|Ann",
    ]);
    fireEvent.change(ownerSelect, { target: { value: "r-people-1" } });
    expect(payloads.at(-1)?.conditions[0]?.value).toBe("r-people-1");
  });
});

describe("the filter builder — the date's and datetime's value's pickers (the shared DatePicker / DateTimePicker over the wire's ISO stand)", () => {
  const dueCol: BridgeColumn = { id: "due", name: "Due", type: "date" };
  const startedCol: BridgeColumn = { id: "started", name: "Started", type: "timestamptz" };

  // The calendar's default month stands "today" (react-day-picker's
  // `dateLib.today()`) — the system time stands pinned to a fixed
  // October 2026 date (the same stand as the calendar's suite), so the
  // day cells the test targets stand in the displayed month regardless
  // of the run date. The timers the portal's poll leans on stay real.
  beforeAll(() => {
    vi.useFakeTimers({
      toNotFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "setImmediate", "clearImmediate"],
    });
    vi.setSystemTime(new Date(2026, 9, 1));
  });
  afterAll(() => {
    vi.useRealTimers();
  });
  afterEach(() => cleanup());

  // Polls a predicate over the act-flushed frames (the portal's mount —
  // the same stand as the calendar's suite's).
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

  it("stands the pickers over the native inputs (the day pick commits the ISO date; the datetime's time stands the THH:MM part)", async () => {
    // The controlled stand: the payload lives in the harness's state (the
    // builder's `value` prop re-renders over the draft changes).
    function Harness({ onPayload }: { onPayload: (next: DatabaseFilterPayload | null) => void }) {
      const [payload, setPayload] = useState<DatabaseFilterPayload | null>(null);
      return (
        <FilterBuilder
          value={payload}
          columns={[dueCol, startedCol]}
          onChange={(next) => {
            setPayload(next);
            onPayload(next);
          }}
        />
      );
    }
    const payloads: (DatabaseFilterPayload | null)[] = [];
    render(<Harness onPayload={(next) => payloads.push(next)} />);
    fireEvent.click(document.querySelector<HTMLElement>("[data-slot='docblocks/filter-add-condition']")!);
    const condition = () => document.querySelector<HTMLElement>("[data-slot='docblocks/filter-condition']")!;
    expect(condition().getAttribute("data-column-id")).toBe("due");

    // The value slot stands the picker's trigger (the button) — the
    // native's `<input type="date">` / `<input type="datetime-local">`
    // stands are gone.
    const valueTrigger = () => condition().querySelector<HTMLElement>("[data-slot='docblocks/filter-value']")!;
    expect(valueTrigger().tagName).toBe("BUTTON");
    expect(condition().querySelector("input[type='date'], input[type='datetime-local']")).toBeNull();
    expect(valueTrigger().getAttribute("data-empty")).toBe("true");

    // The day pick commits the ISO date (the date-only wire's stand —
    // the picker closes on the pick, the immediate commit's contract).
    fireEvent.click(valueTrigger());
    const calendar = await poll(() => document.querySelector("[data-slot='calendar']"));
    expect(calendar).not.toBeNull();
    fireEvent.click(document.querySelector("button[data-day='10/20/2026']")!);
    expect(payloads.at(-1)?.conditions[0]?.value).toBe("2026-10-20");

    // The datetime's column stands the DateTimePicker (the calendar + the
    // time box): the day pick + the typed minutes commit on the Enter
    // (the picker's keys' stand), the "THH:MM" part stands over the wire.
    fireEvent.change(condition().querySelector<HTMLSelectElement>("[data-slot='docblocks/filter-column']")!, {
      target: { value: "started" },
    });
    expect(condition().getAttribute("data-column-id")).toBe("started");
    const dtTrigger = condition().querySelector<HTMLElement>("[data-slot='docblocks/filter-value']")!;
    expect(dtTrigger.tagName).toBe("BUTTON");
    fireEvent.click(dtTrigger);
    const dtCalendar = await poll(() => document.querySelector("[data-slot='calendar']"));
    expect(dtCalendar).not.toBeNull();
    expect(document.querySelector("[data-slot='time-segments']")).not.toBeNull();
    fireEvent.click(document.querySelector("button[data-day='10/5/2026']")!);
    const [, minutes] = [...document.querySelectorAll<HTMLInputElement>("[data-slot='time-segments'] input")];
    fireEvent.change(minutes!, { target: { value: "30" } });
    fireEvent.keyDown(document.querySelector("[data-slot='popover-content']")!, { key: "Enter", bubbles: true });
    expect(payloads.at(-1)?.conditions[0]?.value).toBe("2026-10-05T00:30");
  });
});

describe("the filter builder — the group's structure (the localized's logic, the group's card, the connector's line)", () => {
  const cols: BridgeColumn[] = [
    { id: "name", name: "Name", type: "text" },
    { id: "done", name: "Done", type: "checkbox" },
  ];

  function Harness({ payload }: { payload: DatabaseFilterPayload | null }) {
    const [draft, setDraft] = useState<DatabaseFilterPayload | null>(payload);
    return <FilterBuilder value={draft} columns={cols} onChange={setDraft} />;
  }

  it("stands the en's logic's labels + the group's numbered header + the connector's line (the en's default)", () => {
    render(
      <Harness
        payload={{
          logic: "and",
          conditions: [{ columnId: "name", op: "is", value: "x" }],
          groups: [{ logic: "or", conditions: [] }],
        }}
      />
    );
    // The logic's pills stand the catalog's labels (the hard-coded's "AND" /
    // "OR" stand stands the en's default only) — the top-level group's
    // selector (the first in the DOM; the nested's group stands its own).
    const logic = document.querySelector<HTMLElement>("[data-slot='docblocks/filter-logic']");
    expect([...logic!.querySelectorAll("button")].map((entry) => entry.textContent)).toEqual(["AND", "OR"]);
    // The nested's group stands the numbered's header + the remove's entry
    // (the former's "AND nested group"'s label stands none).
    expect(document.querySelector("[data-slot='docblocks/filter-group-header']")?.textContent).toBe("Group 1");
    expect(document.querySelector("[data-slot='docblocks/filter-remove-group']")).not.toBeNull();
    // Every body's item stands its share of the group's connector line (the
    // tick + the vertical's segment over the row / the card's gutter — the
    // direct children; the card's subtree's pill stands its own aria-hidden).
    const row = document.querySelector<HTMLElement>("[data-slot='docblocks/filter-condition']");
    expect(row?.querySelectorAll(":scope > span[aria-hidden]").length).toBe(2);
    const card = document.querySelector<HTMLElement>("[data-slot='docblocks/filter-nested']");
    expect(card?.querySelectorAll(":scope > span[aria-hidden]").length).toBe(2);
  });
  it("stands the ru's labels over the ru's locale (the logic's pills + the group's header)", () => {
    render(
      <DocblocksI18nProvider locale="ru">
        <Harness payload={{ logic: "and", conditions: [{ columnId: "done", op: "is" }], groups: [] }} />
      </DocblocksI18nProvider>
    );
    const ruLogic = document.querySelector<HTMLElement>("[data-slot='docblocks/filter-logic']");
    expect([...ruLogic!.querySelectorAll("button")].map((entry) => entry.textContent)).toEqual(["И", "ИЛИ"]);
  });
});
