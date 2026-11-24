import { type RowWire, type SubscriptionStatus, type TableDescription, type TableRef } from "docblocks-react-ui";
import { Button, Input, cn } from "docblocks-react-ui";

import { useCallback, useEffect, useRef, useState } from "react";

import { newMutationContext, persistentDatabaseBridge } from "../persistent-bridge";
import { BridgeRowsPanel } from "./BridgeRowsPanel";
import { BridgeSchemaPanel } from "./BridgeSchemaPanel";
import { BOX, BTN, FIELD, LABEL, LOG_CAP, eventSummary } from "./bridge-inspect-format";
import type { StampedEvent } from "./bridge-inspect-format";

/**
 * The pane's database-bridge inspector: a consumer-side harness over the
 * persistent in-memory bridge that exercises every `DatabaseBridge` method
 * directly (the tables catalog, the schema, the rows, and the live event
 * feed). It is the playground's stand-in for the consumer's table
 * management UI — the data lives in the harness's bridge
 * snapshot; the grid and this panel both read the same bridge instance, so
 * a mutation here is visible in the grid (and vice-versa) over the live
 * envelopes. The schema / rows sections stand over the dedicated panels.
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
          <BridgeSchemaPanel
            bridge={bridge}
            tableId={selected}
            desc={desc}
            tables={tables}
            busy={busy}
            run={run}
            onChanged={() => refreshTable(selected)}
          />
          <BridgeRowsPanel
            bridge={bridge}
            tableId={selected}
            desc={desc}
            rows={rows}
            busy={busy}
            run={run}
            checked={checked}
            setChecked={setChecked}
            removed={removed}
            setRemoved={setRemoved}
            onChanged={() => refreshTable(selected)}
          />
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
