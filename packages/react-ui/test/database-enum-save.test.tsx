// @vitest-environment jsdom
import { createMemoryDatabaseBridge } from "@playground/memory-bridge";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { DatabaseTable } from "../src";
import type { DatabaseBridge, MutationContext } from "../src";
import { newMutationContext } from "../src/database/use-database-table";

/**
 * The enum column's options form over the bridge's refusals: the delete of
 * an option a live cell references stands the bridge's `enum.option_in_use`
 * rejection, and the form surfaces the cause instead of swallowing it.
 */

// The radix primitives drive the grid's interactions through the
// pointer-capture API, which jsdom does not implement.
beforeAll(() => {
  Element.prototype.hasPointerCapture = vi.fn(() => false);
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => cleanup());

function ctx(): MutationContext {
  return newMutationContext();
}

interface SeededEnumGrid {
  bridge: DatabaseBridge;
  tableId: string;
  statusesId: string;
  statusColumnId: string;
  optionIds: string[];
}

/** Seeds the grid's table over the bridge: the title + the enum status
 *  column over a `Statuses` options table, one row referencing the first
 *  option (the in-use stand). */
async function seedEnumGrid(): Promise<SeededEnumGrid> {
  const bridge = createMemoryDatabaseBridge();
  const tableId = (await bridge.createTable({ name: "Tasks" }, ctx())).result.id;
  const statusesId = (await bridge.createTable({ name: "Statuses" }, ctx())).result.id;
  const optionName = (
    await bridge.createColumn(
      statusesId,
      { column: { name: "name", type: "text", position: 0, nullable: true } },
      ctx()
    )
  ).result.id;
  const optionIds: string[] = [];
  for (const label of ["todo", "active"]) {
    const receipt = await bridge.batchRows(
      statusesId,
      { ops: [{ op: "create", row: { [optionName]: label }, beforeRowId: null }] },
      ctx()
    );
    optionIds.push(receipt.result.rows[0]!.id);
  }
  const title = (
    await bridge.createColumn(tableId, { column: { name: "Title", type: "text", position: 0, nullable: true } }, ctx())
  ).result.id;
  const status = (
    await bridge.createColumn(
      tableId,
      {
        column: {
          name: "Status",
          type: "text",
          position: 1,
          nullable: true,
          reference: { kind: "enum", tableId: statusesId, many: false },
        },
      },
      ctx()
    )
  ).result.id;
  await bridge.batchRows(
    tableId,
    { ops: [{ op: "create", row: { [title]: "a", [status]: optionIds[0] }, beforeRowId: null }] },
    ctx()
  );
  return { bridge, tableId, statusesId, statusColumnId: status, optionIds };
}

/** The options table's labels in the stored row order. */
async function optionLabels(bridge: DatabaseBridge, tableId: string): Promise<string[]> {
  const page = await bridge.snapshotTable(tableId, {});
  return page.page.rows.map((row) => String(Object.values(row.cells)[0]));
}

describe("the enum column's options form over the bridge's refusal", () => {
  it("the delete of an in-use option stands the visible cause over the unchanged options", async () => {
    const { bridge, tableId, statusesId, statusColumnId, optionIds } = await seedEnumGrid();
    render(<DatabaseTable bridge={bridge} tableId={tableId} />);
    await waitFor(() =>
      expect(
        document.querySelector(`[data-column-id="${statusColumnId}"] [data-slot="docblocks/database-column-menu"]`)
      ).not.toBeNull()
    );

    // The enum column's menu → the options' form (the header's own press
    // stands the menu).
    fireEvent.pointerDown(
      document.querySelector<HTMLElement>(
        `[data-column-id="${statusColumnId}"] [data-slot="docblocks/database-column-menu"]`
      )!,
      { clientX: 10, clientY: 5 }
    );
    await waitFor(() =>
      expect(document.querySelector("[data-slot='docblocks/database-column-edit-options']")).not.toBeNull()
    );
    fireEvent.click(document.querySelector<HTMLElement>("[data-slot='docblocks/database-column-edit-options']")!);
    await waitFor(() =>
      expect(document.querySelector("[data-slot='docblocks/database-add-column-form']")).not.toBeNull()
    );

    // The referenced option's removal over the draft.
    const inUseRow = [
      ...document.querySelectorAll<HTMLElement>("[data-slot='docblocks/database-enum-option-row']"),
    ].find(
      (row) =>
        row.querySelector<HTMLInputElement>("[data-slot='docblocks/database-enum-option-name']")?.value === "todo"
    )!;
    fireEvent.click(inUseRow.querySelector<HTMLElement>("[data-slot='docblocks/database-enum-option-delete']")!);
    fireEvent.click(document.querySelector<HTMLElement>("[data-slot='docblocks/database-add-column-create']")!);

    // The rejection stands the form open with the cause; the options and
    // the cell keep their values.
    const error = await waitFor(() => {
      const node = document.querySelector<HTMLElement>("[data-slot='docblocks/database-add-column-error']");
      expect(node).not.toBeNull();
      return node!;
    });
    expect(error.textContent).toContain(optionIds[0]!);
    expect(document.querySelector("[data-slot='docblocks/database-add-column-form']")).not.toBeNull();
    expect(await optionLabels(bridge, statusesId)).toEqual(["todo", "active"]);
  });
});
