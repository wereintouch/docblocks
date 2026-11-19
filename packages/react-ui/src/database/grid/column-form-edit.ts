/**
 * The column form's edit commit (the enum's options over the existing
 * system table): the diff over the table's current rows (the matched's
 * name / color's updates, the removed's removals, the added's inserts, the
 * order's stand over the `moveRow`'s ops) + the column's name over the
 * `renameColumn` (the undo entry's stand). The bridge's calls stand direct
 * (the system table's rows keep no per-block undo — the create form's
 * table-creation contract). The commit's failure stands the form open (the
 * retry is the form's own save press) + the catalog's re-read (the
 * partial's stand).
 */
import type { BatchOp, BridgeColumn, DatabaseBridge } from "../bridge";
import { ENUM_OPTION_COLOR_COLUMN, ENUM_OPTION_NAME_COLUMN } from "../bridge";
import { newMutationContext } from "../use-database-table";
import type { AddColumnFormDraft } from "./models";
import { loadFullPages } from "./use-ref-tables";

interface ColumnFormEditContext {
  bridge: DatabaseBridge;
  data: {
    table: { columns: readonly BridgeColumn[] } | null;
    renameColumn(columnId: string, name: string): Promise<void>;
    capabilities: readonly string[];
  };
  bumpCatalogRefresh: () => void;
  /** The form's close (the commit's success stand). */
  close: () => void;
}

