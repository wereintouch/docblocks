import {
  type BatchOp,
  type Column,
  type RowWire,
  type SubscriptionStatus,
  type TableDescription,
  type TableEvent,
  type TableRef,
} from "docblocks-react-ui";
import { BareSelect, Button, Checkbox, Input, Label, cn } from "docblocks-react-ui";

import { useCallback, useEffect, useRef, useState } from "react";

import { newMutationContext, persistentDatabaseBridge } from "../persistent-bridge";

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

/** A stamped bridge envelope (the relative ms + the local log sequence —
 * the envelope's own `seq` stands the stream's, the at-least-once
 * delivery stands the local key). */
type StampedEvent = TableEvent & { at: number; logSeq: number };

/** The envelope's log line: the kind + the nested domain events' types (the
 * row frames carry the row's id, the delete the row id, the option's rename
 * the option's id). */
function eventSummary(event: TableEvent): string {
  if (event.kind === "invalidate") return "invalidate (rebaseline)";
  return event.events
    .map((domain) => {
      switch (domain.type) {
        case "row.deleted":
          return `${domain.type} ${domain.payload.rowId}`;
        case "row.created":
        case "row.updated":
        case "row.moved":
        case "row.restored":
          return `${domain.type} ${domain.payload.row.id}`;
        case "enum.option.renamed":
          return `${domain.type} ${domain.payload.option.id}`;
        default:
          return domain.type;
      }
    })
    .join(", ");
}

/** The cell value as display text (null / undefined = empty). */
function cellText(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (Array.isArray(value)) return value.join(", ");
  return String(value);
}

/** The column's schema line (the type + the position / the nullability /
 * the revision + the reference relation + the number display). */
function columnLine(column: Column): string {
  let line = `${column.id}: ${column.type} · pos ${column.position} · ${column.nullable ? "nullable" : "not null"} · rev ${column.revision}`;
  if (column.reference !== undefined) {
    line += ` [${column.reference.kind}${column.reference.many ? ":many" : ""} → ${column.reference.tableId}]`;
  }
  if (column.numberDisplay !== undefined) {
    const display = column.numberDisplay;
    line += ` {dec=${display.decimals ?? 0}${display.prefix !== undefined ? `, prefix="${display.prefix}"` : ""}${display.suffix !== undefined ? `, suffix="${display.suffix}"` : ""}}`;
  }
  return line;
}

/**
 * The pane's database-bridge inspector: a consumer-side harness over the
 * default in-memory bridge that exercises every `DatabaseBridge` method
 * directly (the tables catalog, the schema, the rows, and the live event
 * feed). It is the playground's stand-in for the consumer's table
 * management UI (the F4 scope) — the data lives in RAM (the memory
 * bridge); the grid and this panel both read the same bridge instance, so
 * a mutation here is visible in the grid (and vice-versa) over the live
 * envelopes.
 */
