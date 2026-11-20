/**
 * The add-column's create form (the popover over the add-column track's
 * anchor): the name input + the type-specific block (the number's display
 * attributes / the enum's options' editor / the row-link's table pick +
 * the new-table creation) + the create / save button. The commit stands
 * the button's press only (the outside press / the Escape close without
 * the commit — the draft's loss). The focus's stand: the menu's entry
 * stands the form (the menu's close restores the focus to the plus
 * trigger — the focus-outside would close the form the very tick it
 * opens); the nested popovers' portals (the color's palette / the
 * select's content) stand outside the form's content — an away-click on
 * one of them stands no dismiss.
 */
import { useTranslation } from "react-i18next";

import type { ComponentType } from "react";

import { Button } from "../../shared/ui/Button";
import { Checkbox } from "../../shared/ui/Checkbox";
import { Input } from "../../shared/ui/Input";
import { Label } from "../../shared/ui/Label";
import { Popover, PopoverContent, PopoverTrigger } from "../../shared/ui/Popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../shared/ui/Select";
import { preventDefault } from "../../shared/utils";
import type { TableRef } from "../bridge";
import { NEW_TABLE_PICK, PICKER_SIDE_OFFSET_PX, REF_NONE_PICK } from "./constants";
import type { AddColumnFormDraft, EnumOptionDraft } from "./models";

interface AddColumnFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  form: AddColumnFormDraft | null;
  formNumber: boolean;
  formRef: boolean;
  bridgeTables: TableRef[];
  OptionsEditor: ComponentType<{ options: EnumOptionDraft[]; onChange: (next: EnumOptionDraft[]) => void }>;
  onCommit: () => void;
  onNameChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
  onDecimalsChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
  onThousandsChange: (checked: boolean | "indeterminate") => void;
  onPrefixChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
  onSuffixChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
  onAllowNegativeChange: (checked: boolean | "indeterminate") => void;
  onEnumOptionsChange: (next: EnumOptionDraft[]) => void;
  onRefPickChange: (next: string) => void;
  onNewTableNameChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
}

