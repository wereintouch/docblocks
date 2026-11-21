// @vitest-environment jsdom
import { createMemoryDatabaseBridge } from "@playground/memory-bridge";
import { fireEvent, render } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { act } from "react";

import { createDoc } from "docblocks-core";

import { Editor } from "../src/Editor";
import type { BlockRendererMap } from "../src/blocks/renderers";
import type { DatabaseBridge, MutationContext } from "../src/database/bridge";
import { newMutationContext } from "../src/database/use-database-table";
import { EditorProvider } from "../src/editor-provider";

// the keyboard's selection spec — part 1 of 1.

// The radix Select drives the cell's pick through the pointer-capture API
// (setPointerCapture / hasPointerCapture), which jsdom does not implement.
// The stub keeps the open/pick gesture testable in the unit suite.
beforeAll(() => {
  Element.prototype.hasPointerCapture = vi.fn(() => false);
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
  Element.prototype.scrollIntoView = vi.fn();
});

const CREATED_AT = "2026-10-10T00:00:00.000Z";

type TestDoc = ReturnType<typeof createDoc>;

/** The write context (a fresh operation id per call). */
function ctx(): MutationContext {
  return newMutationContext();
}

/** Seeds the doc (prepare returns the database id), then renders provider + editor. */
function renderDoc(
  prepare: (doc: TestDoc) => string,
  renderers?: BlockRendererMap,
  bridge?: DatabaseBridge
): { doc: TestDoc; db: string } {
  const doc = createDoc({ id: "doc-1", createdAt: CREATED_AT });
  const db = prepare(doc);
  render(
    <EditorProvider doc={doc} blockRenderers={renderers} databaseBridge={bridge ?? getDefaultBridge()}>
      <Editor />
    </EditorProvider>
  );
  return { doc, db };
}

// A module-shared default bridge so the inline-form tests (which pass no
// bridge) share one instance; the external-form tests seed their own table
// on a fresh bridge to keep the assertions deterministic.
let defaultBridge: DatabaseBridge | null = null;
function getDefaultBridge(): DatabaseBridge {
  defaultBridge ??= createMemoryDatabaseBridge();
  return defaultBridge;
}

/** Waits for the grid's async load to settle (the ready / broken phase). */
async function settleGrid() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

/** The grid's seeded ids: the table, the enum's options table, the
 *  bridge-assigned column ids, and the option's row ids (the enum's cell
 *  value is the option's row id, the display stands the name's label). */
interface SeededGrid {
  bridge: ReturnType<typeof createMemoryDatabaseBridge>;
  tableId: string;
  statusesId: string;
  cols: { title: string; n: string; done: string; status: string };
  optionCols: { name: string; color: string };
  options: { todo: string; active: string; done: string };
}

/** Seeds the grid's tables over the bridge (the Demo table + the Statuses'
 *  option rows), returning the generated ids. */
async function seedGrid(bridge: ReturnType<typeof createMemoryDatabaseBridge>): Promise<SeededGrid> {
  const table = await bridge.createTable({ name: "Demo" }, ctx());
  const tableId = table.result.id;
  // The options' table (the option IS a row — the `name` / the `color`
  // columns stand the labels / the chip's colors over the cell's keys).
  const statuses = await bridge.createTable({ name: "Statuses" }, ctx());
  const statusesId = statuses.result.id;
  const optionName = await bridge.createColumn(
    statusesId,
    { column: { name: "name", type: "text", position: 0, nullable: true } },
    ctx()
  );
  const optionColor = await bridge.createColumn(
    statusesId,
    { column: { name: "color", type: "text", position: 1, nullable: true } },
    ctx()
  );
  const option = async (label: string): Promise<string> =>
    (
      await bridge.batchRows(
        statusesId,
        { ops: [{ op: "create", row: { [optionName.result.id]: label }, beforeRowId: null }] },
        ctx()
      )
    ).result.rows[0]!.id;
  const options = { todo: await option("todo"), active: await option("active"), done: await option("done") };
  const title = await bridge.createColumn(
    tableId,
    { column: { name: "Title", type: "text", position: 0, nullable: true } },
    ctx()
  );
  const n = await bridge.createColumn(
    tableId,
    { column: { name: "N", type: "integer", position: 1, nullable: true } },
    ctx()
  );
  const done = await bridge.createColumn(
    tableId,
    { column: { name: "Done", type: "boolean", position: 2, nullable: true } },
    ctx()
  );
  const status = await bridge.createColumn(
    tableId,
    {
      column: {
        name: "Status",
        type: "text",
        position: 3,
        nullable: true,
        reference: { kind: "enum", tableId: statusesId, many: false },
      },
    },
    ctx()
  );
  await bridge.batchRows(
    tableId,
    {
      ops: [
        {
          op: "create",
          row: {
            [title.result.id]: "a",
            [n.result.id]: 1,
            [done.result.id]: false,
            [status.result.id]: options.todo,
          },
          beforeRowId: null,
        },
        {
          op: "create",
          row: {
            [title.result.id]: "b",
            [n.result.id]: 2,
            [done.result.id]: true,
            [status.result.id]: options.active,
          },
          beforeRowId: null,
        },
      ],
    },
    ctx()
  );
  return {
    bridge,
    tableId,
    statusesId,
    cols: { title: title.result.id, n: n.result.id, done: done.result.id, status: status.result.id },
    optionCols: { name: optionName.result.id, color: optionColor.result.id },
    options,
  };
}

