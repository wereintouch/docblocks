// @vitest-environment jsdom
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { act, useState } from "react";

import type { DatabaseFilterPayload } from "docblocks-core";

import type { BridgeColumn } from "../src/database/bridge";
import { FilterBuilder } from "../src/database/filter-builder";
import { DocblocksI18nProvider } from "../src/i18n";

// The filter's operator's picker spec: the popover's stand over the localized's
// labels (the wire's op as the payload's contract — the display label never
// reaches it, the pick clears the value over the existing behavior), the
// active option's mark, and the emptiness's checks over the default's catalogs.

// The radix's open gesture drives the portal's mount through the pointer API
// (setPointerCapture / hasPointerCapture), which jsdom does not implement.
// The stub keeps the open gesture testable in the unit suite.
beforeAll(() => {
  Element.prototype.hasPointerCapture = vi.fn(() => false);
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => cleanup());

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

// The en's labels stand the wire's op as-is (the unlocalized form — the
// current stand); the ru's stand the localized's form. The consumer's custom
// operator (the `operators` override) stands its raw form when the catalog
// has no label for it.
const EN_LABELS: Record<string, string> = {
  is: "is",
  "is not": "is not",
  "<": "<",
  "<=": "<=",
  ">": ">",
  ">=": ">=",
  between: "between",
  empty: "empty",
  "not empty": "not empty",
  contains: "contains",
  "not contains": "not contains",
  "starts with": "starts with",
  "ends with": "ends with",
  before: "before",
  after: "after",
  in: "in",
  "not in": "not in",
};
const RU_LABELS: Record<string, string> = {
  is: "равно",
  "is not": "не равно",
  "<": "меньше",
  "<=": "меньше или равно",
  ">": "больше",
  ">=": "больше или равно",
  between: "между",
  empty: "не заполнено",
  "not empty": "заполнено",
  contains: "содержит",
  "not contains": "не содержит",
  "starts with": "начинается с",
  "ends with": "завершается на",
  before: "ранее",
  after: "позднее",
  in: "в списке",
  "not in": "не в списке",
};

const NUMBER_OPERATORS = ["is", "is not", "<", "<=", ">", ">=", "between", "empty", "not empty"];
const TEXT_OPERATORS = ["is", "is not", "contains", "not contains", "starts with", "ends with", "empty", "not empty"];
const DATE_OPERATORS = ["is", "before", "after", "between", "empty", "not empty"];

/** The controlled harness: the payload lives in the harness's state (the
 *  builder's `value` prop re-renders over the draft's changes), one column. */
function renderHarness(column: BridgeColumn, initialOp: string, locale?: "ru") {
  function Harness() {
    const [payload, setPayload] = useState<DatabaseFilterPayload | null>({
      logic: "and",
      conditions: [{ columnId: column.id, op: initialOp }],
    });
    return <FilterBuilder value={payload} columns={[column]} onChange={setPayload} />;
  }
  return locale === "ru"
    ? render(
        <DocblocksI18nProvider locale="ru">
          <Harness />
        </DocblocksI18nProvider>
      )
    : render(<Harness />);
}

/** Opens the operator's picker and returns the option's reads. */
async function openPicker(column: BridgeColumn, initialOp: string, locale?: "ru") {
  const view = renderHarness(column, initialOp, locale);
  const trigger = () => document.querySelector<HTMLElement>("[data-slot='docblocks/filter-operator']")!;
  const triggerLabel = trigger().textContent ?? "";
  fireEvent.click(trigger());
  await poll(() => (document.querySelector("[data-slot='docblocks/filter-operator-option']") !== null ? true : null));
  const options = () =>
    new Map(
      [...document.querySelectorAll<HTMLElement>("[data-slot='docblocks/filter-operator-option']")].map((entry) => [
        entry.dataset.operator ?? "",
        entry.textContent ?? "",
      ])
    );
  return {
    view,
    trigger,
    triggerLabel,
    options,
    unmount: () => view.unmount(),
  };
}

describe("the filter's operator's picker (the popover's stand over the localized's labels)", () => {
  const amountCol: BridgeColumn = { id: "amount", name: "Amount", type: "integer" };

  function Harness({ onPayload }: { onPayload: (next: DatabaseFilterPayload | null) => void }) {
    const [payload, setPayload] = useState<DatabaseFilterPayload | null>({
      logic: "and",
      conditions: [{ columnId: amountCol.id, op: "is", value: 5 }],
    });
    return (
      <FilterBuilder
        value={payload}
        columns={[amountCol]}
        onChange={(next) => {
          setPayload(next);
          onPayload(next);
        }}
      />
    );
  }

  it("stands the trigger's label; the pick commits the wire's op over the value's clear (the valueless's hide)", async () => {
    const payloads: (DatabaseFilterPayload | null)[] = [];
    render(<Harness onPayload={(next) => payloads.push(next)} />);
    const trigger = () => document.querySelector<HTMLElement>("[data-slot='docblocks/filter-operator']")!;
    // The trigger stands the button (the picker's stand) over the selected's label.
    expect(trigger().tagName).toBe("BUTTON");
    expect(trigger().textContent).toBe("is");
    expect(trigger().getAttribute("data-operator")).toBe("is");

    // The open stands the catalog's list over its order (the number's
    // operators), the active option marked.
    fireEvent.click(trigger());
    await poll(() => (document.querySelector("[data-slot='docblocks/filter-operator-option']") !== null ? true : null));
    const option = (op: string) =>
      document.querySelector<HTMLElement>(`[data-slot='docblocks/filter-operator-option'][data-operator='${op}']`)!;
    expect(
      [...document.querySelectorAll<HTMLElement>("[data-slot='docblocks/filter-operator-option']")].map(
        (entry) => entry.dataset.operator
      )
    ).toEqual(NUMBER_OPERATORS);
    // The keyboard's access stands the option's button (the native Tab / Enter's reach).
    for (const entry of document.querySelectorAll<HTMLElement>("[data-slot='docblocks/filter-operator-option']")) {
      expect(entry.tagName).toBe("BUTTON");
      expect(entry.textContent).toBe(EN_LABELS[entry.dataset.operator ?? ""]);
    }
    expect(option("is").getAttribute("data-active")).toBe("true");
    expect(option("not empty").getAttribute("data-active")).toBeNull();

    // The pick commits the wire's op + the value's clear (the existing's contract).
    fireEvent.click(option("not empty"));
    expect(payloads.at(-1)?.conditions[0]?.op).toBe("not empty");
    expect(payloads.at(-1)?.conditions[0]?.value).toBeUndefined();
    // The popover's close + the trigger's label's follow; the valueless's op
    // hides the value's input (the row's stand over the annotation).
    await poll(() => (document.querySelector("[data-slot='docblocks/filter-operator-option']") === null ? true : null));
    expect(trigger().textContent).toBe("not empty");
    expect(document.querySelector("[data-slot='docblocks/filter-value']")).toBeNull();
  });

  it("stands the Escape's no-pick (the close commits none)", async () => {
    const payloads: (DatabaseFilterPayload | null)[] = [];
    render(<Harness onPayload={(next) => payloads.push(next)} />);
    const trigger = () => document.querySelector<HTMLElement>("[data-slot='docblocks/filter-operator']")!;
    const before = payloads.length;
    fireEvent.click(trigger());
    await poll(() => (document.querySelector("[data-slot='docblocks/filter-operator-option']") !== null ? true : null));
    fireEvent.keyDown(document.querySelector("[data-slot='popover-content']")!, { key: "Escape", bubbles: true });
    await poll(() => (document.querySelector("[data-slot='docblocks/filter-operator-option']") === null ? true : null));
    expect(payloads.length).toBe(before);
    expect(trigger().getAttribute("data-operator")).toBe("is");
  });

  it("stands the en's labels over the default's catalogs (the wire's op as-is; the custom's op stands its raw form)", async () => {
    const cases: [BridgeColumn, string, string[]][] = [
      [{ id: "amount", name: "Amount", type: "integer" }, "is", NUMBER_OPERATORS],
      [{ id: "name", name: "Name", type: "text" }, "contains", TEXT_OPERATORS],
      [{ id: "due", name: "Due", type: "date" }, "before", DATE_OPERATORS],
      // The consumer's override stands the catalog (the `gt`'s raw form —
      // the absent label's stand).
      [{ id: "tag", name: "Tag", type: "text", operators: ["in", "not in", "gt"] }, "in", ["in", "not in", "gt"]],
    ];
    for (const [column, initialOp, expectedOperators] of cases) {
      const { triggerLabel, options, unmount } = await openPicker(column, initialOp);
      expect(triggerLabel).toBe(EN_LABELS[initialOp] ?? initialOp);
      expect([...options().entries()].map(([op]) => op)).toEqual(expectedOperators);
      for (const [op, label] of options()) {
        expect(label, `the en's label over ${op}`).toBe(EN_LABELS[op] ?? op);
      }
      unmount();
    }
  });

  it("stands the ru's labels over the ru's locale (the localized's form; the custom's op stands its raw form)", async () => {
    const cases: [BridgeColumn, string, string[]][] = [
      [{ id: "amount", name: "Amount", type: "integer" }, "is", NUMBER_OPERATORS],
      [{ id: "name", name: "Name", type: "text" }, "contains", TEXT_OPERATORS],
      [{ id: "due", name: "Due", type: "date" }, "before", DATE_OPERATORS],
      [{ id: "tag", name: "Tag", type: "text", operators: ["in", "not in", "gt"] }, "in", ["in", "not in", "gt"]],
    ];
    for (const [column, initialOp, expectedOperators] of cases) {
      const { triggerLabel, options, unmount } = await openPicker(column, initialOp, "ru");
      expect(triggerLabel).toBe(RU_LABELS[initialOp] ?? initialOp);
      expect([...options().entries()].map(([op]) => op)).toEqual(expectedOperators);
      for (const [op, label] of options()) {
        expect(label, `the ru's label over ${op}`).toBe(RU_LABELS[op] ?? op);
      }
      unmount();
    }
  });
});

describe("the operator's catalog (the emptiness's checks stand over the default's types + the ref's single)", () => {
  it("exposes empty / not empty over the number / date / datetime / time / boolean + the enum / row's single", async () => {
    const columns: BridgeColumn[] = [
      { id: "amount", name: "Amount", type: "integer" },
      { id: "due", name: "Due", type: "date" },
      { id: "started", name: "Started", type: "timestamptz" },
      { id: "time", name: "Time", type: "time" },
      { id: "done", name: "Done", type: "boolean" },
      { id: "status", name: "Status", type: "text", refKind: "enum", refTableId: "t-status" },
      { id: "owner", name: "Owner", type: "text", refKind: "row", refTableId: "t-people" },
    ];
    for (const column of columns) {
      const { options, unmount } = await openPicker(column, "is");
      const operators = [...options().keys()];
      expect(operators, `the catalog over ${column.type} / ${column.refKind ?? "plain"}`).toContain("empty");
      expect(operators, `the catalog over ${column.type} / ${column.refKind ?? "plain"}`).toContain("not empty");
      unmount();
    }
  });

  it("keeps the multi ref's catalog (the emptiness's stand over the many's cardinality)", async () => {
    const { options, unmount } = await openPicker(
      { id: "tags", name: "Tags", type: "text", refKind: "enum", refTableId: "t-tags", refMany: true },
      "is"
    );
    expect([...options().keys()]).toEqual(["is", "is not", "empty", "not empty"]);
    unmount();
  });
});
