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
 * events — the tags are never document data); `renderAttribute` replaces a row's value zone over its key; the
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
 * The row's unit files stand the pieces (the convention's one-component
 * files): `AttributeRow` (the row's frame), `DraggableAttributeRow` (the
 * drag's wrapper), `DisplayValue` (the display's stand), `TagsZone` /
 * `ListEditor` / `CoverEditor` (the preset's editors),
 * `AddAttributePopover` (the add's entry), `value-utils` (the value's
 * pure reads).
 */
import { Reorder } from "framer-motion";
import { useTranslation } from "react-i18next";
import { useStore } from "zustand";

import type { ReactNode } from "react";
import { useLayoutEffect, useRef, useState } from "react";

import { InvalidAttributeError } from "docblocks-core";
import type { AttributeType, DocAttributeValue } from "docblocks-core";

import { useEditorContext } from "../editor-provider";
import { InlineEditInput } from "../shared/ui/InlineEditInput";
import { SegmentSelector } from "../shared/ui/SegmentSelector";
import { cn } from "../shared/ui/cn";
import { ChevronDown } from "../shared/ui/icons";
import { AddAttributePopover } from "./AddAttributePopover";
import { AttributeRow } from "./AttributeRow";
import { CoverEditor } from "./CoverEditor";
import { coverModeOf } from "./cover";
import type { CoverMode } from "./cover";
import { CustomAttributeRow } from "./CustomAttributeRow";
import { DisplayValue } from "./DisplayValue";
import { DraggableAttributeRow } from "./DraggableAttributeRow";
import { TagsZone } from "./TagsZone";
import {
  displayPublishedDate,
  formatDate,
  initialFormOf,
  isPresetKey,
  orderedCustomKeys,
  typedValueOf,
} from "./value-utils";

/** The panel's props (none — the panel reads the editor context; it stands
 *  over the editor's subtree only). */
function AttributesPanel() {
  const { t, i18n } = useTranslation("editor");
  const { store, doc, viewMode, hiddenAttributes, renderAttribute, attributeTypePicker, docTags } = useEditorContext();
  const meta = useStore(store, (state) => state.meta);
  // The per-change stamp: the live `lastUpdatedAt` row re-renders over
  // every store write (the `meta` slice is replaced only over the
  // `metaChanged`, the Yjs-only `updatedAt` moves on every transaction).
  useStore(store, (state) => state.changeStamp);
  // The collapse's session state (the default: collapsed).
  const [open, setOpen] = useState(false);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  // The rename's state (the custom key's inline edit over the key's
  // column): the open's key + the invalid's stand (the commit's typed
  // error's keep — the input's open stand over the invalid's border,
  // the re-type's stand).
  const [renamingKey, setRenamingKey] = useState<string | null>(null);
  const [renameInvalid, setRenameInvalid] = useState(false);

  const attributes = meta.attributes ?? {};
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

  const set = (key: string, v: DocAttributeValue): void => {
    try {
      doc.setAttribute(key, v);
    } catch {
      // The boundary validation (a reserved key / the value form) stands
      // the typed error — the panel's write entry never throws (the
      // display-only stand's parity).
    }
  };
  const remove = (key: string): void => {
    try {
      doc.removeAttribute(key);
    } catch {
      // The reserved key's rejection stands the silent stand (the row is
      // not a reserved key's row — the custom rows are the writable stand).
    }
  };
  const rename = (key: string, next: string): void => {
    const trimmed = next.trim();
    if (trimmed === "" || trimmed === key) {
      // The empty's / the same key's stand: the cancel (no write — the
      // key is required, the rename to the same key is a no-op).
      setRenamingKey(null);
      setRenameInvalid(false);
      return;
    }
    try {
      doc.renameAttribute(key, trimmed);
      setRenamingKey(null);
      setRenameInvalid(false);
    } catch (error) {
      if (error instanceof InvalidAttributeError) {
        // The invalid target (the reserved / the taken key): the input's
        // open stand over the invalid's border (the re-type's stand).
        setRenameInvalid(true);
        return;
      }
      // The panel's write entry never throws (the display-only stand's
      // parity over the unexpected's rejection).
      setRenamingKey(null);
      setRenameInvalid(false);
    }
  };
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

  // The custom keys (every non-preset key of the record). The display's
  // order stands the stored `meta.attributesOrder` (the stale entries'
  // drop, the missing keys' append over the record's key order; the
  // record's key order over the field's absence) — the base's rows stand
  // a fixed order of their own (the preset keys' order's entries are
  // ignored), the custom keys stand the last-added's stand over the
  // drag-free state.
  const customKeysAll = Object.keys(attributes).filter((key) => !isPresetKey(key));
  const derivedCustomOrder = orderedCustomKeys(meta.attributesOrder, customKeysAll);
  // The drag's preview's order (the framer reorder's live stand — the
  // doc/wire stand untouched over the drag; the release commits it).
  const [dragOrder, setDragOrder] = useState<string[] | null>(null);
  // The drag session's stand (the release's commit input + the resync's gate).
  const [dragging, setDragging] = useState(false);
  const dragOrderRef = useRef<string[] | null>(null);
  useLayoutEffect(() => {
    dragOrderRef.current = dragOrder;
  }, [dragOrder]);
  // A record change (a remote / a local add-remove) invalidates the
  // preview (a stale key's drag would stand the commit's rejection):
  // the key sets' divergence clears it over every state (the drag's
  // in-flight stand included — the row's unmount stands the same guard
  // over the framer's no-onDragEnd delivery).
  if (
    dragOrder !== null &&
    (dragOrder.some((key) => !customKeysAll.includes(key)) || customKeysAll.some((key) => !dragOrder.includes(key)))
  ) {
    setDragOrder(null);
    setDragging(false);
  }
  // A store change over the drag-free state resyncs the preview (a
  // committed reorder re-reads the store's order).
  if (!dragging && dragOrder !== null && dragOrder.join("\u0000") !== derivedCustomOrder.join("\u0000")) {
    setDragOrder(null);
  }
  const displayCustomKeys = dragOrder ?? derivedCustomOrder;

  /** The release's commit: the preview's custom order stands over the full
   *  order's custom slots (the non-custom keys' stand over their positions —
   *  the preset keys' slots keep their stand). One command (one undo step);
   *  the stale drag (a peer's record change over the drag) stands the
   *  no-write (the resync snaps the display). */
  const commitCustomReorder = (): void => {
    setDragging(false);
    const preview = dragOrderRef.current;
    setDragOrder(null);
    dragOrderRef.current = null;
    if (preview === null) return;
    const metaNow = doc.meta;
    const full = metaNow.attributesOrder ?? Object.keys(metaNow.attributes ?? {});
    const previewSet = new Set(preview);
    let index = 0;
    const nextFull: string[] = [];
    for (const key of full) {
      // The preview's slot stand (the preview covers the drag's custom keys;
      // a key outside the preview keeps its position — the stale drag's
      // commit stands the rejection's no-write).
      const slot = !isPresetKey(key) && previewSet.has(key) ? preview[index] : undefined;
      if (slot !== undefined) {
        index += 1;
        nextFull.push(slot);
      } else {
        nextFull.push(key);
      }
    }
    try {
      doc.reorderAttributes(nextFull);
    } catch {
      // The stale drag's rejection stands the no-write (the resync's stand).
    }
  };

  const locale = i18n.language;

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

  /** The custom row's stand (the key's rename's entry over the key's
   *  column; the value zone's editors over the type's stand). */
  /** The custom value's commit (the type's parsing's stand: the empty's
   *  removal, the plain's plain write, the typed's typed write-back —
   *  the invalid number's no-write's stand). */
  const commitCustomValue = (key: string, next: string): void => {
    const trimmed = next.trim();
    if (trimmed === "") {
      remove(key);
      return;
    }
    const typed = typedValueOf(attributes[key]);
    if (typed === null) {
      set(key, trimmed);
      return;
    }
    switch (typed.type) {
      case "string":
        set(key, { type: "string", value: trimmed });
        break;
      case "number": {
        const n = Number(trimmed);
        if (!Number.isFinite(n)) return;
        set(key, { type: "number", value: n });
        break;
      }
      case "list":
        // The list's stand is the line editor's path (the
        // comma's input's stand dropped).
        set(key, {
          type: "list",
          value: trimmed
            .split(",")
            .map((item) => item.trim())
            .filter((item) => item !== ""),
        });
        break;
      case "mention":
        set(key, { type: "mention", value: { id: trimmed } });
        break;
    }
  };

  /** The list form's read (the grip's top align's stand over the list's
   *  rows — the grip stands opposite the first line over the stack). */
  const isListCustom = (key: string): boolean => {
    const v = attributes[key];
    return Array.isArray(v) || typedValueOf(v)?.type === "list";
  };

  /** The custom row's stand (the `CustomAttributeRow`'s unit — the key's
   *  rename's entry + the value zone's editors over the type's stand). */
  const renderCustomRow = (key: string): ReactNode => (
    <CustomAttributeRow
      key={key}
      keyName={key}
      value={attributes[key]}
      viewMode={viewMode}
      editing={editingKey === `custom:${key}`}
      onEditStart={() => setEditingKey(`custom:${key}`)}
      onEditCommit={(next) => {
        setEditingKey(null);
        commitCustomValue(key, next);
      }}
      onEditCancel={() => setEditingKey(null)}
      renaming={renamingKey === key}
      renameInvalid={renameInvalid}
      onRenameStart={() => {
        setRenamingKey(key);
        setRenameInvalid(false);
      }}
      onRenameCommit={(next) => rename(key, next)}
      onRenameCancel={() => {
        setRenamingKey(null);
        setRenameInvalid(false);
      }}
      onRemove={() => remove(key)}
      setValue={(v) => set(key, v)}
      valueZone={(zone) => valueZone(key, zone)}
    />
  );

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
          {hidden.has("id") ? null : (
            <AttributeRow key="id" attributeKey="id" label={t("attributes.id")} removable={false}>
              <span className="block px-1.5 py-1 font-mono text-sm break-all">{meta.id}</span>
            </AttributeRow>
          )}
          {hidden.has("createdAt") ? null : (
            <AttributeRow key="createdAt" attributeKey="createdAt" label={t("attributes.createdAt")} removable={false}>
              <span className="block truncate px-1.5 py-1 text-sm">{formatDate(meta.createdAt, locale)}</span>
            </AttributeRow>
          )}
          {hidden.has("updatedAt") ? null : (
            <AttributeRow
              key="updatedAt"
              attributeKey="updatedAt"
              label={t("attributes.lastUpdatedAt")}
              removable={false}
            >
              <span className="block truncate px-1.5 py-1 text-sm">
                {formatDate(doc.lastUpdatedAt ?? meta.createdAt, locale)}
              </span>
            </AttributeRow>
          )}

          {hidden.has("description") ? null : (
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
          )}

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
            // The cover's placement mode's row (the row's mode selector —
            // the modal's selector's parity; the disabled stand over the
            // read-only's modes). The row stands over the cover's presence
            // (a mode over no cover stands inert).
            <AttributeRow key="coverMode" attributeKey="coverMode" label={t("attributes.coverMode")} removable={false}>
              {valueZone(
                "coverMode",
                <SegmentSelector
                  size="text"
                  ariaLabel={t("attributes.coverMode")}
                  slot="docblocks/attributes-cover-mode"
                  pillSlot="docblocks/attributes-cover-mode-pill"
                  buttonAttrName="mode"
                  options={[
                    { value: "tile", label: t("attributes.coverModeTile"), disabled: viewMode },
                    { value: "center", label: t("attributes.coverModeCenter"), disabled: viewMode },
                  ]}
                  value={coverMode}
                  onChange={(next) => {
                    // The no-op over the current mode's stand: the write
                    // is a single command only over the change.
                    if (next === coverMode) return;
                    if (next === "center") set("coverMode", "center");
                    else remove("coverMode");
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

          {/* The custom rows' stand: the drag's preview over the edit mode
            (the `Reorder.Group`'s live reorder + the rows' position slide —
            the blocks' rows' parity), the display-only's stand over the
            read-only modes (no grip, no drag). */}
          {viewMode ? (
            <div data-slot="docblocks/attributes-custom" className="flex flex-col gap-1">
              {displayCustomKeys.map((key) => renderCustomRow(key))}
            </div>
          ) : (
            <Reorder.Group
              as="div"
              data-slot="docblocks/attributes-custom"
              axis="y"
              values={displayCustomKeys}
              onReorder={(next: string[]) => setDragOrder(next)}
              className="flex flex-col gap-1"
            >
              {displayCustomKeys.map((key) => (
                <DraggableAttributeRow
                  key={key}
                  attributeKey={key}
                  topAlign={isListCustom(key)}
                  onDragStart={() => setDragging(true)}
                  onDragEnd={commitCustomReorder}
                >
                  {renderCustomRow(key)}
                </DraggableAttributeRow>
              ))}
            </Reorder.Group>
          )}

          {viewMode ? null : <AddAttributePopover onAdd={addAttribute} typePicker={attributeTypePicker} />}
        </div>
      ) : null}
    </div>
  );
}

export { AttributesPanel };
