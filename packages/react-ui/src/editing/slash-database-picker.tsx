/**
 * The slash `Database` picker (decision 2026-10-19, §5.1): the existing
 * tables (`bridge.listTables`) + the create-new form (`bridge.createTable`).
 * The menu stands open over the phrase while the picker stands; the table
 * pick commits the phrase strip + the `insertBlock('database', { tableId })`
 * in the caller's transact. A create / list failure stands the error line
 * (the block is not inserted); the cancel keeps the command list on the
 * phrase.
 */
import { useEffect, useState } from "react";

import { useEditorContext } from "../EditorProvider";
import type { TableRef } from "../database/bridge";

/** The table picker panel (the slash menu's database state). */
function DatabaseSlashPicker({ onCommit, onCancel }: { onCommit: (tableId: string) => void; onCancel: () => void }) {
  const { databaseBridge } = useEditorContext();
  const [tables, setTables] = useState<TableRef[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    let cancelled = false;
    databaseBridge
      .listTables()
      .then((refs) => {
        if (!cancelled) setTables(refs);
      })
      .catch((listError) => {
        if (!cancelled) setError(listError instanceof Error ? listError.message : String(listError));
      });
    return () => {
      cancelled = true;
    };
  }, [databaseBridge]);

  const create = () => {
    const trimmed = name.trim();
    if (trimmed.length === 0 || creating) return;
    setCreating(true);
    setError(null);
    databaseBridge
      .createTable(trimmed)
      .then((tableId) => onCommit(tableId))
      .catch((createError) => {
        setCreating(false);
        setError(createError instanceof Error ? createError.message : String(createError));
      });
  };

  return (
    <div data-slot="docblocks/slash-database-picker" className="flex flex-col gap-2 p-1">
      <div className="px-2 py-1 text-xs text-muted-foreground">Choose the table</div>
      {error !== null && (
        <div data-slot="docblocks/slash-database-error" className="px-2 py-1 text-xs text-destructive">
          {error}
        </div>
      )}
      {tables === null ? (
        <div data-slot="docblocks/slash-database-loading" className="px-2 py-1 text-sm text-muted-foreground">
          Loading the tables…
        </div>
      ) : (
        <div className="max-h-40 overflow-y-auto">
          {tables.length === 0 && (
            <div data-slot="docblocks/slash-database-empty" className="px-2 py-1 text-sm text-muted-foreground">
              No tables yet — create one below.
            </div>
          )}
          {tables.map((ref) => (
            <button
              key={ref.id}
              type="button"
              role="menuitem"
              data-slot="docblocks/slash-database-table"
              data-table-id={ref.id}
              className="
                flex cursor-default items-center rounded-sm px-2 py-1.5 text-sm select-none
                hover:bg-accent hover:text-accent-foreground
              "
              // The mousedown suppression keeps the caret's selection alive
              // across the click (the menu panel idiom).
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => onCommit(ref.id)}
            >
              {ref.name}
            </button>
          ))}
        </div>
      )}
      <div className="flex items-center gap-1">
        <input
          type="text"
          data-slot="docblocks/slash-database-name"
          className="
            h-8 flex-1 rounded-sm border border-border bg-transparent px-2 text-sm outline-none
            placeholder:text-muted-foreground
          "
          placeholder="New table name"
          value={name}
          // The picker's own keys are not the slash query's: stop the
          // propagation (the block's key handler would move the highlight
          // and re-derive the query).
          onKeyDown={(event) => {
            event.stopPropagation();
            if (event.key === "Enter") {
              event.preventDefault();
              create();
            }
            if (event.key === "Escape") onCancel();
          }}
          onMouseDown={(event) => event.preventDefault()}
          onChange={(event) => setName(event.target.value)}
        />
        <button
          type="button"
          data-slot="docblocks/slash-database-create"
          className="
            cursor-default rounded-sm px-2 py-1.5 text-sm select-none
            hover:bg-accent hover:text-accent-foreground
            disabled:cursor-default disabled:opacity-50
          "
          disabled={name.trim().length === 0 || creating}
          onMouseDown={(event) => event.preventDefault()}
          onClick={create}
        >
          {creating ? "Creating…" : "Create"}
        </button>
      </div>
    </div>
  );
}

export { DatabaseSlashPicker };