function AddColumnForm({
  open,
  onOpenChange,
  form,
  formNumber,
  formRef,
  bridgeTables,
  OptionsEditor,
  onCommit,
  onNameChange,
  onDecimalsChange,
  onThousandsChange,
  onPrefixChange,
  onSuffixChange,
  onAllowNegativeChange,
  onEnumOptionsChange,
  onRefPickChange,
  onNewTableNameChange,
}: AddColumnFormProps) {
  const { t } = useTranslation("database");
  return (
    // The create form (every menu entry opens it: the name input + the
    // type-specific attributes — the number's display attributes stand the
    // bridge's column data).
    <Popover open={open && form !== null} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <span data-slot="docblocks/database-add-column-form-anchor" className="absolute size-0" />
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-72 p-3"
        // The menu's entry stands the form: the menu's close restores the
        // focus to the plus trigger (outside the popover content) — the
        // focus-outside would close the form the very tick it opens. The
        // outside press (the interact-outside) and the Escape keep the
        // close (no create — the commit stands the form's button only).
        onFocusOutside={preventDefault}
        // The nested popovers' portals (the color's palette / the select's
        // content) stand outside the form's content (the body's portals):
        // an away-click on one of them stands no dismiss (the draft's loss
        // over the palette's pick — the enum's options' editor's stand;
        // the real outside press keeps the close).
        onInteractOutside={(event) => {
          const target = event.target as HTMLElement | null;
          if (target?.closest('[data-slot="popover-content"], [data-slot="select-content"]')) {
            event.preventDefault();
          }
        }}
      >
        <div data-slot="docblocks/database-add-column-form" className="flex flex-col gap-2">
          <Label>
            {t("form.name")}
            <Input
              size="sm"
              type="text"
              data-slot="docblocks/database-add-column-name"
              className="cursor-text focus:bg-muted/60"
              value={form?.name ?? ""}
              onChange={onNameChange}
            />
          </Label>
          {formNumber && (
            <>
              {form?.numberKind === "decimal" && (
                <Label>
                  {t("form.decimals")}
                  <Input
                    size="sm"
                    type="number"
                    min={0}
                    max={10}
                    data-slot="docblocks/database-add-column-decimals"
                    className="w-16 cursor-text px-1 focus:bg-muted/60"
                    value={form?.decimals ?? 0}
                    onChange={onDecimalsChange}
                  />
                </Label>
              )}
              <Label className="cursor-pointer">
                <Checkbox
                  data-slot="docblocks/database-add-column-thousands"
                  checked={form?.thousands ?? false}
                  onCheckedChange={onThousandsChange}
                />
                {t("form.thousandsSeparator")}
              </Label>
              <Label>
                {t("form.prefix")}
                <Input
                  size="sm"
                  type="text"
                  data-slot="docblocks/database-add-column-prefix"
                  className="cursor-text focus:bg-muted/60"
                  value={form?.prefix ?? ""}
                  onChange={onPrefixChange}
                />
              </Label>
              <Label>
                {t("form.suffix")}
                <Input
                  size="sm"
                  type="text"
                  data-slot="docblocks/database-add-column-suffix"
                  className="cursor-text focus:bg-muted/60"
                  value={form?.suffix ?? ""}
                  onChange={onSuffixChange}
                />
              </Label>
              <Label className="cursor-pointer">
                <Checkbox
                  data-slot="docblocks/database-add-column-negative"
                  checked={form?.allowNegative ?? true}
                  onCheckedChange={onAllowNegativeChange}
                />
                {t("form.allowNegative")}
              </Label>
            </>
          )}
          {formRef && form?.refKind === "enum" && (
            /* The enum's options' editor (the create / the edit's stand):
               the ref table's pick is out (the options stand over the
               column's own system table — the created / the edited stand).
               The motion's variant (the framer's Reorder's rows) stands
               over the slot's context; the plain's editor is the stand
               over its absence. */
            <OptionsEditor options={form.enumOptions ?? []} onChange={onEnumOptionsChange} />
          )}
          {formRef && form?.refKind === "row" && (
            <>
              {/* The row-link's table's pick: the existing tables
                  + the new-table creation. The package's Select
                  (the native select is gone) — the "none" stand
                  is the sentinel pick (Radix takes no empty value),
                  the portaled list stands the standard tokens (the
                  --docblocks-* do not reach the body). */}
              <Label>
                {t("form.table")}
                <Select
                  value={form === null || form.refPick === "" ? REF_NONE_PICK : form.refPick}
                  onValueChange={onRefPickChange}
                >
                  <SelectTrigger
                    data-slot="docblocks/database-add-column-ref"
                    className="w-full justify-start px-2 py-0.5 text-xs shadow-none data-[size=default]:h-7"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent align="start" sideOffset={PICKER_SIDE_OFFSET_PX}>
                    <SelectItem value={REF_NONE_PICK}>{t("form.selectTable")}</SelectItem>
                    {bridgeTables.map((table) => (
                      <SelectItem key={table.id} value={table.id}>
                        {table.name}
                      </SelectItem>
                    ))}
                    <SelectItem value={NEW_TABLE_PICK}>{t("common:newTable")}</SelectItem>
                  </SelectContent>
                </Select>
              </Label>
              {(form?.refPick ?? "") === NEW_TABLE_PICK && (
                <Label>
                  {t("form.name")}
                  <Input
                    size="sm"
                    type="text"
                    data-slot="docblocks/database-add-column-ref-new"
                    placeholder={t("form.newTableName")}
                    className="cursor-text focus:bg-muted/60"
                    value={form?.newTableName ?? ""}
                    onChange={onNewTableNameChange}
                  />
                </Label>
              )}
            </>
          )}
          <Button
            data-slot="docblocks/database-add-column-create"
            variant="outline"
            size="sm"
            // The create / the save commits on the press only (the outside
            // press / the Escape close without the commit); the empty name
            // / the unpicked row's table stand the disabled stand (the
            // commit is impossible over it).
            disabled={
              form === null ||
              form.name.trim() === "" ||
              (formRef &&
                form.refKind === "row" &&
                (form.refPick === "" || (form.refPick === NEW_TABLE_PICK && form.newTableName.trim() === "")))
            }
            className="bg-accent px-2 py-1 hover:opacity-70"
            onClick={onCommit}
          >
            {form?.editColumnId !== undefined ? t("form.save") : t("form.addColumn")}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

export { AddColumnForm };
export type { AddColumnFormProps };
