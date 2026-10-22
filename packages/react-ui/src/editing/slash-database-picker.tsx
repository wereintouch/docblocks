/**
 * The slash `Database` picker: the create-new form (a `New table` button that stands the

 * auto-focused name input + the check commit — `bridge.createTable`) above
 * the existing tables (the search row filters the list by name —
 * `bridge.listTables`). The menu stands open over the phrase while the
 * picker stands; the pick / create commits the phrase strip + the
 * `insertBlock('database', { tableId })` in the caller's transact. A
 * create / list failure stands the error line (the block is not inserted);
 * the cancel keeps the command list on the phrase.
 */
import { useEffect, useRef, useState } from "react";

import { useEditorContext } from "../EditorProvider";
import type { TableRef } from "../database/bridge";
import { Check, Plus } from "../shared/ui/icons";

/** The table picker panel (the slash menu's database state). */
function DatabaseSlashPicker({ onCommit, onCancel }: { onCommit: (tableId: string) => void; onCancel: () => void }) {
  const { databaseBridge } = useEditorContext();
  const [tables, setTables] = useState<TableRef[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  // The create form's open flag: the `New table` button stands the form
  // (the name input + the check) instead of the button.
  const [createOpen, setCreateOpen] = useState(false);
  // The search row's query (the existing list filters by table name).
  const [query, setQuery] = useState("");
  const nameInputRef = useRef<HTMLInputElement | null>(null);

  // The name input stands focused when the form stands (the keyboard's
  // create flow: the button's click lands the focus, the name types, the
  // Enter / check commits).
  useEffect(() => {
    if (createOpen) nameInputRef.current?.focus();
  }, [createOpen]);

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

  const filtered = (tables ?? []).filter((ref) => ref.name.toLowerCase().includes(query.trim().toLowerCase()));

  // The picker's own keys are not the slash query's: stop the propagation
  // (the block's key handler would move the highlight and re-derive the
  // query). Escape cancels the picker (the command list stands on the
  // phrase).
  const stopPickerKey = (event: React.KeyboardEvent<HTMLInputElement>) => {
    event.stopPropagation();
    if (event.key === "Escape") onCancel();
  };

  return (
    <div data-slot="docblocks/slash-database-picker" className="flex w-56 flex-col gap-2 p-1">
      {createOpen ? (
        <div data-slot="docblocks/slash-database-create-form" className="flex items-center gap-1">
          <input
            ref={nameInputRef}
            type="text"
            data-slot="docblocks/slash-database-name"
            className="
              h-8 min-w-0 flex-1 rounded-sm border border-border bg-transparent px-2 text-sm outline-none
              placeholder:text-muted-foreground
            "
            placeholder="New table name"
            value={name}
            onKeyDown={(event) => {
              stopPickerKey(event);
              if (event.key === "Enter") {
                event.preventDefault();
                create();
              }
            }}
            onChange={(event) => setName(event.target.value)}
          />
          <button
            type="button"
            data-slot="docblocks/slash-database-create"
            className="
              flex size-8 shrink-0 cursor-default items-center justify-center rounded-sm border border-border
              text-foreground select-none
              hover:bg-accent hover:text-accent-foreground
              disabled:cursor-default disabled:opacity-50
            "
            disabled={name.trim().length === 0 || creating}
            onMouseDown={(event) => event.preventDefault()}
            onClick={create}
          >
            <Check className="size-4" />
          </button>
        </div>
      ) : (
        <button
          type="button"
          data-slot="docblocks/slash-database-create-new"
          className="
            flex cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-sm select-none
            hover:bg-accent hover:text-accent-foreground
          "
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => setCreateOpen(true)}
        >
          <Plus className="size-4" />
          New table
        </button>
      )}
      {error !== null && (
        <div data-slot="docblocks/slash-database-error" className="px-2 py-1 text-xs text-destructive">
          {error}
        </div>
      )}
      <input
        type="text"
        data-slot="docblocks/slash-database-search"
        className="
          h-8 w-full rounded-sm border border-border bg-transparent px-2 text-sm outline-none
          placeholder:text-muted-foreground
        "
        placeholder="Search tables…"
        value={query}
        onKeyDown={stopPickerKey}
        onChange={(event) => setQuery(event.target.value)}
      />
      {tables === null ? (
        <div data-slot="docblocks/slash-database-loading" className="px-2 py-1 text-sm text-muted-foreground">
          Loading the tables…
        </div>
      ) : (
        <div data-slot="docblocks/slash-database-list" className="max-h-40 overflow-y-auto">
          {filtered.length === 0 && (
            <div data-slot="docblocks/slash-database-empty" className="px-2 py-1 text-sm text-muted-foreground">
              {query.trim().length > 0 ? "No tables match" : "No tables yet — create one above."}
            </div>
          )}
          {filtered.map((ref) => (
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
    </div>
  );
}

export { DatabaseSlashPicker };