function commitColumnFormEdit(ctx: ColumnFormEditContext, draft: AddColumnFormDraft): void {
  const { bridge, data, bumpCatalogRefresh, close } = ctx;
  const columnId = draft.editColumnId;
  const refTableId = draft.refPick;
  const column = data.table?.columns.find((entry) => entry.id === columnId);
  if (columnId === undefined || refTableId === "" || column === undefined) return;
  void (async () => {
    try {
      // The option's columns stand by their names (the bridge assigns
      // the ids); the cell's keys read the ids. The full page set's
      // stand (the cursor's continuation to the tail): the single
      // page's limit would truncate the catalog over 200 options (the
      // diff's delete set over the truncated rows stands the
      // silent-ignored delete of the truncated option).
      const pageSet = await loadFullPages(bridge, refTableId);
      // The partial page set (the cursor's churn over the retry bound):
      // the diff's delete set over the truncated rows stands no stand —
      // the commit stands none (the retry is the form's own press, the
      // refresh re-reads the full set).
      if (pageSet === null) throw new Error("the catalog's page set stood partial over the cursor's churn");
      const snapshot = pageSet;
      const nameColumnId = snapshot.columns.find((entry) => entry.name === ENUM_OPTION_NAME_COLUMN)?.id;
      const colorColumnId = snapshot.columns.find((entry) => entry.name === ENUM_OPTION_COLOR_COLUMN)?.id;
      const current: { rowId: string; name: string; color: string | null }[] = snapshot.rows.map((row) => ({
        rowId: row.id,
        name:
          nameColumnId !== undefined && typeof row.cells[nameColumnId] === "string"
            ? (row.cells[nameColumnId] as string)
            : row.id,
        color:
          colorColumnId !== undefined && typeof row.cells[colorColumnId] === "string"
            ? (row.cells[colorColumnId] as string)
            : null,
      }));
      const draftOptions = (draft.enumOptions ?? []).filter((option) => option.name.trim() !== "");
      const keptRowIds = new Set<string>();
      const cellOf = (option: { rowId?: string; name: string; color: string | null }): Record<string, unknown> => {
        const cells: Record<string, unknown> = {};
        if (nameColumnId !== undefined) cells[nameColumnId] = option.name.trim();
        if (option.color !== null && colorColumnId !== undefined) cells[colorColumnId] = option.color;
        return cells;
      };
      // The mixed-batch stand (the negotiated capability): the creates /
      // the updates / the deletes stand ONE commit (the atomic stand —
      // the sequential calls stood the partial commit over the mid-list
      // failure); the moves stand the second commit (the created ids are
      // known only over the first receipt — the static batch stands no
      // reference to them). The absent capability stands the sequential
      // stand (the legacy's non-atomic stand).
      let createdIds: string[] = [];
      if (data.capabilities.includes("mixedBatch")) {
        const ops: BatchOp[] = [];
        for (const option of draftOptions) {
          if (option.rowId === undefined) {
            ops.push({ op: "create", row: cellOf(option), beforeRowId: null });
            continue;
          }
          keptRowIds.add(option.rowId);
          const before = current.find((entry) => entry.rowId === option.rowId);
          if (before === undefined) continue;
          const cells: Record<string, unknown> = {};
          if (before.name !== option.name.trim() && nameColumnId !== undefined)
            cells[nameColumnId] = option.name.trim();
          if (before.color !== (option.color ?? null) && colorColumnId !== undefined) {
            cells[colorColumnId] = option.color;
          }
          if (Object.keys(cells).length > 0) {
            ops.push({ op: "update", rowId: option.rowId, cells });
          }
        }
        for (const entry of current) {
          if (!keptRowIds.has(entry.rowId)) ops.push({ op: "delete", rowId: entry.rowId });
        }
        if (ops.length > 0) {
          const created = await bridge.batchRows(refTableId, { ops }, newMutationContext());
          // The receipt's rows stand the created rows over the create
          // op's order (the draft order over the new options).
          createdIds = created.result.rows.map((row) => row.id);
        }
      } else {
        const addedRowIds: string[] = [];
        for (const option of draftOptions) {
          if (option.rowId === undefined) {
            const created = await bridge.batchRows(
              refTableId,
              { ops: [{ op: "create", row: cellOf(option), beforeRowId: null }] },
              newMutationContext()
            );
            addedRowIds.push(created.result.rows[0]!.id);
            continue;
          }
          keptRowIds.add(option.rowId);
          const before = current.find((entry) => entry.rowId === option.rowId);
          if (before === undefined) continue;
          const cells: Record<string, unknown> = {};
          if (before.name !== option.name.trim() && nameColumnId !== undefined)
            cells[nameColumnId] = option.name.trim();
          if (before.color !== (option.color ?? null) && colorColumnId !== undefined) {
            cells[colorColumnId] = option.color;
          }
          if (Object.keys(cells).length > 0) {
            await bridge.batchRows(
              refTableId,
              { ops: [{ op: "update", rowId: option.rowId, cells }] },
              newMutationContext()
            );
          }
        }
        for (const entry of current) {
          if (!keptRowIds.has(entry.rowId)) {
            await bridge.batchRows(refTableId, { ops: [{ op: "delete", rowId: entry.rowId }] }, newMutationContext());
          }
        }
        createdIds = addedRowIds;
      }
      // The order's stand (the draft order over the kept + the created):
      // the single batch's moves (the one commit — the no-op pair stands
      // the skip over the bridge's stand). The created id's index stands
      // the new option's own order (the draft's position over the mixed
      // kept / new list is not the created's index).
      let addedIndex = 0;
      const orderedIds = draftOptions.map((option) => option.rowId ?? createdIds[addedIndex++]);
      const moveOps: BatchOp[] = [];
      for (let i = 0; i < orderedIds.length - 1; i++) {
        const rowId = orderedIds[i];
        const beforeRowId = orderedIds[i + 1];
        if (rowId === undefined || beforeRowId === undefined) continue;
        moveOps.push({ op: "move", rowId, beforeRowId });
      }
      if (moveOps.length > 0) {
        await bridge.batchRows(refTableId, { ops: moveOps }, newMutationContext());
      }
      if (column.name !== draft.name.trim()) await data.renameColumn(columnId, draft.name.trim());
      close();
    } catch (error) {
      // The commit's failure: the form stands open (the retry is the
      // form's own save press); the partial's stand (the mixed batch's
      // atomic commit + the move's second commit) re-reads the catalog
      // (the move over the failed batch stands applied), the error
      // stands the log.
      console.error("docblocks: the column's enum commit failed — the catalog re-reads", error);
      bumpCatalogRefresh();
    }
  })();
}

export { commitColumnFormEdit };
export type { ColumnFormEditContext };
