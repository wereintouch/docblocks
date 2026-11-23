/**
 * The document-attributes panel: the collapsible stand inside the page
 * column, above the first block (the consumer's own document metadata —
 * the markdown frontmatter's stand). Collapsed by default (the collapse
 * state is session state — never document data). The rows: the system
 * read-only rows (the meta's derivatives — id / createdAt / the live
 * lastUpdatedAt — the dates' locale stand, the date only), the preset
 * rows (description / tags / createdBy / cover / status / publishedAt),
 * and the custom rows (every non-preset key of the `meta.attributes`
 * record — the typed value's stand). Over the read-only stands (the
 * view / published's modes) every row stands display-only.
 * `hiddenAttributes` hides the named rows (the preset and the custom
 * keys, the system rows); the `tags` row is the consumer-owned stand (the
 * `docTags`'s prop: the chips over the passed list + the add affordance's
 * click over the consumer's own creation's UI + the chip's removal/click
 * events — the tags are never document data), and the `description` row
 * stands the same stand over the `docDescription`'s prop (the value over
 * the passed read + the edit's report over `onEdit` — the description is
 * never document data, the built-in's stand over the prop's absence);
 * `renderAttribute` replaces a row's value zone over its key; the
 * custom-attribute add's entry stands over the list's tail (the button —
 * the popover's type pick + the name's draft + the commit; the row's
 * creation over the type's initial form), and `attributeTypePicker`
 * replaces the popover's built-in type picker. The panel renders over
 * the page's shared editable: its root is a non-editable island (the
 * cross-drag's mousedown guard and the surface's container-targeted
 * dispatch keep their stands over the island's controls).
 *
 * The value zone's stand: every value (the display's stand and the
 * editors') keeps the same padding and the same font size, so the value
 * column's first letters stand one vertical over all the rows (the
 * label's column is the fixed width; the value's zone is the rest).
 *
 *
 * The row's unit files stand the pieces (the convention's one-component
 * files): `AttributesSystemRows` (the system's rows),
 * `AttributeDescriptionRow` (the description's row),
 * `AttributesPresetRows` (the preset's rows), `AttributesCustomRows`
 * (the custom's rows + the drag's reorder), `AttributeRow` (the row's
 * frame), `DraggableAttributeRow` (the drag's wrapper), `DisplayValue`
 * (the display's stand), `TagsZone` / `ListEditor` / `CoverEditor` (the
 * preset's editors), `AddAttributePopover` (the add's entry),
 * `use-attribute-writes` (the writes' entries), `value-utils` (the
 * value's pure reads).
 */
import { useTranslation } from "react-i18next";
import { useStore } from "zustand";

import type { ReactNode } from "react";
import { useState } from "react";

import type { AttributeType, DocAttributeValue } from "docblocks-core";
import { InvalidAttributeError } from "docblocks-core";

import { useEditorContext } from "../editor-provider";
import { cn } from "../shared/ui/cn";
import { ChevronDown } from "../shared/ui/icons";
import { AddAttributePopover } from "./AddAttributePopover";
import { AttributeDescriptionRow } from "./AttributeDescriptionRow";
import { AttributesCustomRows } from "./AttributesCustomRows";
import { AttributesPresetRows } from "./AttributesPresetRows";
import { AttributesSystemRows } from "./AttributesSystemRows";
import { useAttributeWrites } from "./use-attribute-writes";
import { initialFormOf } from "./value-utils";

/** The panel's props (none — the panel reads the editor context; it stands
 *  over the editor's subtree only). */
