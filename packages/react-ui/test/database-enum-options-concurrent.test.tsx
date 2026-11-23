// @vitest-environment jsdom
// The enum's options' mechanics — the concurrent add's stand over the open
// edit form: the commit's delete set is the form's prefill (the seen's set)
// minus the kept, so an option added concurrently over the open form
// (invisible to the user) survives the save; the user's own removal still
// stands over the commit.
import { createMemoryDatabaseBridge } from "@playground/memory-bridge";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { act } from "react";

import { createDoc } from "docblocks-core";

import { Editor } from "../src/Editor";
import { ENUM_OPTION_COLOR_COLUMN, ENUM_OPTION_NAME_COLUMN } from "../src/database/bridge";
import type { DatabaseBridge, MutationContext } from "../src/database/bridge";
import { newMutationContext } from "../src/database/use-database-table";
import { EditorProvider } from "../src/editor-provider";

const CREATED_AT = "2026-10-10T00:00:00.000Z";
type TestDoc = ReturnType<typeof createDoc>;

/** The write context (a fresh operation id per call). */
const ctx = (): MutationContext => newMutationContext();

/** Polls the condition over the settled frames (the radix portals settle async). */
async function until(condition: () => unknown | Promise<unknown>, label: string): Promise<void> {
  const deadline = Date.now() + 2000;
  for (;;) {
    if (await condition()) return;
    if (Date.now() > deadline) throw new Error(`timed out waiting for: ${label}`);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
    });
  }
}

interface EnumGrid {
  bridge: DatabaseBridge;
  enumTableId: string;
  nameCol: string;
  stageCol: string;
}

/** The grid on a fresh bridge: the main's table with the enum's column +
 *  the system's options table (the alpha / the beta rows). */
async function renderEnumGrid(): Promise<EnumGrid> {
  const bridge = createMemoryDatabaseBridge();
  const mainTable = (await bridge.createTable({ name: "Demo" }, ctx())).result.id;
  const enumTableId = (await bridge.createTable({ name: "Stages-enum", system: true }, ctx())).result.id;
  const nameCol = (
    await bridge.createColumn(
      enumTableId,
      { column: { name: ENUM_OPTION_NAME_COLUMN, type: "text", position: 0, nullable: true } },
      ctx()
    )
  ).result.id;
  await bridge.createColumn(
    enumTableId,
    { column: { name: ENUM_OPTION_COLOR_COLUMN, type: "text", position: 1, nullable: true } },
    ctx()
  );
  await bridge.batchRows(
    enumTableId,
    {
      ops: [
        { op: "create", row: { [nameCol]: "alpha" }, beforeRowId: null },
        { op: "create", row: { [nameCol]: "beta" }, beforeRowId: null },
      ],
    },
    ctx()
  );
  const stageCol = (
    await bridge.createColumn(
      mainTable,
      {
        column: {
          name: "Stage",
          type: "text",
          position: 0,
          nullable: true,
          reference: { kind: "enum", tableId: enumTableId, many: false },
        },
      },
      ctx()
    )
  ).result.id;
  const doc: TestDoc = createDoc({ id: "doc-1", createdAt: CREATED_AT });
  doc.insertBlock("database", { tableId: mainTable });
  render(
    <EditorProvider doc={doc} databaseBridge={bridge}>
      <Editor />
    </EditorProvider>
  );
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  return { bridge, enumTableId, nameCol, stageCol };
}

/** The option names over the system table's rows (the order's stand). */
async function optionNames(grid: EnumGrid): Promise<string[]> {
  const page = await grid.bridge.snapshotTable(grid.enumTableId, {});
  return page.page.rows.map((row) => (row.cells[grid.nameCol] as string) ?? "");
}

/** Opens the enum column's edit form (the header's menu's entry). */
async function openEditForm(grid: EnumGrid): Promise<void> {
  const header = () =>
    document.querySelector<HTMLElement>(
      `[data-slot='docblocks/database-header-cell'][data-column-id='${grid.stageCol}']`
    )!;
  const ellipsis = header().querySelector<HTMLElement>("[data-slot='docblocks/database-column-menu']")!;
  fireEvent.pointerDown(ellipsis, { clientX: 10, clientY: 5 });
  await until(
    () => document.querySelector("[data-slot='docblocks/database-column-edit-options']") !== null,
    "the edit entry"
  );
  fireEvent.click(document.querySelector<HTMLElement>("[data-slot='docblocks/database-column-edit-options']")!);
  await until(() => document.querySelector("[data-slot='docblocks/database-enum-options']") !== null, "the editor");
}

const optionInputs = () =>
  document.querySelectorAll<HTMLInputElement>("[data-slot='docblocks/database-enum-option-name']");

describe("the enum's options over the concurrent add (the seen's set's stand)", () => {
  afterEach(cleanup);
  it("an option added over the open form's prefill survives the save (the silent-loss's stand)", async () => {
    const grid = await renderEnumGrid();
    await until(async () => (await optionNames(grid)).length === 2, "the prefill's options");
    await openEditForm(grid);
    expect([...optionInputs()].map((input) => input.value)).toEqual(["alpha", "beta"]);
    // The concurrent add (the other client's commit over the system
    // table): the form's draft stands the prefill's options (the add is
    // invisible to the user — no re-prefill over the open form).
    await grid.bridge.batchRows(
      grid.enumTableId,
      { ops: [{ op: "create", row: { [grid.nameCol]: "zeta" }, beforeRowId: null }] },
      ctx()
    );
    // The save (the rename's diff — the user's own edit only).
    fireEvent.change(optionInputs()[0]!, { target: { value: "alfa" } });
    fireEvent.click(document.querySelector<HTMLElement>("[data-slot='docblocks/database-add-column-create']")!);
    await until(async () => (await optionNames(grid)).includes("alfa"), "the rename's commit");
    // The zeta stands (it is not in the seen's set — the delete set never
    // touches it); the rename landed.
    expect(await optionNames(grid)).toEqual(["alfa", "beta", "zeta"]);
  });

  it("the user's option's removal still stands over the save (the diff's stand)", async () => {
    const grid = await renderEnumGrid();
    await until(async () => (await optionNames(grid)).length === 2, "the prefill's options");
    await openEditForm(grid);
    expect([...optionInputs()].map((input) => input.value)).toEqual(["alpha", "beta"]);
    // The user's removal (the form's own affordance — the option WAS seen
    // over the prefill): the commit's delete set covers it.
    const deletes = document.querySelectorAll<HTMLElement>("[data-slot='docblocks/database-enum-option-delete']");
    fireEvent.click(deletes[1]!);
    expect([...optionInputs()].map((input) => input.value)).toEqual(["alpha"]);
    fireEvent.click(document.querySelector<HTMLElement>("[data-slot='docblocks/database-add-column-create']")!);
    await until(async () => (await optionNames(grid)).length === 1, "the removal's commit");
    expect(await optionNames(grid)).toEqual(["alpha"]);
  });
});
