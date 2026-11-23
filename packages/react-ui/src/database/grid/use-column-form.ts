/**
 * The add-column form's state session: the draft (the create / the edit's
 * stand — the edit's prefill from the column + the ref table's data), the
 * open's stand (the close drops the draft — the next open stands a fresh
 * one), the field updaters (each patches its own key), the table catalog
 * (the ref form's pick list; the new-table creation stands the fresh
 * catalog over the refresh bump), and the create / edit commits (the
 * button's press only — the outside press / the Escape close without the
 * commit).
 */
import { useCallback, useState } from "react";

import type { BridgeColumn, DatabaseBridge } from "../bridge";
import { useDatabaseTable } from "../use-database-table";
import { commitColumnFormCreate } from "./column-form-create";
import { commitColumnFormEdit } from "./column-form-edit";
import { REF_NONE_PICK } from "./constants";
import type { AddColumnFormDraft, AddColumnTypeEntry, EnumOptionDraft } from "./models";
import { useBridgeTables } from "./use-bridge-tables";
import type { RefTableDataMap } from "./use-ref-tables";
import { refEntryKey } from "./use-ref-tables";
import { emptyColumnForm } from "./utils";

interface UseColumnFormContext {
  bridge: DatabaseBridge;
  tableId: string;
  data: ReturnType<typeof useDatabaseTable>;
  refTableData: RefTableDataMap;
  readColumnOrder: () => string[] | undefined;
  onViewChange: (patch: Record<string, unknown>) => void;
}

