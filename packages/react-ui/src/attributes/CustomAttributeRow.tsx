/** The custom attribute row (the key's rename's entry over the key's
 *  column + the value zone's editors over the type's stand). The value's
 *  stand: the list (plain or the typed stand) runs the vertical's line
 *  editor (the line's inputs + the ×'s removal + the new line's input over
 *  the stack's tail — the whole list's commit over the value's form: the
 *  plain's plain stand, the typed's typed stand; the read-only's
 *  display's stand over the stacked lines); the boolean (plain or the
 *  typed stand) runs the project's checkbox (the checked's toggle — one
 *  write over the same form; the read-only's disabled stand over the
 *  view / published's modes); the string (plain or the typed stand), the
 *  number, and the mention reference run the inline input (the typed
 *  form's write-back — the type stands kept; the invalid number's commit
 *  is the no-write's stand over the old value). */
import { useTranslation } from "react-i18next";

import type { ReactNode } from "react";

import type { DocAttributeValue } from "docblocks-core";

import { Checkbox } from "../shared/ui/Checkbox";
import { InlineEditInput } from "../shared/ui/InlineEditInput";
import { AttributeRow } from "./AttributeRow";
import { DisplayValue } from "./DisplayValue";
import { ListEditor } from "./ListEditor";
import { typedValueOf } from "./value-utils";

function CustomAttributeRow({
  keyName,
  value,
  viewMode,
  editing,
  onEditStart,
  onEditCommit,
  onEditCancel,
  renaming,
  renameInvalid,
  onRenameStart,
  onRenameCommit,
  onRenameCancel,
  onRemove,
  setValue,
  valueZone,
}: {
  keyName: string;
  value: DocAttributeValue | undefined;
  viewMode: boolean;
  /** The inline edit's open stand (the panel's `editingKey`'s read). */
  editing: boolean;
  onEditStart: () => void;
  /** The typed commit's stand (the row's own parsing over the type). */
  onEditCommit: (next: string) => void;
  onEditCancel: () => void;
  /** The rename's open stand (the panel's `renamingKey`'s read). */
  renaming: boolean;
  /** The invalid target's stand (the commit's typed error's keep). */
  renameInvalid: boolean;
  /** The key's click's stand (the rename's input's open). */
  onRenameStart: () => void;
  onRenameCommit: (next: string) => void;
  onRenameCancel: () => void;
  onRemove: () => void;
  /** The value's write (the panel's `set` — the boundary validation's
   *  silent stand). */
  setValue: (v: DocAttributeValue) => void;
  /** The value zone's delegation (the consumer's `renderAttribute`'s
   *  stand over the key; the built-in zone's pass-through over the
   *  absent). */
  valueZone: (zone: ReactNode) => ReactNode;
}) {
  const { t } = useTranslation("editor");
  const rawValue = value;
  const typed = typedValueOf(rawValue);

  const isPlainString = typeof rawValue === "string";
  const isList = Array.isArray(rawValue) || (typed !== null && typed.type === "list");
  const listItems: string[] = Array.isArray(rawValue)
    ? rawValue
    : typed !== null && typed.type === "list"
      ? typed.value
      : [];
  const isBoolean = typeof rawValue === "boolean" || (typed !== null && typed.type === "boolean");
  const editable = !viewMode && (isPlainString || typed !== null);
  const initialOf = (): string => {
    if (typed === null) return isPlainString ? (rawValue as string) : String(rawValue ?? "");
    switch (typed.type) {
      case "string":
      case "number":
        return String(typed.value);
      case "list":
        // The list's stand is the line editor's path (the
        // comma's input's stand dropped).
        return typed.value.join(", ");
      case "mention":
        return typed.value.id;
      case "boolean":
        // The boolean's stand is the checkbox's path (no text
        // input over the row's zone).
        return String(typed.value);
    }
  };
  // The boolean's checked's stand (the plain's plain value, the
  // typed's typed value — the branch stands the `isBoolean`'s
  // guard over the type's read).
  const booleanChecked =
    typeof rawValue === "boolean" ? rawValue : typed !== null && typed.type === "boolean" ? typed.value : false;

  return (
    <AttributeRow
      attributeKey={keyName}
      label={
        renaming ? (
          // The rename's input (the select-all's mount stand —
          // the key's replace; the invalid target's open stand
          // over the error's border).
          <InlineEditInput
            initial={keyName}
            ariaLabel={t("attributes.renameAria", { name: keyName })}
            slot={`docblocks/attribute-${keyName}-rename`}
            variant="inline"
            className="px-0"
            invalid={renameInvalid}
            selectOnMount
            onCommit={onRenameCommit}
            onCancel={onRenameCancel}
          />
        ) : viewMode ? (
          keyName
        ) : (
          // The key's rename entry (the click's stand over the
          // custom rows only — the preset / the system rows
          // keys are the fixed vocabulary's stand). The key's
          // text stands the label column's left edge (no
          // padding's offset over the preset's keys' parity).
          <button
            type="button"
            data-slot="docblocks/attribute-key"
            data-attribute-key={keyName}
            aria-label={t("attributes.renameAria", { name: keyName })}
            className="w-full truncate rounded-md text-left hover:bg-muted/50"
            onClick={onRenameStart}
          >
            {keyName}
          </button>
        )
      }
      removable={!viewMode}
      onRemove={onRemove}
      removeAria={t("attributes.removeAria", { name: keyName })}
      topAlign={isList}
    >
      {valueZone(
        isList ? (
          // The vertical's line editor's stand (the read-only's
          // display over the stacked lines): the commit keeps
          // the value's form (the plain's plain stand, the
          // typed's typed stand).
          <ListEditor
            items={listItems}
            name={keyName}
            readOnly={viewMode}
            slot={`docblocks/attribute-${keyName}-list`}
            onItemsChange={(next) => {
              if (Array.isArray(rawValue)) setValue(next);
              else setValue({ type: "list", value: next });
            }}
          />
        ) : isBoolean ? (
          // The project's checkbox's stand (the read-only's
          // disabled stand over the view / published's modes):
          // the toggle commits over the value's form (the
          // plain's plain stand, the typed's typed stand).
          <span className="flex items-center px-1.5 py-1">
            <Checkbox
              data-slot="docblocks/attribute-custom-boolean"
              data-attribute-key={keyName}
              aria-label={t("attributes.booleanToggleAria", { name: keyName })}
              checked={booleanChecked}
              disabled={viewMode}
              onCheckedChange={(next) => {
                if (typeof next !== "boolean") return;
                if (typeof rawValue === "boolean") setValue(next);
                else setValue({ type: "boolean", value: next });
              }}
            />
          </span>
        ) : !editable ? (
          <DisplayValue value={rawValue} placeholder={t("attributes.notSet")} />
        ) : editing ? (
          <InlineEditInput
            initial={initialOf()}
            ariaLabel={keyName}
            slot={`docblocks/attribute-${keyName}-edit`}
            variant="inline"
            placeholder={t("attributes.valuePlaceholder")}
            onCommit={onEditCommit}
            onCancel={onEditCancel}
          />
        ) : (
          <button
            type="button"
            data-slot="docblocks/attribute-custom"
            data-attribute-key={keyName}
            className="w-full rounded-md text-left hover:bg-muted/50"
            onClick={onEditStart}
          >
            <DisplayValue value={rawValue} placeholder={t("attributes.notSet")} />
          </button>
        )
      )}
    </AttributeRow>
  );
}

export { CustomAttributeRow };
