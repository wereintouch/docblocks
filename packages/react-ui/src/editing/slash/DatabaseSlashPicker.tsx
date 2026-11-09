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
import { useTranslation } from "react-i18next";

import { useEffect, useRef, useState } from "react";

import type { TableRef } from "../../database";
import { newMutationContext, validateProtocolDescriptor } from "../../database";
import { useEditorContext } from "../../editor-provider";
import { Button } from "../../shared/ui/Button";
import { Input } from "../../shared/ui/Input";
import { Check, Plus } from "../../shared/ui/icons";
import { preventDefault } from "../../shared/utils";

/** The table picker panel (the slash menu's database state). */
function DatabaseSlashPicker({ onCommit, onCancel }: { onCommit: (tableId: string) => void; onCancel: () => void }) {
  const { t } = useTranslation("slash");
  const { databaseBridge } = useEditorContext();
  // The picker stands only while a bridge is available: the slash menu hides
  // the `database` command when the bridge is absent, so this guard is the
  // unreachable stand (the bridge is read before any hook, stably across the
  // provider's lifetime).
  if (databaseBridge === undefined) return null;
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

  // The picker's lifetime: the create's commit stands only while the
  // picker stands (the Escape / the caret's move unmounts it — the commit
  // over the unmount would insert the block over a cancelled gesture; the
  // create's receipt itself stands the consumer's orphan, the picker
  // cannot unwind it).
  const mountedRef = useRef(true);
  useEffect(() => {
    // The StrictMode's dev double-mount re-runs the setup: the reset stands
    // the guard live after the double-mount (the cleanup-only stand leaves
    // the ref false over a dev StrictMode, dropping the create's commit —
    // the table is created, the block is not inserted).
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // The name input stands focused when the form stands (the keyboard's
  // create flow: the button's click lands the focus, the name types, the
  // Enter / check commits).
  useEffect(() => {
    if (createOpen) nameInputRef.current?.focus();
  }, [createOpen]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        // The negotiation stand (the useDatabaseTable bootstrap's
        // contract): the version / the baseline-capability mismatch stands
        // the protocol_mismatch — the list/create stand only over a
        // validated protocol (the silent downgrade is not a stand).
        const descriptor = await databaseBridge.describeProtocol();
        validateProtocolDescriptor(descriptor);
        const refs = await databaseBridge.listTables();
        if (!cancelled) setTables(refs);
      } catch (listError) {
        if (!cancelled) setError(listError instanceof Error ? listError.message : String(listError));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [databaseBridge]);

  const create = () => {
    const trimmed = name.trim();
    // The protocol stand: the create stands only over the validated
    // protocol (the mount effect's negotiation — tables === null is the
    // loading / the failed-negotiation stand).
    if (trimmed.length === 0 || creating || tables === null) return;
    setCreating(true);
    setError(null);
    void (async () => {
      try {
        const tableId = (await databaseBridge.createTable({ name: trimmed }, newMutationContext())).result.id;
        if (mountedRef.current) onCommit(tableId);
      } catch (createError) {
        if (mountedRef.current) {
          setCreating(false);
          setError(createError instanceof Error ? createError.message : String(createError));
        }
      }
    })();
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

  const onNameKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    stopPickerKey(event);
    if (event.key === "Enter") {
      event.preventDefault();
      create();
    }
  };
  const onNameChange = (event: React.ChangeEvent<HTMLInputElement>) => setName(event.target.value);
  const openCreate = () => setCreateOpen(true);
  const onQueryChange = (event: React.ChangeEvent<HTMLInputElement>) => setQuery(event.target.value);
  const commitRefAt = (ref: TableRef) => () => onCommit(ref.id);

  return (
    <div data-slot="docblocks/slash-database-picker" className="flex w-56 flex-col gap-2 p-1">
      {createOpen ? (
        <div data-slot="docblocks/slash-database-create-form" className="flex items-center gap-1">
          <Input
            size="sm"
            ref={nameInputRef}
            type="text"
            data-slot="docblocks/slash-database-name"
            className="rounded-sm"
            placeholder={t("database.namePlaceholder")}
            value={name}
            onKeyDown={onNameKeyDown}
            onChange={onNameChange}
          />
          <Button
            data-slot="docblocks/slash-database-create"
            variant="outline"
            size="icon"
            className="size-8 cursor-default rounded-sm bg-transparent disabled:cursor-default dark:bg-transparent"
            disabled={name.trim().length === 0 || creating}
            onMouseDown={preventDefault}
            onClick={create}
          >
            <Check className="size-4" />
          </Button>
        </div>
      ) : (
        <Button
          data-slot="docblocks/slash-database-create-new"
          variant="ghost"
          size="sm"
          className="h-auto cursor-default rounded-sm px-2 py-1.5 text-sm font-normal"
          onMouseDown={preventDefault}
          onClick={openCreate}
        >
          <Plus className="size-4" />
          {t("database.newTable")}
        </Button>
      )}
      {error !== null && (
        <div data-slot="docblocks/slash-database-error" className="px-2 py-1 text-xs text-destructive">
          {error}
        </div>
      )}
      <Input
        size="sm"
        type="text"
        data-slot="docblocks/slash-database-search"
        className="rounded-sm"
        placeholder={t("database.searchPlaceholder")}
        value={query}
        onKeyDown={stopPickerKey}
        onChange={onQueryChange}
      />
      {tables === null ? (
        <div data-slot="docblocks/slash-database-loading" className="px-2 py-1 text-sm text-muted-foreground">
          {t("database.loading")}
        </div>
      ) : (
        <div data-slot="docblocks/slash-database-list" className="max-h-40 overflow-y-auto">
          {filtered.length === 0 && (
            <div data-slot="docblocks/slash-database-empty" className="px-2 py-1 text-sm text-muted-foreground">
              {query.trim().length > 0 ? t("database.noMatch") : t("database.empty")}
            </div>
          )}
          {filtered.map((ref) => (
            <Button
              key={ref.id}
              data-slot="docblocks/slash-database-table"
              data-table-id={ref.id}
              variant="ghost"
              size="sm"
              role="menuitem"
              className="h-auto w-full cursor-default justify-start rounded-sm px-2 py-1.5 text-sm font-normal"
              // The mousedown suppression keeps the caret's selection alive
              // across the click (the menu panel idiom).
              onMouseDown={preventDefault}
              onClick={commitRefAt(ref)}
            >
              {ref.name}
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}

export { DatabaseSlashPicker };
