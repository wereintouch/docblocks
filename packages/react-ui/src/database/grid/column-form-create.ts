/**
 * The column form's create commit (the button's press only): the name over
 * the input, the type-specific block over the draft; the ref's new-table
 * creation stands before the column's (the `createTable` → the `refTableId`
 * data). The enum stands its own hidden system table (the options' rows
 * over the `name` / the `color` columns — the table's name is derived over
 * the data table + the column's name, so the two tabs' seeds share one
 * table). The failures stand the form open (the retry is the form's own
 * create press) with the cause over the form's error line; the catalog
 * re-reads over the partial's stand.
 */
import type { BridgeColumn, DatabaseBridge } from "../bridge";
import { ENUM_OPTION_COLOR_COLUMN, ENUM_OPTION_NAME_COLUMN, toBridgeError } from "../bridge";
import { newMutationContext } from "../use-database-table";
import { NEW_TABLE_PICK } from "./constants";
import type { AddColumnFormDraft } from "./models";

interface ColumnFormCreateContext {
  bridge: DatabaseBridge;
  tableId: string;
  data: {
    table: { columns: readonly BridgeColumn[] } | null;
    addColumn(column: BridgeColumn): Promise<string>;
  };
  readColumnOrder: () => string[] | undefined;
  onViewChange: (patch: Record<string, unknown>) => void;
  bumpCatalogRefresh: () => void;
  /** The form's close (the commit's success stand). */
  close: () => void;
  /** The commit's failure message (the form's error line). */
  onError: (message: string) => void;
}

function commitColumnFormCreate(ctx: ColumnFormCreateContext, draft: AddColumnFormDraft): void {
  const { bridge, tableId, data, readColumnOrder, onViewChange, bumpCatalogRefresh, close, onError } = ctx;
  if (draft.name.trim() === "") return;
  const name = draft.name.trim();

  const commitRef = async (refTableId: string | undefined): Promise<void> => {
    const columnSuffix = String((data.table?.columns.length ?? 0) + 1);
    const column: BridgeColumn = { id: `col${columnSuffix}`, name, type: draft.type };
    if (draft.numberKind !== undefined) {
      column.thousands = draft.thousands;
      if (draft.prefix !== "") column.prefix = draft.prefix;
      if (draft.suffix !== "") column.suffix = draft.suffix;
      column.allowNegative = draft.allowNegative;
      if (draft.numberKind === "decimal") column.decimals = draft.decimals;
    }
    if (draft.refKind !== undefined) {
      column.refKind = draft.refKind;
      if (draft.refMany) column.refMany = true;
      column.refTableId = refTableId;
    }
    try {
      const liveColumnId = await data.addColumn(column);
      // The create commit keeps the view's column order complete: the
      // block's explicit `columnOrder` (a previous drag committed it)
      // stands the visible order, so the new column is appended to its
      // end over the bridge-assigned id (the draft's placeholder stands
      // the form's local only) — one `updateBlock` (the view attr, CRDT /
      // undo as the current ones). Read fresh over the stand: the enum's
      // commit runs in the async's tail, where the render-time
      // `columnOrder` prop stands stale. Without an explicit order the
      // bridge's schema order stands (the create appends to the end) and
      // the attr is left untouched.
      const currentOrder = readColumnOrder();
      if (currentOrder !== undefined) {
        onViewChange({ columnOrder: [...currentOrder, liveColumnId] });
      }
    } catch (error) {
      // The create's failure: the form stands open with the cause (the
      // retry is the form's own create press); the hook's operation
      // failure stands the hook's transient display.
      onError(toBridgeError(error).message);
      return;
    }
    close();
  };

  if (draft.refKind === "enum") {
    void (async () => {
      try {
        // The system table + its two named columns (the option's label +
        // the chip's color); the cell's keys stand the created columns'
        // ids (the bridge assigns them).
        const enumTableId = (
          await bridge.createTable(
            {
              name: `${tableId}-enum-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
              system: true,
            },
            newMutationContext()
          )
        ).result.id;
        const nameColumnId = (
          await bridge.createColumn(
            enumTableId,
            { column: { name: ENUM_OPTION_NAME_COLUMN, type: "text", position: 0, nullable: true } },
            newMutationContext()
          )
        ).result.id;
        const colorColumnId = (
          await bridge.createColumn(
            enumTableId,
            { column: { name: ENUM_OPTION_COLOR_COLUMN, type: "text", position: 1, nullable: true } },
            newMutationContext()
          )
        ).result.id;
        for (const option of draft.enumOptions ?? []) {
          if (option.name.trim() === "") continue;
          const cells: Record<string, unknown> = { [nameColumnId]: option.name.trim() };
          if (option.color !== null) cells[colorColumnId] = option.color;
          await bridge.batchRows(
            enumTableId,
            { ops: [{ op: "create", row: cells, beforeRowId: null }] },
            newMutationContext()
          );
        }
        bumpCatalogRefresh();
        await commitRef(enumTableId);
      } catch (error) {
        // The system table's create failure (the partial sequence — the
        // created rows over the failed column stand a residue): the form
        // stands open with the cause (the retry is the form's own press),
        // the catalog re-reads (the partial's stand).
        onError(toBridgeError(error).message);
        bumpCatalogRefresh();
      }
    })();
    return;
  }
  if (draft.refKind === undefined) {
    void commitRef(undefined);
    return;
  }
  if (draft.refPick === NEW_TABLE_PICK) {
    const tableName = draft.newTableName.trim();
    if (tableName === "") return;
    void (async () => {
      try {
        const newTableId = (await bridge.createTable({ name: tableName }, newMutationContext())).result.id;
        bumpCatalogRefresh();
        await commitRef(newTableId);
      } catch (error) {
        // The table's create failure: the form stands open with the cause
        // (the commit stands none — the retry is the form's own create
        // press).
        onError(toBridgeError(error).message);
      }
    })();
    return;
  }
  if (draft.refPick === "") return; // the ref stand is required
  void commitRef(draft.refPick);
}

export { commitColumnFormCreate };
export type { ColumnFormCreateContext };
