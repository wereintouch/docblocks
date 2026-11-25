/**
 * The bridge inspector's schema section (harness-only): the live column
 * lines (describeTable's schema over the table's `schemaRevision`) + the
 * add-column form (the type catalog + the reference relation) + the
 * column's rename / delete (updateColumn / deleteColumn). The form's
 * draft state stands over the panel.
 */
import type { DatabaseBridge, TableDescription, TableRef } from "docblocks-react-ui";
import { BareSelect, Button, Checkbox, Input, Label, cn } from "docblocks-react-ui";

import { useState } from "react";

import { newMutationContext } from "../persistent-bridge";
import { BOX, BTN, COLUMN_TYPES, FIELD, LABEL, columnLine } from "./bridge-inspect-format";

type Run = (label: string, action: () => Promise<void>) => void;

function BridgeSchemaPanel({
  bridge,
  tableId,
  desc,
  tables,
  busy,
  run,
  onChanged,
}: {
  bridge: DatabaseBridge;
  tableId: string;
  desc: TableDescription;
  tables: TableRef[];
  busy: boolean;
  run: Run;
  onChanged: () => Promise<void>;
}) {
  // The busy stand: the panel's action buttons stand the wait cursor while
  // the bridge's round-trip is in flight (the harness's own busy state).
  const BTN_ACTIVE = cn(BTN, "bg-muted", busy && "cursor-wait");

  const [colName, setColName] = useState("");
  const [colType, setColType] = useState("text");
  const [colRefKind, setColRefKind] = useState("");
  const [colRefMany, setColRefMany] = useState(false);
  const [colRefTable, setColRefTable] = useState("");
  const [renames, setRenames] = useState<Record<string, string>>({});

  const onColNameChange = (event: React.ChangeEvent<HTMLInputElement>) => setColName(event.target.value);
  const onRefKindChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    setColRefKind(event.target.value);
    setColRefTable("");
  };
  const onRefManyChange = (checkedValue: boolean) => setColRefMany(checkedValue);
  const onColTypeChange = (event: React.ChangeEvent<HTMLSelectElement>) => setColType(event.target.value);
  const onColRefTableChange = (event: React.ChangeEvent<HTMLSelectElement>) => setColRefTable(event.target.value);
  const onColumnRenameChange = (columnId: string) => (event: React.ChangeEvent<HTMLInputElement>) =>
    setRenames((prev) => ({ ...prev, [columnId]: event.target.value }));

  const addColumn = (): void => {
    const name = colName.trim();
    if (name === "") return;
    run("createColumn", async () => {
      const reference =
        colRefKind !== "" && colRefTable !== ""
          ? { kind: colRefKind as "enum" | "row", tableId: colRefTable, many: colRefMany }
          : undefined;
      // The id stands the bridge's allocation (the harness never names one).
      await bridge.createColumn(
        tableId,
        {
          column: {
            name,
            type: colType,
            position: desc.columns.length,
            nullable: true,
            ...(reference !== undefined ? { reference } : {}),
          },
        },
        newMutationContext()
      );
      setColName("");
      setColRefKind("");
      setColRefMany(false);
      setColRefTable("");
      await onChanged();
    });
  };

  const renameColumn = (columnId: string): void => {
    const name = (renames[columnId] ?? "").trim();
    if (name === "") return;
    run("renameColumn", async () => {
      // The rename stands the name's patch (the name is an attribute).
      await bridge.updateColumn(tableId, columnId, { name }, newMutationContext());
      setRenames((prev) => {
        const next = { ...prev };
        delete next[columnId];
        return next;
      });
      await onChanged();
    });
  };

  const deleteColumn = (columnId: string): void => {
    run("deleteColumn", async () => {
      await bridge.deleteColumn(tableId, columnId, newMutationContext());
      await onChanged();
    });
  };

  return (
    // Schema: describeTable + createColumn / updateColumn / deleteColumn.
    <div className={BOX}>
      <div className={LABEL}>schema (describeTable · rev {desc.schemaRevision})</div>
      <div style={{ marginTop: 4, fontFamily: "monospace", fontSize: 11 }}>
        {desc.columns.map((column) => (
          <div key={column.id} style={{ display: "flex", alignItems: "center", gap: 4, padding: "1px 0" }}>
            <span className="flex-1" title={columnLine(column)}>
              {columnLine(column)}
            </span>
            <Input
              size="sm"
              className={cn(FIELD, "w-[90px]")}
              defaultValue={column.name}
              placeholder={column.name}
              onChange={onColumnRenameChange(column.id)}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              title="rename (updateColumn)"
              className={BTN_ACTIVE}
              onClick={() => renameColumn(column.id)}
            >
              ↻
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              title="delete (soft-delete)"
              className={BTN_ACTIVE}
              onClick={() => deleteColumn(column.id)}
            >
              ×
            </Button>
          </div>
        ))}
        {desc.columns.length === 0 && <span className={LABEL}>no columns</span>}
      </div>
      <div style={{ display: "flex", gap: 4, marginTop: 6, flexWrap: "wrap" }}>
        <Input
          size="sm"
          className={cn(FIELD, "w-[110px]")}
          placeholder="column name"
          value={colName}
          onChange={onColNameChange}
        />
        <BareSelect className={cn(FIELD, "w-[130px]")} value={colType} onChange={onColTypeChange}>
          {COLUMN_TYPES.map((type) => (
            <option key={type} value={type}>
              {type}
            </option>
          ))}
        </BareSelect>
        <BareSelect className={cn(FIELD, "w-[110px]")} value={colRefKind} onChange={onRefKindChange}>
          <option value="">ref: none</option>
          <option value="enum">ref: enum</option>
          <option value="row">ref: row</option>
        </BareSelect>
        <BareSelect className={cn(FIELD, "w-[130px]")} value={colRefTable} onChange={onColRefTableChange}>
          <option value="">ref table</option>
          {tables.map((table) => (
            <option key={table.id} value={table.id}>
              {table.name}
            </option>
          ))}
        </BareSelect>
        <Label className="gap-1 text-[11px]">
          <Checkbox checked={colRefMany} onCheckedChange={onRefManyChange} className="size-3" />
          many
        </Label>
        <Button type="button" variant="outline" size="sm" className={BTN_ACTIVE} onClick={addColumn}>
          + column
        </Button>
      </div>
    </div>
  );
}

export { BridgeSchemaPanel };
export type { Run };
