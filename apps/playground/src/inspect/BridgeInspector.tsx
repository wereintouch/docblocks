import { type BridgeColumn, type BridgeTableDescription, type TableEvent, type TableRef } from "docblocks-react-ui";
import { BareSelect, Button, Checkbox, Input, Label, cn } from "docblocks-react-ui";

import { useCallback, useEffect, useRef, useState } from "react";

import { persistentDatabaseBridge } from "../persistent-bridge";

/** The PostgreSQL type catalog the add-column form offers (the package's
 *  default annotation resolves each to its operator catalog + input). */
const COLUMN_TYPES = [
  "text",
  "integer",
  "smallint",
  "bigint",
  "double precision",
  "numeric",
  "boolean",
  "date",
  "timestamptz",
  "time",
  "interval",
];

/** The event / row log caps (the harness keeps a bounded tail). */
const LOG_CAP = 50;
const LABEL = "text-[11px] text-(--muted-foreground)";
const BOX = "mt-2 rounded border border-border p-2";
const BTN = "h-auto gap-0 rounded px-2 py-0.5 text-[11px] font-normal shadow-none";
const FIELD = "h-auto text-[11px] shadow-none";

/** A stamped bridge event (the relative ms is for the log line). */
type StampedEvent = TableEvent & { at: number; seq: number };

/** One row of the selected table (id + the cell map). */
interface RowView {
  id: string;
  cells: Record<string, unknown>;
}

/** The cell value as display text (null / undefined = empty). */
function cellText(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (Array.isArray(value)) return value.join(", ");
  return String(value);
}

/** A unique column id from a name (the harness's id derivation). */
function slugify(name: string, taken: Set<string>): string {
  const base =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "column";
  let id = base;
  for (let n = 2; taken.has(id); n += 1) id = `${base}-${n}`;
  return id;
}

/**
 * The pane's database-bridge inspector: a consumer-side harness over the
 * default in-memory bridge that exercises every `DatabaseBridge` method
 * directly (the tables catalog, the schema, the rows, and the live event
 * feed). It is the playground's stand-in for the consumer's table
 * management UI (the F4 scope) — the data lives in RAM (the memory
 * bridge); the grid and this panel both read the same bridge instance, so
 * a mutation here is visible in the grid (and vice-versa) over the live
 * events.
 */