function useColumnForm({ bridge, tableId, data, refTableData, readColumnOrder, onViewChange }: UseColumnFormContext) {
  const [addingColumn, setAddingColumn] = useState(false);
  const [columnFormOpen, setColumnFormOpen] = useState(false);
  const [columnForm, setColumnForm] = useState<AddColumnFormDraft | null>(null);
  // The commit's failure (the form stands open with the cause over its
  // error line; a fresh open / the next commit clears it).
  const [columnFormError, setColumnFormError] = useState<string | null>(null);
  // The form's type-specific block stand (the catalog's flag — the number's
  // display attributes / the ref table's pick over the name).
  const columnFormNumber = columnForm?.numberKind !== undefined;
  const columnFormRef = columnForm?.refKind !== undefined;
  // The table catalog (the ref form's pick list; the new-table creation
  // stands the fresh catalog over the refresh bump).
  const [catalogRefresh, setCatalogRefresh] = useState(0);
  const bridgeTables = useBridgeTables(bridge, catalogRefresh);
  const bumpCatalogRefresh = useCallback(() => setCatalogRefresh((key) => key + 1), []);

  const close = useCallback(() => {
    setColumnFormOpen(false);
    setColumnForm(null);
    setColumnFormError(null);
  }, []);

  /** The form's create commit (the button's press only): the edit stands
   *  the enum's options' commit (the existing system table's diff), the
   *  rest stands the column's create over the type-specific block. */
  const commitColumnForm = () => {
    const draft = columnForm;
    if (draft === null || draft.name.trim() === "") return;
    setColumnFormError(null);
    if (draft.editColumnId !== undefined) {
      commitColumnFormEdit({ bridge, data, bumpCatalogRefresh, close, onError: setColumnFormError }, draft);
      return;
    }
    commitColumnFormCreate(
      { bridge, tableId, data, readColumnOrder, onViewChange, bumpCatalogRefresh, close, onError: setColumnFormError },
      draft
    );
  };

  /** The create form's entry press (the menu's pick): every entry stands
   *  the create form (the name input + the type-specific block over it) —
   *  the create commits on the form's button only. */
  const openCreateForm = (entry: AddColumnTypeEntry) => {
    setColumnForm(emptyColumnForm(entry));
    setAddingColumn(false);
    setColumnFormError(null);
    setColumnFormOpen(true);
  };

  /** The edit form's open (the enum's options over the column's system
   *  table): the draft prefills from the column + the ref table's data
   *  (the row order's stand, the `name`'s display, the `color`'s hex). */
  const openColumnFormEdit = (column: BridgeColumn) => {
    if (column.refKind !== "enum" || column.refTableId === undefined) return;
    const refData = refTableData[refEntryKey({ tableId: column.refTableId, displayColumn: column.refDisplayColumn })];
    const options = (refData?.rowIds ?? []).map((rowId) => ({
      rowId,
      name: refData?.displays[rowId] ?? rowId,
      color: refData?.colors[rowId] ?? null,
    }));
    setColumnForm({
      key: column.id,
      type: "enum",
      name: column.name,
      decimals: 0,
      thousands: false,
      prefix: "",
      suffix: "",
      allowNegative: true,
      refKind: "enum",
      refMany: column.refMany === true,
      refPick: column.refTableId,
      newTableName: "",
      enumOptions: options,
      // The seen's set (the form's open's snapshot): the commit's delete
      // set never touches an option added concurrently over the open
      // form (the user never saw it — the silent-loss's stand).
      enumSeenRowIds: options.map((option) => option.rowId),
      editColumnId: column.id,
    });
    setColumnFormError(null);
    setColumnFormOpen(true);
  };

  /** The form's open's stand: the close (the outside press / the Escape)
   *  drops the draft — the next open stands a fresh one. */
  const onColumnFormOpenChange = (open: boolean) => {
    setColumnFormOpen(open);
    if (!open) {
      setColumnForm(null);
      setColumnFormError(null);
    }
  };

  /** The form's field updaters (each patches its own key; the draft's
   *  absence is a no-op — the form's open stand sets it). */
  const patchColumnForm = (patch: Partial<AddColumnFormDraft>) => {
    setColumnForm((draft) => (draft === null ? draft : { ...draft, ...patch }));
  };
  const onColumnNameChange = (event: React.ChangeEvent<HTMLInputElement>) =>
    patchColumnForm({ name: event.target.value });
  const onColumnDecimalsChange = (event: React.ChangeEvent<HTMLInputElement>) =>
    patchColumnForm({ decimals: Number(event.target.value) || 0 });
  const onColumnThousandsChange = (checked: boolean | "indeterminate") =>
    patchColumnForm({ thousands: checked === true });
  const onColumnPrefixChange = (event: React.ChangeEvent<HTMLInputElement>) =>
    patchColumnForm({ prefix: event.target.value });
  const onColumnSuffixChange = (event: React.ChangeEvent<HTMLInputElement>) =>
    patchColumnForm({ suffix: event.target.value });
  const onColumnAllowNegativeChange = (checked: boolean | "indeterminate") =>
    patchColumnForm({ allowNegative: checked === true });
  const onColumnEnumOptionsChange = (next: EnumOptionDraft[]) => patchColumnForm({ enumOptions: next });
  const onColumnRefPickChange = (next: string) =>
    patchColumnForm({ refPick: next === REF_NONE_PICK ? "" : next, newTableName: "" });
  const onColumnNewTableNameChange = (event: React.ChangeEvent<HTMLInputElement>) =>
    patchColumnForm({ newTableName: event.target.value });

  return {
    addingColumn,
    setAddingColumn,
    columnFormOpen,
    columnForm,
    columnFormError,
    columnFormNumber,
    columnFormRef,
    bridgeTables,
    commitColumnForm,
    openCreateForm,
    openColumnFormEdit,
    onColumnFormOpenChange,
    onColumnNameChange,
    onColumnDecimalsChange,
    onColumnThousandsChange,
    onColumnPrefixChange,
    onColumnSuffixChange,
    onColumnAllowNegativeChange,
    onColumnEnumOptionsChange,
    onColumnRefPickChange,
    onColumnNewTableNameChange,
  };
}

export { useColumnForm };
export type { UseColumnFormContext };