function AttributesPanel() {
  const { t } = useTranslation("editor");
  const { store, doc, viewMode, hiddenAttributes, renderAttribute, attributeTypePicker, docTags, docDescription } =
    useEditorContext();
  const meta = useStore(store, (state) => state.meta);
  // The per-change stamp: the live `lastUpdatedAt` row re-renders over
  // every store write (the `meta` slice is replaced only over the
  // `metaChanged`, the Yjs-only `updatedAt` moves on every transaction).
  useStore(store, (state) => state.changeStamp);
  // The collapse's session state (the default: collapsed).
  const [open, setOpen] = useState(false);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const attributes = meta.attributes ?? {};
  const value = (key: string): DocAttributeValue | undefined => attributes[key];
  const { set, remove, rename, renamingKey, renameInvalid, setRenamingKey, setRenameInvalid } = useAttributeWrites(doc);

  /** The add flow's commit: the name stands the key, the typed value stands
   *  the type's initial form (the value's edit stands the row's own zone;
   *  the mention's name stands the target's id). The error string's stand
   *  (the reserved key's rejection) is the popover's display input. */
  const addAttribute = (key: string, type: AttributeType): string | null => {
    try {
      doc.setAttribute(key, initialFormOf(key, type));
      return null;
    } catch (error) {
      // The name is the only user-controlled input here: the only rejection
      // over a valid typed form is the reserved key's stand.
      if (error instanceof InvalidAttributeError) return t("attributes.keyReserved");
      return null;
    }
  };

  /** The value zone's stand: the consumer's `renderAttribute` over the
   *  key (the built-in editor's stand over the `null` / the absent). */
  const valueZone = (key: string, defaultZone: ReactNode): ReactNode => {
    if (renderAttribute === null) return defaultZone;
    const node = renderAttribute({
      key,
      value: value(key),
      onChange: (v) => set(key, v),
      onRemove: () => remove(key),
      readOnly: viewMode,
    });
    return node === null ? defaultZone : node;
  };

  // The "Not set" placeholder: the font matches the value texts
  // (text-sm); the 6 px inset comes from the zone's own wrapper (the
  // display button, the display span, or the tags zone wrapper).
  const notSet = <span className="text-sm text-muted-foreground">{t("attributes.notSet")}</span>;

  return (
    <div data-slot="docblocks/attributes" contentEditable={false} suppressContentEditableWarning className="mb-4">
      <button
        type="button"
        data-slot="docblocks/attributes-toggle"
        aria-expanded={open}
        aria-label={t("attributes.toggleAria")}
        className="
          flex w-full items-center gap-1.5 rounded-md px-1.5 py-1 text-left text-sm font-medium text-muted-foreground
          hover:bg-muted/50 hover:text-foreground
        "
        onClick={() => setOpen((next) => !next)}
      >
        <ChevronDown className={cn("size-3.5 transition-transform", !open && "-rotate-90")} />
        {t("attributes.title")}
      </button>
      {open ? (
        <div data-slot="docblocks/attributes-body" className="mt-1 flex flex-col gap-1 border-t border-muted pt-1.5">
          <AttributesSystemRows meta={meta} doc={doc} hiddenAttributes={hiddenAttributes} />
          <AttributeDescriptionRow
            attributes={attributes}
            hiddenAttributes={hiddenAttributes}
            viewMode={viewMode}
            docDescription={docDescription}
            editingKey={editingKey}
            setEditingKey={setEditingKey}
            valueZone={valueZone}
            set={set}
            remove={remove}
            notSet={notSet}
          />
          <AttributesPresetRows
            attributes={attributes}
            hiddenAttributes={hiddenAttributes}
            viewMode={viewMode}
            docTags={docTags}
            valueZone={valueZone}
            set={set}
            remove={remove}
            notSet={notSet}
          />
          <AttributesCustomRows
            doc={doc}
            meta={meta}
            attributes={attributes}
            viewMode={viewMode}
            editingKey={editingKey}
            setEditingKey={setEditingKey}
            renamingKey={renamingKey}
            renameInvalid={renameInvalid}
            setRenamingKey={setRenamingKey}
            setRenameInvalid={setRenameInvalid}
            rename={rename}
            set={set}
            remove={remove}
            valueZone={valueZone}
          />
          {viewMode ? null : <AddAttributePopover onAdd={addAttribute} typePicker={attributeTypePicker} />}
        </div>
      ) : null}
    </div>
  );
}

export { AttributesPanel };
