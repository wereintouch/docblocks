/**
 * The bridge inspector's rows section (harness-only): the live row list
 * (snapshotTable's ordered rows over the schema's columns) + the batch
 * row's ops (create / move / delete) + the trash's restore (undeleteRows).
 * The checked set and the trash's id list stand over the inspector (the
 * table's switch resets them there).
 */
import type { BatchOp, DatabaseBridge, RowWire, TableDescription } from "docblocks-react-ui";
import { Button, Checkbox, cn } from "docblocks-react-ui";

import type { Dispatch, SetStateAction } from "react";

import { newMutationContext } from "../persistent-bridge";
import { BOX, BTN, LABEL, cellText } from "./bridge-inspect-format";

type Run = (label: string, action: () => Promise<void>) => void;

function BridgeRowsPanel({
  bridge,
  tableId,
  desc,
  rows,
  busy,
  run,
  checked,
  setChecked,
  removed,
  setRemoved,
  onChanged,
}: {
  bridge: DatabaseBridge;
  tableId: string;
  desc: TableDescription;
  rows: RowWire[];
  busy: boolean;
  run: Run;
  checked: Set<string>;
  setChecked: Dispatch<SetStateAction<Set<string>>>;
  removed: string[];
  setRemoved: Dispatch<SetStateAction<string[]>>;
  onChanged: () => Promise<void>;
}) {
  // The busy stand: the panel's action buttons stand the wait cursor while
  // the bridge's round-trip is in flight (the harness's own busy state).
  const BTN_ACTIVE = cn(BTN, "bg-muted", busy && "cursor-wait");

  const addRow = (): void => {
    run("create row", async () => {
      const ops: BatchOp[] = [{ op: "create", row: {}, beforeRowId: null }];
      await bridge.batchRows(tableId, { ops }, newMutationContext());
      await onChanged();
    });
  };

  const addRows = (count: number): void => {
    run("batch create rows", async () => {
      const ops: BatchOp[] = [];
      for (let i = 0; i < count; i += 1) ops.push({ op: "create", row: {}, beforeRowId: null });
      await bridge.batchRows(tableId, { ops }, newMutationContext());
      await onChanged();
    });
  };

  const moveRow = (rowId: string, beforeRowId: string | null): void => {
    run("move row", async () => {
      const ops: BatchOp[] = [{ op: "move", rowId, beforeRowId }];
      await bridge.batchRows(tableId, { ops }, newMutationContext());
      await onChanged();
    });
  };

  const removeRow = (rowId: string): void => {
    run("delete row", async () => {
      const ops: BatchOp[] = [{ op: "delete", rowId }];
      await bridge.batchRows(tableId, { ops }, newMutationContext());
      setRemoved((prev) => [...prev, rowId]);
      await onChanged();
    });
  };

  const toggleCheck = (rowId: string): void => {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(rowId)) next.delete(rowId);
      else next.add(rowId);
      return next;
    });
  };

  const removeChecked = (): void => {
    if (checked.size === 0) return;
    const ids = [...checked];
    run("batch delete rows", async () => {
      const ops: BatchOp[] = ids.map((rowId) => ({ op: "delete", rowId }));
      await bridge.batchRows(tableId, { ops }, newMutationContext());
      setRemoved((prev) => [...prev, ...ids]);
      setChecked(new Set());
      await onChanged();
    });
  };
  const restore = (): void => {
    if (removed.length === 0) return;
    const ids = removed;
    run("undeleteRows", async () => {
      await bridge.undeleteRows(tableId, { rowIds: ids }, newMutationContext());
      setRemoved([]);
      await onChanged();
    });
  };

  return (
    // Rows: snapshotTable + the batchRows' ops / the undeleteRows.
    <div className={BOX}>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span className={LABEL}>rows (snapshotTable) — {rows.length}</span>
        <span className="flex-1" />
        <Button type="button" variant="outline" size="sm" className={BTN_ACTIVE} onClick={addRow}>
          + row
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          title="batch insert 3"
          className={BTN_ACTIVE}
          onClick={() => addRows(3)}
        >
          +3
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className={BTN_ACTIVE}
          onClick={removeChecked}
          disabled={checked.size === 0}
        >
          delete ✓ ({checked.size})
        </Button>
      </div>
      <div style={{ marginTop: 4, fontFamily: "monospace", fontSize: 11, maxHeight: 180, overflow: "auto" }}>
        {rows.map((row, index) => (
          <div key={row.id} style={{ display: "flex", alignItems: "center", gap: 4, padding: "1px 0" }}>
            <Checkbox checked={checked.has(row.id)} onCheckedChange={() => toggleCheck(row.id)} className="size-3" />
            <span title={row.id} className="w-6 opacity-60">
              #{index + 1}
            </span>
            <span className="flex-1 truncate">
              {desc.columns.map((column) => `${column.id}=${cellText(row.cells[column.id])}`).join("  ")}
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              title="move up (the batch's move op over the previous)"
              disabled={index === 0}
              className={BTN_ACTIVE}
              onClick={() => moveRow(row.id, rows[index - 1]?.id ?? null)}
            >
              ↑
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              title="move down (the batch's move op over the next)"
              disabled={index === rows.length - 1}
              className={BTN_ACTIVE}
              onClick={() => moveRow(row.id, rows[index + 1]?.id ?? null)}
            >
              ↓
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              title="move to the end (the batch's move op over null)"
              disabled={index === rows.length - 1}
              className={BTN_ACTIVE}
              onClick={() => moveRow(row.id, null)}
            >
              ⤓
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              title="delete (the batch's delete op → the trash)"
              className={BTN_ACTIVE}
              onClick={() => removeRow(row.id)}
            >
              ×
            </Button>
          </div>
        ))}
        {rows.length === 0 && <span className={LABEL}>no rows</span>}
      </div>
      {removed.length > 0 && (
        <div style={{ display: "flex", gap: 6, marginTop: 4, alignItems: "center" }}>
          <span className={LABEL}>trash: {removed.length} row(s)</span>
          <Button type="button" variant="outline" size="sm" className={BTN_ACTIVE} onClick={restore}>
            restore (undeleteRows)
          </Button>
        </div>
      )}
    </div>
  );
}

export { BridgeRowsPanel };
