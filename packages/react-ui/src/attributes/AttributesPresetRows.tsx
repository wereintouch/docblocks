/** The panel's preset rows (the consumer-facing vocabulary's stand):
 *  the tags (the consumer-owned stand over the `docTags`'s prop — the
 *  tags are never document data), the createdBy (the id-only creator —
 *  display-only), the cover + its placement mode's and the frame's
 *  tint's rows, the status (the display-only stand — the consumer's
 *  data, the panel's editor stands absent), and the publishedAt (the
 *  display-only stand — the consumer-owned date). */
import { useTranslation } from "react-i18next";

import type { ReactNode } from "react";

import type { DocAttributeValue } from "docblocks-core";

import type { DocTags } from "../editor-provider";
import { Checkbox } from "../shared/ui/Checkbox";
import { AttributeRow } from "./AttributeRow";
import { CoverEditor } from "./CoverEditor";
import { CoverModeSelector } from "./CoverModeSelector";
import { DisplayValue } from "./DisplayValue";
import { TagsZone } from "./TagsZone";
import { coverModeOf } from "./cover";
import type { CoverMode } from "./cover";
import { displayPublishedDate } from "./value-utils";

type PresetRowsProps = {
  attributes: Record<string, DocAttributeValue>;
  hiddenAttributes: readonly string[];
  viewMode: boolean;
  /** The consumer's tags stand (the chips + the events' callbacks). */
  docTags: DocTags | null;
  /** The value zone's delegation (the consumer's `renderAttribute`'s
   *  stand over the key; the built-in zone's pass-through over the
   *  absent). */
  valueZone: (key: string, zone: ReactNode) => ReactNode;
  set: (key: string, v: DocAttributeValue) => void;
  remove: (key: string) => void;
  /** The "Not set" placeholder (the panel's shared stand). */
  notSet: ReactNode;
};