function BridgeInspector({ client }: { client: "a" | "b" }) {
  const bridge = persistentDatabaseBridge;
  const [tables, setTables] = useState<TableRef[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [desc, setDesc] = useState<TableDescription | null>(null);
  const [rows, setRows] = useState<RowWire[]>([]);
  const [removed, setRemoved] = useState<string[]>([]);
  const [events, setEvents] = useState<StampedEvent[]>([]);
  const [status, setStatus] = useState<SubscriptionStatus | null>(null);
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
  const logSeq = useRef(0);
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

  const refreshTables = useCallback(async () => {
    setTables(await bridge.listTables());
  }, [bridge]);

  const refreshTable = useCallback(
    async (tableId: string) => {
      // The snapshot stands the schema + the ordered rows from one
      // consistent read (the `page.asOfSeq`'s stand).
      const snapshot = await bridge.snapshotTable(tableId, {});
      setDesc({ table: snapshot.table, columns: snapshot.columns, schemaRevision: snapshot.schemaRevision });
      setRows(snapshot.page.rows);
    },
    [bridge]
  );

  // Load the catalog on mount and keep the selected table live (the event
  // feed drives the row / schema refresh, so the grid and this panel stay
  // in sync without polling). The feed subscribes over the snapshot's `R`
  // — the replay stands the events between the read and the subscription,
  // so the log stays live-only (no history flood).
  useEffect(() => {
    void refreshTables();
  }, [refreshTables]);

  useEffect(() => {
    if (selected === null) {
      setDesc(null);
      setRows([]);
      setRemoved([]);
      setChecked(new Set());
      setStatus(null);
      return;
    }
    setEvents([]);
    let handle: { unsubscribe(): void } | null = null;
    let live = true;
    void (async () => {
      try {
        const snapshot = await bridge.snapshotTable(selected, {});
        if (!live) return;
        setDesc({ table: snapshot.table, columns: snapshot.columns, schemaRevision: snapshot.schemaRevision });
        setRows(snapshot.page.rows);
        handle = bridge.subscribeTable(
          selected,
          { afterSeq: snapshot.page.asOfSeq },
          {
            ready: () => undefined,
            event: (envelope) => {
              logSeq.current += 1;
              const stamped: StampedEvent = {
                ...envelope,
                at: Date.now() - mountedAt.current,
                logSeq: logSeq.current,
              };
              setEvents((prev) => [...prev, stamped].slice(-LOG_CAP));
              void refreshTable(selected);
            },
            status: (value) => {
              if (live) setStatus(value);
            },
            error: (bridgeError) => {
              if (live) setError(`${bridgeError.code}: ${bridgeError.message}`);
            },
            reset: () => {
              // The forced rebaseline: the fresh snapshot's stand.
              void refreshTable(selected);
            },
          }
        );
      } catch (e) {
        if (live) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      live = false;
      handle?.unsubscribe();
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
      const receipt = await bridge.createTable({ name }, newMutationContext());
      setNewTable("");
      await refreshTables();
      select(receipt.result.id);
    });
  };

  const addColumn = (): void => {
    if (selected === null) return;
    const name = colName.trim();
    if (name === "") return;
    run("createColumn", async () => {
      const reference =
        colRefKind !== "" && colRefTable !== ""
          ? { kind: colRefKind as "enum" | "row", tableId: colRefTable, many: colRefMany }
          : undefined;
      // The id stands the bridge's allocation (the harness never names one).
      await bridge.createColumn(
        selected,
        {
          column: {
            name,
            type: colType,
            position: desc?.columns.length ?? 0,
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
      await refreshTable(selected);
    });
  };

  const renameColumn = (columnId: string): void => {
    if (selected === null) return;
    const name = (renames[columnId] ?? "").trim();
    if (name === "") return;
    run("renameColumn", async () => {
      // The rename stands the name's patch (the name is an attribute).
      await bridge.updateColumn(selected, columnId, { name }, newMutationContext());
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
    if (name === "" || name === desc.table.name) return;
    run("renameTable", async () => {
      await bridge.renameTable(selected, { name }, newMutationContext());
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
      await bridge.deleteColumn(selected, columnId, newMutationContext());
      await refreshTable(selected);
    });
  };

  const addRow = (): void => {
    if (selected === null) return;
    run("create row", async () => {
      const ops: BatchOp[] = [{ op: "create", row: {}, beforeRowId: null }];
      await bridge.batchRows(selected, { ops }, newMutationContext());
      await refreshTable(selected);
    });
  };

  const addRows = (count: number): void => {
    if (selected === null) return;
    run("batch create rows", async () => {
      const ops: BatchOp[] = [];
      for (let i = 0; i < count; i += 1) ops.push({ op: "create", row: {}, beforeRowId: null });
      await bridge.batchRows(selected, { ops }, newMutationContext());
      await refreshTable(selected);
    });
  };

  const moveRow = (rowId: string, beforeRowId: string | null): void => {
    if (selected === null) return;
    run("move row", async () => {
      const ops: BatchOp[] = [{ op: "move", rowId, beforeRowId }];
      await bridge.batchRows(selected, { ops }, newMutationContext());
      await refreshTable(selected);
    });
  };

  const removeRow = (rowId: string): void => {
    if (selected === null) return;
    run("delete row", async () => {
      const ops: BatchOp[] = [{ op: "delete", rowId }];
      await bridge.batchRows(selected, { ops }, newMutationContext());
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
    run("batch delete rows", async () => {
      const ops: BatchOp[] = ids.map((rowId) => ({ op: "delete", rowId }));
      await bridge.batchRows(selected, { ops }, newMutationContext());
      setRemoved((prev) => [...prev, ...ids]);
      setChecked(new Set());
      await refreshTable(selected);
    });
  };

  const restore = (): void => {
    if (selected === null || removed.length === 0) return;
    const ids = removed;
    run("undeleteRows", async () => {
      await bridge.undeleteRows(selected, { rowIds: ids }, newMutationContext());
      setRemoved([]);
      await refreshTable(selected);
    });
  };

  return (
    <div data-testid={`bridge-${client}`} className="mt-2 rounded border border-border">
      <div className="border-b border-border px-2 py-1 text-xs">
        bridge — {tables.length} tables {selected !== null ? `· ${desc?.table.name ?? selected}` : ""}
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
          {/* Schema: describeTable + createColumn / updateColumn / deleteColumn. */}
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

          {/* Rows: snapshotTable + the batchRows' ops / the undeleteRows. */}
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
        </>
      )}

      {/* Events: subscribeTable (the live feed for the selected table). */}
      {selected !== null && (
        <div className={BOX}>
          <div className={LABEL}>
            events (subscribeTable{status !== null ? ` · ${status}` : ""}) — {events.length}
          </div>
          <ul ref={logRef} className="event-log">
            {events.map((event) => (
              <li key={event.logSeq}>
                [t+{event.at}ms] seq={event.seq} (prev={event.prevSeq ?? "∅"}) · {eventSummary(event)}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export { BridgeInspector };