function BridgeInspector({ client }: { client: "a" | "b" }) {
  const bridge = persistentDatabaseBridge;
  const [tables, setTables] = useState<TableRef[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [desc, setDesc] = useState<BridgeTableDescription | null>(null);
  const [rows, setRows] = useState<RowView[]>([]);
  const [removed, setRemoved] = useState<string[]>([]);
  const [events, setEvents] = useState<StampedEvent[]>([]);
  const [error, setError] = useState<string>("");
  const [busy, setBusy] = useState(false);
  // form state
  const [newTable, setNewTable] = useState("");
  const [colName, setColName] = useState("");
  const [colType, setColType] = useState("text");
  const [colRefKind, setColRefKind] = useState("");
  const [colRefMany, setColRefMany] = useState(false);
  const [colRefTable, setColRefTable] = useState("");
  const [renames, setRenames] = useState<Record<string, string>>({});
  const [tableRenames, setTableRenames] = useState<Record<string, string>>({});
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const mountedAt = useRef(Date.now());
  const eventSeq = useRef(0);
  const logRef = useRef<HTMLUListElement | null>(null);

  // The busy stand: every action button stands the wait cursor while the
  // bridge's round-trip is in flight (the harness's own busy state).
  const BTN_ACTIVE = cn(BTN, "bg-muted", busy && "cursor-wait");

  const onNewTableChange = (event: React.ChangeEvent<HTMLInputElement>) => setNewTable(event.target.value);
  const onNewTableKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") createTable();
  };
  const onRenameChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    if (selected === null) return;
    setTableRenames((prev) => ({ ...prev, [selected]: event.target.value }));
  };
  const onRenameKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") renameTable();
  };
  const onColumnRenameChange = (columnId: string) => (event: React.ChangeEvent<HTMLInputElement>) =>
    setRenames((prev) => ({ ...prev, [columnId]: event.target.value }));
  const onColNameChange = (event: React.ChangeEvent<HTMLInputElement>) => setColName(event.target.value);
  const onRefKindChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    setColRefKind(event.target.value);
    setColRefTable("");
  };
  const onRefManyChange = (checkedValue: boolean) => setColRefMany(checkedValue);
  const onColTypeChange = (event: React.ChangeEvent<HTMLSelectElement>) => setColType(event.target.value);
  const onColRefTableChange = (event: React.ChangeEvent<HTMLSelectElement>) => setColRefTable(event.target.value);

  const stamp = (list: StampedEvent[]): void => {
    for (const event of list) {
      eventSeq.current += 1;
      event.at = Date.now() - mountedAt.current;
      event.seq = eventSeq.current;
    }
  };

  const refreshTables = useCallback(async () => {
    setTables(await bridge.listTables());
  }, [bridge]);

  const refreshTable = useCallback(
    async (tableId: string) => {
      const [description, page] = await Promise.all([bridge.describeTable(tableId), bridge.queryRows(tableId, {})]);
      setDesc(description);
      setRows(Object.entries(page.rows).map(([id, cells]) => ({ id, cells })));
    },
    [bridge]
  );

  // Load the catalog on mount and keep the selected table live (the event
  // feed drives the row / schema refresh, so the grid and this panel stay
  // in sync without polling).
  useEffect(() => {
    void refreshTables();
  }, [refreshTables]);

  useEffect(() => {
    if (selected === null) {
      setDesc(null);
      setRows([]);
      setRemoved([]);
      setChecked(new Set());
      return;
    }
    void refreshTable(selected);
    setEvents([]);
    const unsubscribe = bridge.subscribeTable(selected, (batch) => {
      const stamped = batch.map((event) => ({ ...event, at: 0, seq: 0 })) as StampedEvent[];
      stamp(stamped);
      setEvents((prev) => [...prev, ...stamped].slice(-LOG_CAP));
      void refreshTable(selected);
    });
    return () => {
      unsubscribe();
    };
  }, [selected, bridge, refreshTable]);

  useEffect(() => {
    const list = logRef.current;
    if (list !== null) list.scrollTop = list.scrollHeight;
  }, [events]);

  const run = (label: string, action: () => Promise<void>): void => {
    void (async () => {
      setBusy(true);
      setError("");
      try {
        await action();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(false);
      }
    })();
    void label;
  };

  const select = (tableId: string): void => {
    setSelected(tableId);
    setChecked(new Set());
  };

  const createTable = (): void => {
    const name = newTable.trim();
    if (name === "") return;
    run("createTable", async () => {
      const id = await bridge.createTable(name);
      setNewTable("");
      await refreshTables();
      select(id);
    });
  };

  const addColumn = (): void => {
    if (selected === null) return;
    const name = colName.trim();
    if (name === "") return;
    run("createColumn", async () => {
      const existing = new Set((desc?.columns ?? []).map((column) => column.id));
      const column: BridgeColumn = { id: slugify(name, existing), name, type: colType };
      if (colRefKind !== "" && colRefTable !== "") {
        column.refKind = colRefKind as "enum" | "row";
        column.refTableId = colRefTable;
        if (colRefMany) column.refMany = true;
      }
      await bridge.createColumn(selected, column);
      setColName("");
      setColRefKind("");
      setColRefMany(false);
      setColRefTable("");
      await refreshTable(selected);
    });
  };

  const renameColumn = (columnId: string): void => {
    if (selected === null) return;
    const name = (renames[columnId] ?? "").trim();
    if (name === "") return;
    run("renameColumn", async () => {
      await bridge.renameColumn(selected, columnId, name);
      setRenames((prev) => {
        const next = { ...prev };
        delete next[columnId];
        return next;
      });
      await refreshTable(selected);
    });
  };

  const renameTable = (): void => {
    if (selected === null || desc === null) return;
    const name = (tableRenames[selected] ?? "").trim();
    if (name === "" || name === desc.name) return;
    run("renameTable", async () => {
      await bridge.renameTable(selected, name);
      setTableRenames((prev) => {
        const next = { ...prev };
        delete next[selected];
        return next;
      });
      await refreshTables();
      await refreshTable(selected);
    });
  };

  const deleteColumn = (columnId: string): void => {
    if (selected === null) return;
    run("deleteColumn", async () => {
      await bridge.deleteColumn(selected, columnId);
      await refreshTable(selected);
    });
  };

  const addRow = (): void => {
    if (selected === null) return;
    run("insertRow", async () => {
      await bridge.insertRow(selected, {});
      await refreshTable(selected);
    });
  };

  const addRows = (count: number): void => {
    if (selected === null) return;
    run("insertRows", async () => {
      await bridge.insertRows(
        selected,
        Array.from({ length: count }, () => ({}))
      );
      await refreshTable(selected);
    });
  };

  const moveRow = (rowId: string, beforeRowId: string | null): void => {
    if (selected === null) return;
    run("moveRow", async () => {
      await bridge.moveRow(selected, rowId, beforeRowId);
      await refreshTable(selected);
    });
  };

  const removeRow = (rowId: string): void => {
    if (selected === null) return;
    run("removeRow", async () => {
      await bridge.removeRow(selected, rowId);
      setRemoved((prev) => [...prev, rowId]);
      await refreshTable(selected);
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
    if (selected === null || checked.size === 0) return;
    const ids = [...checked];
    run("removeRows", async () => {
      await bridge.removeRows(selected, ids);
      setRemoved((prev) => [...prev, ...ids]);
      setChecked(new Set());
      await refreshTable(selected);
    });
  };

  const restore = (): void => {
    if (selected === null || removed.length === 0) return;
    const ids = removed;
    run("undeleteRows", async () => {
      await bridge.undeleteRows?.(selected, ids);
      setRemoved([]);
      await refreshTable(selected);
    });
  };

  return (
    <div data-testid={`bridge-${client}`} className="mt-2 rounded border border-border">
      <div className="border-b border-border px-2 py-1 text-xs">
        bridge — {tables.length} tables {selected !== null ? `· ${desc?.name ?? selected}` : ""}
      </div>
      {error !== "" && <div className="bridge-error">{error}</div>}

      {/* Tables: the catalog (listTables) + create. */}
      <div className={BOX}>
        <div className={LABEL}>tables (listTables / createTable)</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 4 }}>
          {tables.map((table) => (
            <Button
              key={table.id}
              type="button"
              variant="outline"
              size="sm"
              data-testid={`bridge-table-${client}`}
              onClick={() => select(table.id)}
              className={cn(BTN, selected === table.id ? "bg-accent" : "bg-muted")}
            >
              {table.name} <span className="opacity-60">{table.id}</span>
            </Button>
          ))}
          {tables.length === 0 && <span className={LABEL}>no tables yet</span>}
        </div>
        <div style={{ display: "flex", gap: 4, marginTop: 6 }}>
          <Input
            size="sm"
            className={cn(FIELD, "flex-1")}
            placeholder="new table name"
            value={newTable}
            onChange={onNewTableChange}
            onKeyDown={onNewTableKeyDown}
          />
          <Button type="button" variant="outline" size="sm" className={BTN_ACTIVE} onClick={createTable}>
            + create
          </Button>
        </div>
        {selected !== null && (
          <div style={{ display: "flex", gap: 4, marginTop: 6 }}>
            <Input
              size="sm"
              className={cn(FIELD, "flex-1")}
              placeholder="rename selected table"
              value={tableRenames[selected] ?? ""}
              onChange={onRenameChange}
              onKeyDown={onRenameKeyDown}
            />
            <Button type="button" variant="outline" size="sm" className={BTN_ACTIVE} onClick={renameTable}>
              rename table
            </Button>
          </div>
        )}
      </div>

      {selected !== null && desc !== null && (
        <>
          {/* Schema: describeTable + createColumn / renameColumn / deleteColumn. */}
          <div className={BOX}>
            <div className={LABEL}>
              schema (describeTable · pk={desc.pkId ?? "id"} · order={desc.rowOrderId ?? "rowOrder"})
            </div>
            <div style={{ marginTop: 4, fontFamily: "monospace", fontSize: 11 }}>
              {desc.columns.map((column) => (
                <div key={column.id} style={{ display: "flex", alignItems: "center", gap: 4, padding: "1px 0" }}>
                  <span className="flex-1">
                    {column.id}: {column.type}
                    {column.refKind !== undefined
                      ? ` [${column.refKind}${column.refMany ? ":many" : ""} → ${column.refTableId ?? "?"}]`
                      : ""}
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
                    title="rename"
                    className={BTN_ACTIVE}
                    onClick={() => renameColumn(column.id)}
                  >
                    ↻
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    title="delete"
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

          {/* Rows: queryRows + insertRow / moveRow / removeRow(s) / undeleteRows. */}
          <div className={BOX}>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span className={LABEL}>rows (queryRows) — {rows.length}</span>
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
                  <Checkbox
                    checked={checked.has(row.id)}
                    onCheckedChange={() => toggleCheck(row.id)}
                    className="size-3"
                  />
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
                    title="move up (moveRow before the previous)"
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
                    title="move down (moveRow before the next)"
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
                    title="move to the end (moveRow null)"
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
                    title="remove (removeRow → trash)"
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
        </>
      )}

      {/* Events: subscribeTable (the live feed for the selected table). */}
      {selected !== null && (
        <div className={BOX}>
          <div className={LABEL}>events (subscribeTable) — {events.length}</div>
          <ul ref={logRef} className="event-log">
            {events.map((event) => (
              <li key={event.seq}>
                [t+{event.at}ms] {event.type}
                {"rowId" in event ? ` ${event.rowId}` : ""}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export { BridgeInspector };
