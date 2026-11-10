/**
 * The standalone's database tables section (harness-only, `?tables=1`):
 * the `useTableList` hook + the `DatabaseTable` component rendered
 * outside any document (the consumer's own page's stand) over the
 * harness's shared bridge (the panes' blocks stand the same tables —
 * the cross-surface's parity). The e2e's bridge suite drives the
 * bridge over `window.__bridge` (the SyncPane's contract).
 */
import { DatabaseTable, useTableList } from "docblocks-react-ui";
import type { TableRef } from "docblocks-react-ui";

import { useEffect, useState } from "react";

import { databaseBridge } from "./insert-blocks";

function TablesSection() {
  const list = useTableList(databaseBridge);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [createName, setCreateName] = useState("");
  const [creating, setCreating] = useState(false);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameName, setRenameName] = useState("");
  const [readOnly, setReadOnly] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  // The harness's e2e bridge stand (the state is per page).
  useEffect(() => {
    window.__bridge = databaseBridge;
  }, []);

  // The selection's default: the first table over the catalog's settle.
  useEffect(() => {
    if (selectedId === null && list.tables !== null && list.tables.length > 0) {
      setSelectedId(list.tables[0]!.id);
    }
  }, [list.tables, selectedId]);

  const selected: TableRef | null = list.tables?.find((entry) => entry.id === selectedId) ?? null;

  const onCreate = async () => {
    const name = createName.trim();
    if (name === "" || creating) return;
    setCreating(true);
    setActionError(null);
    try {
      const created = await list.create(name);
      setCreateName("");
      setSelectedId(created.id);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
    } finally {
      setCreating(false);
    }
  };

  const onRename = async (tableId: string) => {
    const name = renameName.trim();
    setRenamingId(null);
    if (name === "") return;
    try {
      await list.rename(tableId, name);
      setActionError(null);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <main className="tables-section" data-testid="tables-section">
      <header>
        <h1 className="tables-title">docblocks — the standalone's database tables</h1>
        <p className="tables-desc">
          The <code>useTableList</code> + the <code>DatabaseTable</code>'s stand (the consumer's own page, not a
          document block) over the harness's shared bridge.
        </p>
      </header>

      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 12 }}>
        <input
          className="tables-input"
          data-testid="tables-create-input"
          value={createName}
          onChange={(event) => setCreateName(event.target.value)}
          placeholder="the new table's name"
          onKeyDown={(event) => {
            if (event.key === "Enter") void onCreate();
          }}
        />
        <button
          className="tables-btn"
          data-testid="tables-create"
          onClick={() => void onCreate()}
          disabled={creating || createName.trim() === ""}
        >
          Create
        </button>
        <button className="tables-btn" data-testid="tables-refresh" onClick={() => void list.refresh()}>
          Refresh
        </button>
        <label style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 6 }}>
          <input
            data-testid="tables-readonly"
            type="checkbox"
            checked={readOnly}
            onChange={(event) => setReadOnly(event.target.checked)}
          />
          read-only
        </label>
      </div>

      {list.error !== null && (
        <div className="tables-error" data-testid="tables-error">
          {list.error.code}: {list.error.message}
        </div>
      )}
      {actionError !== null && (
        <div className="tables-error" data-testid="tables-action-error">
          {actionError}
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "260px 1fr", gap: 12, marginTop: 12, alignItems: "start" }}>
        <ul className="tables-list" data-testid="tables-list">
          {list.tables === null ? (
            <li className="tables-item">{list.loading ? "loading…" : "no tables"}</li>
          ) : (
            list.tables.map((entry) => (
              <li
                key={entry.id}
                className={entry.id === selectedId ? "tables-item tables-item--selected" : "tables-item"}
                data-testid="tables-item"
                data-table-id={entry.id}
                onClick={() => setSelectedId(entry.id)}
              >
                {renamingId === entry.id ? (
                  <input
                    data-testid="tables-rename-input"
                    value={renameName}
                    onChange={(event) => setRenameName(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") void onRename(entry.id);
                      if (event.key === "Escape") setRenamingId(null);
                    }}
                    onBlur={() => void onRename(entry.id)}
                    autoFocus
                  />
                ) : (
                  <>
                    <span data-testid="tables-item-name">{entry.name}</span>
                    <button
                      className="tables-link"
                      data-testid="tables-rename"
                      onClick={(event) => {
                        event.stopPropagation();
                        setRenamingId(entry.id);
                        setRenameName(entry.name);
                      }}
                    >
                      rename
                    </button>
                  </>
                )}
              </li>
            ))
          )}
        </ul>

        <div className="tables-grid" data-testid="tables-grid">
          {selected !== null ? (
            <DatabaseTable bridge={databaseBridge} tableId={selected.id} readOnly={readOnly} />
          ) : (
            <p className="tables-desc">select a table</p>
          )}
        </div>
      </div>
    </main>
  );
}

export { TablesSection };
