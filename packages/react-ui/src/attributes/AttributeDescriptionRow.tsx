/** The panel's description row: the consumer-owned stand over the
 *  `docDescription`'s prop (the document never stores or syncs it — the
 *  consumer's store is the source, the panel's edit reports over
 *  `onEdit`: no doc write, no wire, no undo), the built-in's stand over
 *  the prop's absence (the legacy's stored `attributes.description`
 *  stands inert). */
import { useTranslation } from "react-i18next";

import type { ReactNode } from "react";

import type { DocAttributeValue } from "docblocks-core";

import type { DocDescription } from "../editor-provider";
import { InlineEditInput } from "../shared/ui/InlineEditInput";
import { AttributeRow } from "./AttributeRow";

type DescriptionRowProps = {
  attributes: Record<string, DocAttributeValue>;
  hiddenAttributes: readonly string[];
  viewMode: boolean;
  docDescription: DocDescription | null;
  /** The inline edit's open stand (the panel's `editingKey`'s read). */
  editingKey: string | null;
  setEditingKey: (key: string | null) => void;
  /** The value zone's delegation (the consumer's `renderAttribute`'s
   *  stand over the key; the built-in zone's pass-through over the
   *  absent). */
  valueZone: (key: string, zone: ReactNode) => ReactNode;
  set: (key: string, v: DocAttributeValue) => void;
  remove: (key: string) => void;
  /** The "Not set" placeholder (the panel's shared stand). */
  notSet: ReactNode;
};

function AttributeDescriptionRow({
  attributes,
  hiddenAttributes,
  viewMode,
  docDescription,
  editingKey,
  setEditingKey,
  valueZone,
  set,
  remove,
  notSet,
}: DescriptionRowProps) {
  const { t } = useTranslation("editor");
  const hidden = new Set(hiddenAttributes);
  const has = (key: string): boolean => key in attributes;
  /** The string read (the preset rows' value stand: a non-string stands absent). */
  const stringValue = (key: string): string | undefined => {
    const v = attributes[key];
    return typeof v === "string" ? v : undefined;
  };
  // The description's consumer-owned read (the `docDescription`'s prop —
  // the document never stores or syncs it; over the prop's presence the
  // stored `attributes.description` stands inert). The edit affordance's
  // gate: the edit mode + the consumer's `onEdit` entry.
  const consumerDescriptionValue = docDescription !== null ? (docDescription.value ?? "") : "";
  const descriptionEditable = docDescription !== null && docDescription.onEdit !== undefined && !viewMode;
  const inlineEdit = (
    key: string,
    slot: string,
    label: string,
    initial: string,
    commit: (next: string) => void,
    placeholder?: string
  ): ReactNode => (
    <InlineEditInput
      initial={initial}
      ariaLabel={label}
      slot={slot}
      variant="inline"
      // The edit's frame stands the display's band's box (the
      // height's parity over the click).
      className="h-7"
      placeholder={placeholder}
      onCommit={commit}
      onCancel={() => setEditingKey(null)}
    />
  );

  const inlineDisplayButton = (key: string, slot: string, label: string, display: ReactNode): ReactNode =>
    viewMode || editingKey !== key ? (
      <button
        type="button"
        data-slot={slot}
        aria-label={t("attributes.editAria", { name: label })}
        className="w-full truncate rounded-md px-1.5 py-1 text-left text-sm hover:bg-muted/50"
        onClick={() => {
          if (!viewMode) setEditingKey(key);
        }}
      >
        {display}
      </button>
    ) : null;

  return (
    <>
      {hidden.has("description") ? null : docDescription === null ? (
        <AttributeRow
          key="description"
          attributeKey="description"
          label={t("attributes.description")}
          removable={has("description") && !viewMode}
          onRemove={() => remove("description")}
          removeAria={t("attributes.removeAria", { name: t("attributes.description") })}
        >
          {valueZone(
            "description",
            inlineDisplayButton(
              "description",
              "docblocks/attributes-description",
              t("attributes.description"),
              stringValue("description") !== undefined && stringValue("description") !== ""
                ? stringValue("description")
                : notSet
            ) ??
              inlineEdit(
                "description",
                "docblocks/attributes-description-edit",
                t("attributes.editAria", { name: t("attributes.description") }),
                stringValue("description") ?? "",
                (next) => {
                  setEditingKey(null);
                  if (next === "") remove("description");
                  else set("description", next);
                }
              )
          )}
        </AttributeRow>
      ) : (
        // The description's consumer-owned stand (the `docDescription`'s
        // prop — the document never stores or syncs it — the consumer's
        // store is the source, the panel's edit reports over `onEdit`:
        // no doc write, no wire, no undo). The row stands out of the
        // `renderAttribute`'s reach (like the `tags`'s row); the legacy's
        // stored `attributes.description` stands inert (the consumer's
        // migration's read over `doc.meta.attributes`).
        <AttributeRow
          key="description"
          attributeKey="description"
          label={t("attributes.description")}
          removable={descriptionEditable && consumerDescriptionValue !== ""}
          onRemove={() => docDescription.onEdit?.("")}
          removeAria={t("attributes.removeAria", { name: t("attributes.description") })}
        >
          {descriptionEditable && editingKey === "description" ? (
            inlineEdit(
              "description",
              "docblocks/attributes-description-edit",
              t("attributes.editAria", { name: t("attributes.description") }),
              consumerDescriptionValue,
              (next) => {
                setEditingKey(null);
                docDescription.onEdit?.(next);
              }
            )
          ) : descriptionEditable ? (
            <button
              type="button"
              data-slot="docblocks/attributes-description"
              aria-label={t("attributes.editAria", { name: t("attributes.description") })}
              className="w-full truncate rounded-md px-1.5 py-1 text-left text-sm hover:bg-muted/50"
              onClick={() => setEditingKey("description")}
            >
              {consumerDescriptionValue !== "" ? consumerDescriptionValue : notSet}
            </button>
          ) : (
            // The display-only's stand (the read-only's mode or the
            // absent `onEdit`): the plain value (the no dead edit's
            // affordance over the row's zone).
            <span data-slot="docblocks/attributes-description" className="block truncate px-1.5 py-1 text-sm">
              {consumerDescriptionValue !== "" ? consumerDescriptionValue : notSet}
            </span>
          )}
        </AttributeRow>
      )}
    </>
  );
}

export { AttributeDescriptionRow };
