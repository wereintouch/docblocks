/** The add-column type menu and its create/edit form. */
import { useTranslation } from "react-i18next";

import type { ComponentType } from "react";

import { Button } from "../../shared/ui/Button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "../../shared/ui/DropdownMenu";
import { Plus } from "../../shared/ui/icons";
import { AddColumnForm } from "./AddColumnForm";
import { columnTypeIcon } from "./column-type-icon";
import { ADD_COLUMN_TYPES } from "./constants";
import type { AddColumnTypeEntry, EnumOptionDraft } from "./models";
import type { useColumnForm } from "./use-column-form";

interface AddColumnControlProps {
  form: ReturnType<typeof useColumnForm>;
  OptionsEditor: ComponentType<{
    options: EnumOptionDraft[];
    onChange: (next: EnumOptionDraft[]) => void;
  }>;
  className?: string;
  withLabel?: boolean;
}

function AddColumnControl({ form, OptionsEditor, className, withLabel = false }: AddColumnControlProps) {
  const { t } = useTranslation("database");
  const openEntry = (entry: AddColumnTypeEntry) => () => form.openCreateForm(entry);

  return (
    <>
      <DropdownMenu modal={false} open={form.addingColumn} onOpenChange={form.setAddingColumn}>
        <DropdownMenuTrigger asChild>
          <Button
            data-slot="docblocks/database-add-column-trigger"
            variant={withLabel ? "outline" : "ghost"}
            size={withLabel ? "sm" : "icon"}
            aria-label={t("form.addColumn")}
            className={className}
          >
            <Plus className="size-4" />
            {withLabel ? t("form.addColumn") : null}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-32">
          {ADD_COLUMN_TYPES.map((entry) => {
            const EntryIcon = columnTypeIcon(entry.type, entry.refKind, entry.refMany);
            return (
              <DropdownMenuItem key={entry.key} data-column-entry={entry.key} onClick={openEntry(entry)}>
                <EntryIcon className="size-4 shrink-0 text-muted-foreground" />
                {t(entry.labelKey)}
              </DropdownMenuItem>
            );
          })}
        </DropdownMenuContent>
      </DropdownMenu>
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
    </>
  );
}

export { AddColumnControl };
export type { AddColumnControlProps };