/** The grid on a fresh bridge (title / n / done / status; two rows). */
async function renderGrid(attrs: Record<string, unknown> = {}) {
  const bridge = createMemoryDatabaseBridge();
  const seeded = await seedGrid(bridge);
  const { doc, db } = renderDoc(
    (d) => d.insertBlock("database", { tableId: seeded.tableId, ...attrs }),
    undefined,
    bridge
  );
  await settleGrid();
  return { doc, db, ...seeded };
}

describe("the keyboard's selection (the arrows' slide + the shift+arrow's extension)", () => {
  const cellOf = (row: number, col: number) =>
    document.querySelector<HTMLElement>(`[data-slot='docblocks/database-cell'][data-row='${row}'][data-col='${col}']`);

  it("stands the single cell's move over the data cells (the grid's edge stands no move); the shift+arrow stands the region's extension over the anchor (the region's slide stands the shape)", async () => {
    await renderGrid(); // 4 columns x 2 rows
    const grid = document.querySelector<HTMLElement>("[data-slot='docblocks/database-grid']")!;
    const table = document.querySelector<HTMLElement>("[data-slot='docblocks/database-table']")!;
    const selected = () =>
      Array.from(grid.querySelectorAll<HTMLElement>("[data-slot='docblocks/database-cell'][data-selected='true']")).map(
        (el) => [Number(el.dataset.row), Number(el.dataset.col)]
      );
    const press = async (r: number, col: number) => {
      await act(async () => {
        fireEvent.pointerDown(cellOf(r, col)!, { button: 0, clientX: 10, clientY: 5 });
        fireEvent.pointerUp(cellOf(r, col)!, { clientX: 10, clientY: 5 });
      });
      await settleGrid();
    };
    const arrow = async (key: string, shift = false) => {
      await act(async () => {
        table.focus();
        fireEvent.keyDown(table, { key, shiftKey: shift, bubbles: true });
      });
      await settleGrid();
    };

    await press(0, 0);
    expect(selected()).toEqual([[0, 0]]);
    // The single cell's move: the arrow stands the next data cell.
    await arrow("ArrowRight");
    expect(selected()).toEqual([[0, 1]]);
    await arrow("ArrowDown");
    expect(selected()).toEqual([[1, 1]]);
    await arrow("ArrowLeft");
    expect(selected()).toEqual([[1, 0]]);
    // The grid's edge stands no move (the boundary stands the selection).
    await arrow("ArrowLeft");
    expect(selected()).toEqual([[1, 0]]);
    await arrow("ArrowUp");
    expect(selected()).toEqual([[0, 0]]);
    await arrow("ArrowUp");
    expect(selected()).toEqual([[0, 0]]);

    // The shift+arrow's region (the anchor stands, the cursor moves): the
    // 2x2 over the fill stand (no outline over the region's cells).
    await arrow("ArrowRight", true);
    expect(selected()).toEqual([
      [0, 0],
      [0, 1],
    ]);
    await arrow("ArrowDown", true);
    expect(selected()).toEqual([
      [0, 0],
      [0, 1],
      [1, 0],
      [1, 1],
    ]);
    const regionCell = cellOf(1, 1)!;
    expect(regionCell.classList.contains("bg-(--docblocks-canvas-selection-fill)")).toBe(true);
    expect(regionCell.classList.contains("outline-offset-[-1px]")).toBe(false);
    // The region's shrink: the cursor's move back over the anchor.
    await arrow("ArrowLeft", true);
    expect(selected()).toEqual([
      [0, 0],
      [1, 0],
    ]);
    // The region's slide (the shape stands): the column-0 pair slides
    // over the right.
    await arrow("ArrowRight");
    expect(selected()).toEqual([
      [0, 1],
      [1, 1],
    ]);
    // The region's slide stands the grid's edge clamp (no over-the-edge).
    await arrow("ArrowRight");
    await arrow("ArrowRight");
    await arrow("ArrowRight");
    expect(selected()).toEqual([
      [0, 3],
      [1, 3],
    ]);
    // The Escape stands the selection's clear (the grid's own gesture).
    await act(async () => {
      table.focus();
      fireEvent.keyDown(table, { key: "Escape", bubbles: true });
    });
    await settleGrid();
    expect(selected()).toEqual([]);
  });
});
