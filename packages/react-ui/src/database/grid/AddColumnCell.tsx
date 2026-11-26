/** The grid's header-row "add column" cell: the plus chip (the type's menu)
 *  and the create form over it. The cell carries its own explicit grid
 *  placement (the header row's track after the last column) — the header's
 *  resize strip occupies the same row across all tracks. The read-only
 *  modes render the empty track (the primitive's stand: no chip, no form). */
import { useTranslation } from "react-i18next";

import { Button } from "../../shared/ui/Button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "../../shared/ui/DropdownMenu";
import { cn } from "../../shared/ui/cn";
import { Plus } from "../../shared/ui/icons";
import { AddColumnForm } from "./AddColumnForm";
import { columnTypeIcon } from "./column-type-icon";
import { ADD_COLUMN_TYPES, GRID_CHROME_FRAME } from "./constants";
import type { useColumnForm } from "./use-column-form";

interface AddColumnCellProps {
  /** The cell's column track (the header row's last track). */
  gridColumn: number;
  readOnly: boolean;
  /** The add-column form's session (the create / the edit's stand). */
  form: ReturnType<typeof useColumnForm>;
  OptionsEditor: React.ComponentType<{
    options: import("./models").EnumOptionDraft[];
    onChange: (next: import("./models").EnumOptionDraft[]) => void;
  }>;
}

function AddColumnCell({ gridColumn, readOnly, form, OptionsEditor }: AddColumnCellProps) {
  const { t } = useTranslation("database");
  return (
    <div
      data-slot="docblocks/database-add-column"
      className="
        relative row-start-1 flex items-center justify-center border-b-(length:--docblocks-table-border-width)
        border-(--docblocks-table-border-color)
      "
      style={{ gridColumn }}
    >
      {!readOnly && (
        <DropdownMenu modal={false} open={form.addingColumn} onOpenChange={form.setAddingColumn}>
          <DropdownMenuTrigger asChild>
            <Button
              data-slot="docblocks/database-add-column-trigger"
              variant="ghost"
              size="icon"
              className={cn(
                GRID_CHROME_FRAME,
                "size-6 cursor-pointer p-1 text-(--docblocks-placeholder-color) hover:bg-transparent",
                "hover:text-(--docblocks-text-color) dark:hover:bg-transparent"
              )}
            >
              <Plus className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-32">
            {ADD_COLUMN_TYPES.map((entry) => {
              const EntryIcon = columnTypeIcon(entry.type, entry.refKind, entry.refMany);
              return (
                <DropdownMenuItem
                  key={entry.key}
                  data-column-entry={entry.key}
                  onClick={() => form.openCreateForm(entry)}
                >
                  <EntryIcon className="size-4 shrink-0 text-muted-foreground" />
                  {t(entry.labelKey)}
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      <AddColumnForm
        open={form.columnFormOpen}
        onOpenChange={form.onColumnFormOpenChange}
        form={form.columnForm}
        formNumber={form.columnFormNumber}
        formRef={form.columnFormRef}
        error={form.columnFormError}
        bridgeTables={form.bridgeTables}
        OptionsEditor={OptionsEditor}
        onCommit={form.commitColumnForm}
        onNameChange={form.onColumnNameChange}
        onDecimalsChange={form.onColumnDecimalsChange}
        onThousandsChange={form.onColumnThousandsChange}
        onPrefixChange={form.onColumnPrefixChange}
        onSuffixChange={form.onColumnSuffixChange}
        onAllowNegativeChange={form.onColumnAllowNegativeChange}
        onEnumOptionsChange={form.onColumnEnumOptionsChange}
        onRefPickChange={form.onColumnRefPickChange}
        onNewTableNameChange={form.onColumnNewTableNameChange}
      />
    </div>
  );
}

export { AddColumnCell };