function AttributesPresetRows({
  attributes,
  hiddenAttributes,
  viewMode,
  docTags,
  valueZone,
  set,
  remove,
  notSet,
}: PresetRowsProps) {
  const { t, i18n } = useTranslation("editor");
  const hidden = new Set(hiddenAttributes);
  const has = (key: string): boolean => key in attributes;
  const value = (key: string): DocAttributeValue | undefined => attributes[key];
  /** The string read (the preset rows' value stand: a non-string stands absent). */
  const stringValue = (key: string): string | undefined => {
    const v = attributes[key];
    return typeof v === "string" ? v : undefined;
  };
  // The cover's placement mode's read (the absent's / the invalid's
  // stand is the tile — the stored vocabulary is the "center"'s single
  // entry).
  const coverMode: CoverMode = coverModeOf(value("coverMode"));
  const locale = i18n.language;

  return (
    <>
      {hidden.has("tags") ? null : (
        // The tags' consumer-owned stand (the `docTags`'s prop — the
        // document never stores the tags): the chips over the passed
        // list + the events (the add's click / the removal / the
        // chip's click); the display-only stand over the prop's
        // absence (the legacy's stored `attributes.tags`'s inert stand).
        <AttributeRow key="tags" attributeKey="tags" label={t("attributes.tags")} removable={false}>
          {/* The zone's band wrapper: the chips and the placeholder
            keep the 6 px inset over the column edge, like the
            button-wrapped values do. */}
          <span className="flex min-w-0 flex-1 items-center px-1.5 py-1">
            {docTags === null ? (
              notSet
            ) : (
              <TagsZone
                tags={docTags.tags}
                readOnly={viewMode}
                onTagAdd={docTags.onTagAdd}
                onTagRemove={docTags.onTagRemove}
                onTagClick={docTags.onTagClick}
              />
            )}
          </span>
        </AttributeRow>
      )}

      {hidden.has("createdBy") ? null : (
        <AttributeRow key="createdBy" attributeKey="createdBy" label={t("attributes.createdBy")} removable={false}>
          {valueZone("createdBy", <DisplayValue value={value("createdBy")} placeholder={t("attributes.notSet")} />)}
        </AttributeRow>
      )}

      {hidden.has("cover") ? null : (
        <AttributeRow
          key="cover"
          attributeKey="cover"
          label={t("attributes.cover")}
          removable={has("cover") && !viewMode}
          onRemove={() => remove("cover")}
          removeAria={t("attributes.removeAria", { name: t("attributes.cover") })}
        >
          {valueZone(
            "cover",
            <CoverEditor
              fileId={stringValue("cover")}
              mode={coverMode}
              readOnly={viewMode}
              onCommit={(id, mode) => {
                // The commit's write stands one command over the id and
                // one over the centering's mode (the tile's stand is the
                // key's absence — its commit stands the key's removal).
                set("cover", id);
                if (mode === "center") set("coverMode", "center");
                else remove("coverMode");
              }}
              onClear={() => remove("cover")}
            />
          )}
        </AttributeRow>
      )}

      {has("cover") && !hidden.has("coverMode") ? (
        // The cover's placement mode's row (the mode's toggle with the
        // switch's gate: an option stands disabled when its gate is
        // known unmet over the current image; the row stands over the
        // cover's presence — a mode over no cover stands inert).
        <AttributeRow key="coverMode" attributeKey="coverMode" label={t("attributes.coverMode")} removable={false}>
          {valueZone(
            "coverMode",
            <CoverModeSelector
              coverId={stringValue("cover") ?? ""}
              mode={coverMode}
              readOnly={viewMode}
              onChange={(next) => {
                if (next === "center") set("coverMode", "center");
                else remove("coverMode");
              }}
            />
          )}
        </AttributeRow>
      ) : null}

      {has("cover") && !hidden.has("coverTint") ? (
        // The frame's tint's row (the checkbox with the absence's
        // default's stand: the on is the key's absence, the off stands
        // the explicit's `false`'s write — the row stands over the
        // cover's presence, like the mode's row).
        <AttributeRow key="coverTint" attributeKey="coverTint" label={t("attributes.coverTint")} removable={false}>
          {valueZone(
            "coverTint",
            <Checkbox
              data-slot="docblocks/attributes-cover-tint"
              aria-label={t("attributes.coverTintAria")}
              checked={value("coverTint") !== false}
              disabled={viewMode}
              onCheckedChange={(next) => {
                if (next === true) remove("coverTint");
                else set("coverTint", false);
              }}
            />
          )}
        </AttributeRow>
      ) : null}

      {hidden.has("status") ? null : (
        // The status's stand is display-only: the consumer's own data
        // (the consumer passes the published's state over its own
        // write / `renderAttribute` — the panel's editor stands
        // absent, over the edit mode too).
        <AttributeRow key="status" attributeKey="status" label={t("attributes.status")} removable={false}>
          {valueZone("status", <DisplayValue value={value("status")} placeholder={t("attributes.notSet")} />)}
        </AttributeRow>
      )}

      {hidden.has("publishedAt") ? null : (
        // The publishedAt row is display-only: the value is
        // consumer-owned (the consumer passes the published date over
        // its own write / `renderAttribute` — the panel has no editor
        // for it, even in the edit mode). The display shows the
        // locale's date over the parseable ISO string; the raw
        // string stands otherwise.
        <AttributeRow
          key="publishedAt"
          attributeKey="publishedAt"
          label={t("attributes.publishedAt")}
          removable={false}
        >
          {(() => {
            const raw = stringValue("publishedAt");
            return valueZone(
              "publishedAt",
              <span data-slot="docblocks/attributes-published-at" className="block truncate px-1.5 py-1 text-sm">
                {raw === undefined || raw === "" ? notSet : displayPublishedDate(raw, locale)}
              </span>
            );
          })()}
        </AttributeRow>
      )}
    </>
  );
}

export { AttributesPresetRows };
