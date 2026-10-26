import { type BridgeColumn, type BridgeTableDescription, type TableEvent, type TableRef } from "docblocks-react-ui";

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

  const label: React.CSSProperties = { fontSize: 11, color: "var(--muted-foreground)" };
  const box: React.CSSProperties = { border: "1px solid var(--border)", marginTop: 8, padding: 8 };
  const btn: React.CSSProperties = {
    fontSize: 11,
    padding: "2px 8px",
    border: "1px solid var(--border)",
    borderRadius: 4,
    background: "var(--muted)",
    cursor: busy ? "wait" : "pointer",
    margin: "2px 2px 2px 0",
  };
  const input: React.CSSProperties = {
    fontSize: 11,
    padding: "2px 6px",
    border: "1px solid var(--border)",
    borderRadius: 4,
    background: "var(--background)",
    color: "var(--foreground)",
  };

  return (
    <div data-testid={`bridge-${client}`} style={{ border: "1px solid var(--border)", marginTop: 8 }}>
      <div style={{ padding: "4px 8px", borderBottom: "1px solid var(--border)", fontSize: 12 }}>
        bridge — {tables.length} tables {selected !== null ? `· ${desc?.name ?? selected}` : ""}
      </div>
      {error !== "" && (
        <div
          style={{
            padding: "4px 8px",
            fontSize: 11,
            color: "var(--destructive)",
            borderBottom: "1px solid var(--border)",
          }}
        >
          {error}
        </div>
      )}

      {/* Tables: the catalog (listTables) + create. */}
      <div style={box}>
        <div style={label}>tables (listTables / createTable)</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 4 }}>
          {tables.map((table) => (
            <button
              key={table.id}
              type="button"
              data-testid={`bridge-table-${client}`}
              onClick={() => select(table.id)}
              style={{
                ...btn,
                background: selected === table.id ? "var(--accent)" : "var(--muted)",
              }}
            >
              {table.name} <span style={{ opacity: 0.6 }}>{table.id}</span>
            </button>
          ))}
          {tables.length === 0 && <span style={label}>no tables yet</span>}
        </div>
        <div style={{ display: "flex", gap: 4, marginTop: 6 }}>
          <input
            style={{ ...input, flex: 1 }}
            placeholder="new table name"
            value={newTable}
            onChange={(event) => setNewTable(event.target.value)}
            onKeyDown={(event) => event.key === "Enter" && createTable()}
          />
          <button type="button" style={btn} onClick={createTable}>
            + create
          </button>
        </div>
        {selected !== null && (
          <div style={{ display: "flex", gap: 4, marginTop: 6 }}>
            <input
              style={{ ...input, flex: 1 }}
              placeholder="rename selected table"
              value={tableRenames[selected] ?? ""}
              onChange={(event) => setTableRenames((prev) => ({ ...prev, [selected]: event.target.value }))}
              onKeyDown={(event) => event.key === "Enter" && renameTable()}
            />
            <button type="button" style={btn} onClick={renameTable}>
              rename table
            </button>
          </div>
        )}
      </div>

      {selected !== null && desc !== null && (
        <>
          {/* Schema: describeTable + createColumn / renameColumn / deleteColumn. */}
          <div style={box}>
            <div style={label}>
              schema (describeTable · pk={desc.pkId ?? "id"} · order={desc.rowOrderId ?? "rowOrder"})
            </div>
            <div style={{ marginTop: 4, fontFamily: "monospace", fontSize: 11 }}>
              {desc.columns.map((column) => (
                <div key={column.id} style={{ display: "flex", alignItems: "center", gap: 4, padding: "1px 0" }}>
                  <span style={{ flex: 1 }}>
                    {column.id}: {column.type}
                    {column.refKind !== undefined
                      ? ` [${column.refKind}${column.refMany ? ":many" : ""} → ${column.refTableId ?? "?"}]`
                      : ""}
                  </span>
                  <input
                    style={{ ...input, width: 90 }}
                    defaultValue={column.name}
                    placeholder={column.name}
                    onChange={(event) => setRenames((prev) => ({ ...prev, [column.id]: event.target.value }))}
                  />
                  <button type="button" style={btn} title="rename" onClick={() => renameColumn(column.id)}>
                    ↻
                  </button>
                  <button type="button" style={btn} title="delete" onClick={() => deleteColumn(column.id)}>
                    ×
                  </button>
                </div>
              ))}
              {desc.columns.length === 0 && <span style={label}>no columns</span>}
            </div>
            <div style={{ display: "flex", gap: 4, marginTop: 6, flexWrap: "wrap" }}>
              <input
                style={{ ...input, width: 110 }}
                placeholder="column name"
                value={colName}
                onChange={(event) => setColName(event.target.value)}
              />
              <select style={input} value={colType} onChange={(event) => setColType(event.target.value)}>
                {COLUMN_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {type}
                  </option>
                ))}
              </select>
              <select
                style={input}
                value={colRefKind}
                onChange={(event) => {
                  setColRefKind(event.target.value);
                  setColRefTable("");
                }}
              >
                <option value="">ref: none</option>
                <option value="enum">ref: enum</option>
                <option value="row">ref: row</option>
              </select>
              <select style={input} value={colRefTable} onChange={(event) => setColRefTable(event.target.value)}>
                <option value="">ref table</option>
                {tables.map((table) => (
                  <option key={table.id} value={table.id}>
                    {table.name}
                  </option>
                ))}
              </select>
              <label style={{ ...label, display: "flex", gap: 4, alignItems: "center" }}>
                <input type="checkbox" checked={colRefMany} onChange={(event) => setColRefMany(event.target.checked)} />
                many
              </label>
              <button type="button" style={btn} onClick={addColumn}>
                + column
              </button>
            </div>
          </div>

          {/* Rows: queryRows + insertRow / moveRow / removeRow(s) / undeleteRows. */}
          <div style={box}>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={label}>rows (queryRows) — {rows.length}</span>
              <span style={{ flex: 1 }} />
              <button type="button" style={btn} onClick={addRow}>
                + row
              </button>
              <button type="button" style={btn} title="batch insert 3" onClick={() => addRows(3)}>
                +3
              </button>
              <button type="button" style={btn} onClick={removeChecked} disabled={checked.size === 0}>
                delete ✓ ({checked.size})
              </button>
            </div>
            <div style={{ marginTop: 4, fontFamily: "monospace", fontSize: 11, maxHeight: 180, overflow: "auto" }}>
              {rows.map((row, index) => (
                <div key={row.id} style={{ display: "flex", alignItems: "center", gap: 4, padding: "1px 0" }}>
                  <input
                    type="checkbox"
                    checked={checked.has(row.id)}
                    onChange={() => toggleCheck(row.id)}
                    style={{ width: 12, height: 12 }}
                  />
                  <span title={row.id} style={{ opacity: 0.6, width: 24 }}>
                    #{index + 1}
                  </span>
                  <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {desc.columns.map((column) => `${column.id}=${cellText(row.cells[column.id])}`).join("  ")}
                  </span>
                  <button
                    type="button"
                    style={btn}
                    title="move up (moveRow before the previous)"
                    disabled={index === 0}
                    onClick={() => moveRow(row.id, rows[index - 1]?.id ?? null)}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    style={btn}
                    title="move down (moveRow before the next)"
                    disabled={index === rows.length - 1}
                    onClick={() => moveRow(row.id, rows[index + 1]?.id ?? null)}
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    style={btn}
                    title="move to the end (moveRow null)"
                    disabled={index === rows.length - 1}
                    onClick={() => moveRow(row.id, null)}
                  >
                    ⤓
                  </button>
                  <button
                    type="button"
                    style={btn}
                    title="remove (removeRow → trash)"
                    onClick={() => removeRow(row.id)}
                  >
                    ×
                  </button>
                </div>
              ))}
              {rows.length === 0 && <span style={label}>no rows</span>}
            </div>
            {removed.length > 0 && (
              <div style={{ display: "flex", gap: 6, marginTop: 4, alignItems: "center" }}>
                <span style={label}>trash: {removed.length} row(s)</span>
                <button type="button" style={btn} onClick={restore}>
                  restore (undeleteRows)
                </button>
              </div>
            )}
          </div>
        </>
      )}

      {/* Events: subscribeTable (the live feed for the selected table). */}
      {selected !== null && (
        <div style={box}>
          <div style={label}>events (subscribeTable) — {events.length}</div>
          <ul
            ref={logRef}
            style={{
              listStyle: "none",
              margin: "4px 0 0",
              padding: 0,
              overflow: "auto",
              maxHeight: 140,
              fontFamily: "monospace",
              fontSize: 10,
            }}
          >
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
