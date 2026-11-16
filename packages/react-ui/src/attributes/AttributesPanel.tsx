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
 * keys, the system rows); `tagEditor` replaces the default tags editor;
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
 */
import { Reorder, useDragControls } from "framer-motion";
import { useTranslation } from "react-i18next";
import { useStore } from "zustand";

import { useLayoutEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";

import { ATTRIBUTE_TYPES, InvalidAttributeError } from "docblocks-core";
import type { AttributeType, DocAttributeValue, MentionRef, TypedAttributeValue } from "docblocks-core";

import { useBlobFile } from "../blocks/use-blob-file";
import { useEditorContext } from "../editor-provider";
import { TRANSITION } from "../motion/constants";
import { Button } from "../shared/ui/Button";
import { Checkbox } from "../shared/ui/Checkbox";
import { InlineEditInput } from "../shared/ui/InlineEditInput";
import { Input } from "../shared/ui/Input";
import { Popover, PopoverContent, PopoverTrigger } from "../shared/ui/Popover";
import { SegmentSelector } from "../shared/ui/SegmentSelector";
import { cn } from "../shared/ui/cn";
import { ChevronDown, GripVertical, Image, Plus, Trash, X } from "../shared/ui/icons";
import { PRESET_KEYS } from "./presets";

/** The mention reference's read (the id-only stand; the legacy label's
 *  snapshot stands tolerated). */
const mentionRefOf = (value: DocAttributeValue | undefined): MentionRef | null => {
  if (value === undefined || value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  return typeof record.id === "string" && record.id !== "" ? (value as MentionRef) : null;
};

/** The typed attribute value's read (the custom attribute's storage form:
 *  the declared `type` + the `value` over its form). */
const typedValueOf = (value: DocAttributeValue | undefined): TypedAttributeValue | null => {
  if (value === undefined || value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  if (keys.length !== 2 || typeof record.type !== "string" || !("value" in record)) return null;
  return (value as TypedAttributeValue) ?? null;
};

/** The preset key's read (the panel's fixed rows' vocabulary — the
 *  preset-ness is the UI's knowledge, the record's keys stand the
 *  generic data contract). */
const isPresetKey = (key: string): boolean => (PRESET_KEYS as readonly string[]).includes(key);

/** The custom keys' display order over the stored `attributesOrder`:
 *  the stale entries stand dropped, the duplicates stand first-occurrence,
 *  and the record's keys missing from the order append in the record's
 *  key order. An absent order stands the record's key order (the
 *  reader's fallback — the last-added's stand over the new docs). */
function orderedCustomKeys(order: string[] | undefined, customKeys: string[]): string[] {
  if (order === undefined) return customKeys;
  const keySet = new Set(customKeys);
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const key of order) {
    if (keySet.has(key) && !seen.has(key)) {
      seen.add(key);
      ordered.push(key);
    }
  }
  for (const key of customKeys) {
    if (!seen.has(key)) ordered.push(key);
  }
  return ordered;
}

/** The value zone's stand over a display-only value (the typed value
 *  stands its inner value's display; the mention reference stands its id). */
function displayTextOf(value: DocAttributeValue | undefined): string | null {
  if (value === undefined) return null;
  const typed = typedValueOf(value);
  if (typed !== null) return displayTextOf(typed.value);
  if (Array.isArray(value)) return value.join(", ");
  if (typeof value === "boolean") return String(value);
  const mention = mentionRefOf(value);
  if (mention !== null) return mention.id;
  return String(value);
}

/** The locale's date stand (the date only, no time): the panel's locale
 *  (the consumer's `<html lang>` / the controlled `locale`) over the
 *  `Intl.DateTimeFormat`'s medium date; a non-parseable stand keeps the
 *  raw ISO. */
function formatDate(iso: string | undefined, locale: string): string {
  if (iso === undefined) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  try {
    return new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(date);
  } catch {
    return iso;
  }
}

/** The published date's display stand: a parseable ISO stands the locale's
 *  date (the data keeps the raw value — the edit's input stands the raw
 *  stand); a non-parseable stand stands the raw string. */
function displayPublishedDate(value: string | undefined, locale: string): string | null {
  if (value === undefined || value === "") return null;
  return formatDate(value, locale);
}

/** The attribute row's frame: the fixed label column + the value zone +
 *  the optional remove button. The label and the value share the font
 *  size (the value's zone keeps its own padding — the column's stand). */
function AttributeRow({
  attributeKey,
  label,
  removable,
  onRemove,
  removeAria,
  topAlign,
  children,
}: {
  attributeKey: string;
  label: string;
  removable: boolean;
  onRemove?: () => void;
  removeAria?: string;
  /** The label stands opposite the FIRST line over the multi-line value
   *  zone (the list's stack) — the row's center stand dropped. */
  topAlign?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      data-slot="docblocks/attribute-row"
      data-attribute-key={attributeKey}
      className="flex min-h-11 items-center gap-3 py-1.5"
    >
      <span className={cn("w-28 shrink-0 truncate text-sm text-muted-foreground", topAlign && "mt-1.5 self-start")}>
        {label}
      </span>
      {/* The zone's flex's stand (the content's vertical center): the zone
        inherits the page's line-height (the 16px's stand over the shared
        editable), so a block container over an inline-block's editor grows
        over the line box and stands the value's text above the label's
        center. */}
      <div className="flex min-w-0 flex-1 items-center">{children}</div>
      {removable && onRemove !== undefined ? (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={removeAria ?? attributeKey}
          data-slot="docblocks/attribute-row-remove"
          className={cn("size-6 shrink-0 text-muted-foreground hover:text-foreground", topAlign && "mt-1 self-start")}
          onClick={onRemove}
        >
          <Trash className="size-3.5" />
        </Button>
      ) : null}
    </div>
  );
}

/** The display stand (a value's read-only rendering — the value zone's
 *  padding, the uniform font size; the mention reference stands its id
 *  over the monospace stand). */
function DisplayValue({ value, placeholder }: { value: DocAttributeValue | undefined; placeholder: string }) {
  const text = displayTextOf(value);
  if (text === null || text === "")
    return <span className="px-1.5 py-1 text-sm text-muted-foreground">{placeholder}</span>;
  const typed = typedValueOf(value);
  const isMention = mentionRefOf(value) !== null || (typed !== null && typed.type === "mention");
  return <span className={cn("block truncate px-1.5 py-1 text-sm", isMention && "font-mono")}>{text}</span>;
}

/** The custom attribute row's drag wrapper: the framer `Reorder.Item` (the
 *  position-only layout slide over the rows' reflow, the dragged row's
 *  zIndex lift — the blocks' rows' parity) + the gutter grip (the blocks'
 *  grip's parity: the same `--docblocks-gutter-left`'s offset over the
 *  row's column, the hover's reveal). The grip's pointerdown starts the
 *  drag (the grip is the only drag trigger — the row's own drag is
 *  disarmed, a press without movement stays the plain gesture). The
 *  release stands the release's commit (one command — one undo step);
 *  the live reorder over the drag is the preview (the doc/wire stand
 *  untouched until the release). */
function DraggableAttributeRow({
  attributeKey,
  onDragStart,
  onDragEnd,
  children,
}: {
  attributeKey: string;
  onDragStart: () => void;
  onDragEnd: () => void;
  children: React.ReactNode;
}) {
  const { t } = useTranslation("editor");
  const dragControls = useDragControls();
  const onGripPointerDown = (event: ReactPointerEvent<HTMLSpanElement>) => {
    if (event.button !== 0) return;
    // The default's suppression keeps the page editable's focus (a
    // mousedown's default would move the caret into the shared editable
    // and seat it over the panel's island).
    event.preventDefault();
    onDragStart();
    dragControls.start(event);
  };
  return (
    <Reorder.Item
      as="div"
      data-slot="docblocks/attribute-custom-row"
      value={attributeKey}
      dragListener={false}
      dragControls={dragControls}
      onDragEnd={onDragEnd}
      layout="position"
      transition={{ layout: TRANSITION }}
      whileDrag={{ zIndex: 10 }}
      className="group relative"
    >
      <span
        data-slot="docblocks/attribute-row-grip"
        data-attribute-key={attributeKey}
        role="button"
        aria-label={t("attributes.reorderAria", { name: attributeKey })}
        onPointerDown={onGripPointerDown}
        className="
          absolute top-1/2 left-(--docblocks-gutter-left) flex size-5 -translate-y-1/2 cursor-grab touch-none
          items-center justify-center rounded-full text-(--docblocks-gutter-color) opacity-0
          group-hover:opacity-100
          active:cursor-grabbing
        "
      >
        <GripVertical className="size-4" />
      </span>
      {children}
    </Reorder.Item>
  );
}

/** The tags editor (the default stand): the chips + the add input. Every
 *  change commits the whole list (one `setAttribute`). */
function TagsEditor({
  tags,
  readOnly,
  onTagsChange,
}: {
  tags: readonly string[];
  readOnly: boolean;
  onTagsChange: (tags: string[]) => void;
}) {
  const { t } = useTranslation("editor");
  const [draft, setDraft] = useState("");

  const commit = (next: string[]): void => {
    if (next.length === tags.length && next.every((tag, index) => tag === tags[index])) return;
    onTagsChange(next);
  };

  const addTag = (raw: string): void => {
    const tag = raw.trim();
    if (tag === "" || tags.includes(tag)) return;
    commit([...tags, tag]);
  };

  return (
    <div data-slot="docblocks/attributes-tags" className="flex flex-wrap items-center gap-1.5">
      {tags.map((tag) => (
        <span
          key={tag}
          data-slot="docblocks/attributes-tag"
          className="inline-flex items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 text-xs"
        >
          {tag}
          {readOnly ? null : (
            <button
              type="button"
              data-slot="docblocks/attributes-tag-remove"
              aria-label={tag}
              className="text-muted-foreground hover:text-foreground"
              onClick={() => commit(tags.filter((x) => x !== tag))}
            >
              <X className="size-3" />
            </button>
          )}
        </span>
      ))}
      {readOnly ? null : (
        <input
          data-slot="docblocks/attributes-tag-input"
          aria-label={t("attributes.addTagAria")}
          className="
            h-6 min-w-24 flex-1 rounded-md border border-transparent bg-transparent px-1.5 text-sm outline-none
            focus-visible:border-ring
          "
          placeholder={t("attributes.addTagPlaceholder")}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === ",") {
              event.preventDefault();
              addTag(draft);
              setDraft("");
            } else if (event.key === "Backspace" && draft === "" && tags.length > 0) {
              commit(tags.slice(0, -1));
            }
          }}
          onBlur={() => {
            if (draft.trim() !== "") {
              addTag(draft);
              setDraft("");
            }
          }}
        />
      )}
    </div>
  );
}

/** The list editor (the default stand): the vertical's stack of the item's
 *  lines — every line's own input + the line's removal (the × over the
 *  line's right) + the new line's input over the stack's tail (the Enter's
 *  add, the empty's Backspace's last line's removal — the tags' input's
 *  parity). The lines' local stand over the external's resync (the store's
 *  re-read); every discrete change commits the whole list (one
 *  `setAttribute` — the typing's no-commit until the blur / the Enter). */
function ListEditor({
  items,
  name,
  readOnly,
  slot,
  onItemsChange,
}: {
  items: readonly string[];
  /** The attribute's key (the aria's name's stand). */
  name: string;
  readOnly: boolean;
  /** The group's data-slot. */
  slot: string;
  onItemsChange: (items: string[]) => void;
}) {
  const { t } = useTranslation("editor");
  const signature = items.join("\u0000");
  const [lines, setLines] = useState<string[]>(() => [...items]);
  const [lastSync, setLastSync] = useState(signature);
  // The external's change (a remote's edit, the consumer's write) resyncs
  // the lines' stand (the reference's equality over the signature).
  if (signature !== lastSync) {
    setLines([...items]);
    setLastSync(signature);
  }
  const [draft, setDraft] = useState("");
  const addInputRef = useRef<HTMLInputElement | null>(null);

  const commit = (next: string[]): void => {
    if (next.length === items.length && next.every((item, index) => item === items[index])) return;
    onItemsChange(next);
  };
  const changeLine = (index: number, value: string): void => {
    const next = [...lines];
    next[index] = value;
    setLines(next);
  };
  const removeLine = (index: number): void => {
    const next = lines.filter((_, i) => i !== index);
    setLines(next);
    commit(next);
  };
  const addLine = (): void => {
    const item = draft.trim();
    if (item === "") return;
    const next = [...lines, item];
    setLines(next);
    setDraft("");
    commit(next);
  };

  if (readOnly) {
    return (
      <div data-slot={slot} className="flex min-w-0 flex-col items-start">
        {items.length === 0 ? (
          <span className="px-1.5 py-1 text-sm text-muted-foreground">{t("attributes.notSet")}</span>
        ) : (
          items.map((item, index) => (
            <span key={index} data-slot={`${slot}-item`} className="truncate px-1.5 text-sm">
              {item}
            </span>
          ))
        )}
      </div>
    );
  }

  return (
    <div data-slot={slot} className="flex min-w-0 flex-1 flex-col gap-0.5">
      {lines.map((item, index) => (
        <div key={index} className="flex items-center gap-1">
          <input
            data-slot={`${slot}-line`}
            aria-label={t("attributes.listLineAria", { name, index: String(index + 1) })}
            className="
              h-8 min-w-0 flex-1 rounded-md border border-transparent bg-transparent px-1.5 text-sm outline-none
              focus-visible:border-ring
            "
            value={item}
            onChange={(event) => changeLine(index, event.target.value)}
            onBlur={() => commit(lines)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                commit(lines);
                // The line's commit stands the new line's input's focus (the
                // add's path's parity over the tags' input).
                addInputRef.current?.focus();
              }
            }}
          />
          <button
            type="button"
            data-slot={`${slot}-line-remove`}
            aria-label={t("attributes.listLineRemoveAria", { index: String(index + 1) })}
            className="shrink-0 rounded-md p-1 text-muted-foreground hover:bg-muted/50 hover:text-foreground"
            onClick={() => removeLine(index)}
          >
            <X className="size-3.5" />
          </button>
        </div>
      ))}
      <div className="flex items-center gap-1">
        <input
          ref={addInputRef}
          data-slot={`${slot}-input`}
          aria-label={t("attributes.listAddAria", { name })}
          className="
            h-8 min-w-0 flex-1 rounded-md border border-transparent bg-transparent px-1.5 text-sm outline-none
            placeholder:text-muted-foreground/70
            focus-visible:border-ring
          "
          placeholder={t("attributes.listAddPlaceholder")}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === ",") {
              event.preventDefault();
              addLine();
            } else if (event.key === "Backspace" && draft === "" && lines.length > 0) {
              removeLine(lines.length - 1);
            }
          }}
          onBlur={() => {
            if (draft.trim() !== "") addLine();
          }}
        />
      </div>
    </div>
  );
}

/** The cover's stand (the file id over the blob store: the thumbnail /
 *  the upload entry / the remove; the read-only stand stands the
 *  thumbnail display-only). */
function CoverEditor({
  fileId,
  readOnly,
  onSet,
  onClear,
}: {
  fileId: string | undefined;
  readOnly: boolean;
  onSet: (id: string) => void;
  onClear: () => void;
}) {
  const { t } = useTranslation("editor");
  const { blobStore } = useEditorContext();
  const file = useBlobFile(fileId ?? "", (mimeType) => mimeType.startsWith("image/"));
  const inputRef = useRef<HTMLInputElement | null>(null);

  const onUpload = async (event: React.ChangeEvent<HTMLInputElement>): Promise<void> => {
    const fileInput = event.target.files?.[0];
    if (fileInput === undefined) return;
    try {
      const id = await blobStore.upload(fileInput);
      onSet(id);
    } finally {
      event.target.value = "";
    }
  };

  return (
    <div className="flex items-center gap-2">
      {fileId !== undefined && (file.status === "ready" || file.status === "ready-meta") ? (
        <span
          data-slot="docblocks/attributes-cover"
          className="block size-10 shrink-0 overflow-hidden rounded-md border bg-muted"
        >
          {file.status === "ready" ? <img src={file.url} alt="" className="size-full object-cover" /> : null}
        </span>
      ) : (
        <span data-slot="docblocks/attributes-cover" className="px-1.5 py-1 text-sm text-muted-foreground">
          {t("attributes.notSet")}
        </span>
      )}
      {readOnly ? null : (
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          className="hidden"
          aria-label={t("attributes.uploadCoverAria")}
          data-slot="docblocks/attributes-cover-upload"
          onChange={(event) => void onUpload(event)}
        />
      )}
      {readOnly ? null : (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={t("attributes.uploadCoverAria")}
          data-slot="docblocks/attributes-cover-upload-button"
          className="size-6 text-muted-foreground hover:text-foreground"
          onClick={() => inputRef.current?.click()}
        >
          <Image className="size-3.5" />
        </Button>
      )}
      {fileId !== undefined && !readOnly ? (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={t("attributes.removeCoverAria")}
          data-slot="docblocks/attributes-cover-remove"
          className="size-6 text-muted-foreground hover:text-foreground"
          onClick={onClear}
        >
          <X className="size-3.5" />
        </Button>
      ) : null}
    </div>
  );
}

/** The panel's props (none — the panel reads the editor context; it stands
 *  over the editor's subtree only). */
function AttributesPanel() {
  const { t, i18n } = useTranslation("editor");
  const { store, doc, viewMode, hiddenAttributes, tagEditor, renderAttribute, attributeTypePicker } =
    useEditorContext();
  const meta = useStore(store, (state) => state.meta);
  // The per-change stamp: the live `lastUpdatedAt` row re-renders over
  // every store write (the `meta` slice is replaced only over the
  // `metaChanged`, the Yjs-only `updatedAt` moves on every transaction).
  useStore(store, (state) => state.changeStamp);
  // The collapse's session state (the default: collapsed).
  const [open, setOpen] = useState(false);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  // The add flow's state (the popover's stand): the open state, the type's
  // pick (the consumer's `attributeTypePicker` replaces the picker, not
  // the state), the name's draft, the error.
  const [addOpen, setAddOpen] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [addKey, setAddKey] = useState("");
  const [addType, setAddType] = useState<AttributeType>("string");

  const attributes = meta.attributes ?? {};
  const hidden = new Set(hiddenAttributes);
  const has = (key: string): boolean => key in attributes;
  const value = (key: string): DocAttributeValue | undefined => attributes[key];
  /** The string read (the preset rows' value stand: a non-string stands absent). */
  const stringValue = (key: string): string | undefined => {
    const v = attributes[key];
    return typeof v === "string" ? v : undefined;
  };

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

  /** The value zone's stand: the consumer's `renderAttribute` over the
   *  key (the built-in editor's stand over the `null` / the absent). */
  const valueZone = (key: string, defaultZone: React.ReactNode): React.ReactNode => {
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

  const tagsValue = value("tags");
  const tagsList = Array.isArray(tagsValue) ? tagsValue : [];

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

  /** The add flow's commit: the name stands the key, the typed value stands
   *  the type's initial form (the value's edit stands the row's own zone;
   *  the mention's name stands the target's id). */
  const commitAdd = (): void => {
    const key = addKey.trim();
    if (key === "") return;
    const parsed: TypedAttributeValue =
      addType === "mention"
        ? { type: "mention", value: { id: key } }
        : addType === "number"
          ? { type: "number", value: 0 }
          : addType === "boolean"
            ? { type: "boolean", value: false }
            : addType === "list"
              ? { type: "list", value: [] }
              : { type: "string", value: "" };
    try {
      doc.setAttribute(key, parsed);
      setAddKey("");
      setAddError(null);
      setAddOpen(false);
    } catch (error) {
      // The name is the only user-controlled input here: the only rejection
      // over a valid typed form is the reserved key's stand.
      if (error instanceof InvalidAttributeError) {
        setAddError(t("attributes.keyReserved"));
      }
    }
  };

  const TagEditor = tagEditor;
  const TypePicker = attributeTypePicker;
  const locale = i18n.language;

  const inlineEdit = (
    key: string,
    slot: string,
    label: string,
    initial: string,
    commit: (next: string) => void,
    placeholder?: string
  ): React.ReactNode => (
    <InlineEditInput
      initial={initial}
      ariaLabel={label}
      slot={slot}
      className="h-8 text-sm"
      placeholder={placeholder}
      onCommit={commit}
      onCancel={() => setEditingKey(null)}
    />
  );

  const inlineDisplayButton = (key: string, slot: string, label: string, display: React.ReactNode): React.ReactNode =>
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

  const notSet = <span className="text-muted-foreground">{t("attributes.notSet")}</span>;

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
        <div data-slot="docblocks/attributes-body" className="mt-1 border-t border-muted pt-1.5">
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
            <AttributeRow
              key="tags"
              attributeKey="tags"
              label={t("attributes.tags")}
              removable={has("tags") && !viewMode}
              onRemove={() => remove("tags")}
              removeAria={t("attributes.removeAria", { name: t("attributes.tags") })}
            >
              {valueZone(
                "tags",
                TagEditor !== null ? (
                  <TagEditor tags={tagsList} readOnly={viewMode} onTagsChange={(tags) => set("tags", tags)} />
                ) : (
                  <TagsEditor
                    tags={tagsList}
                    readOnly={viewMode}
                    onTagsChange={(tags) => {
                      if (tags.length === 0) remove("tags");
                      else set("tags", tags);
                    }}
                  />
                )
              )}
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
                  readOnly={viewMode}
                  onSet={(id) => set("cover", id)}
                  onClear={() => remove("cover")}
                />
              )}
            </AttributeRow>
          )}

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
            <AttributeRow
              key="publishedAt"
              attributeKey="publishedAt"
              label={t("attributes.publishedAt")}
              removable={has("publishedAt") && !viewMode}
              onRemove={() => remove("publishedAt")}
              removeAria={t("attributes.removeAria", { name: t("attributes.publishedAt") })}
            >
              {(() => {
                const raw = stringValue("publishedAt");
                // The display's stand (the locale's date over the parseable
                // ISO; the raw string stands otherwise; the edit's input
                // keeps the raw value).
                const display = raw === undefined || raw === "" ? notSet : displayPublishedDate(raw, locale);
                return valueZone(
                  "publishedAt",
                  inlineDisplayButton(
                    "publishedAt",
                    "docblocks/attributes-published-at",
                    t("attributes.publishedAt"),
                    display
                  ) ??
                    inlineEdit(
                      "publishedAt",
                      "docblocks/attributes-published-at-edit",
                      t("attributes.editAria", { name: t("attributes.publishedAt") }),
                      raw ?? "",
                      (next) => {
                        setEditingKey(null);
                        if (next === "") remove("publishedAt");
                        else set("publishedAt", next);
                      }
                    )
                );
              })()}
            </AttributeRow>
          )}

          {(() => {
            const renderCustomRow = (key: string): React.ReactNode => {
              const rawValue = attributes[key];
              const typed = typedValueOf(rawValue);
              // The value's stand: the list (plain or the typed stand)
              // runs the vertical's line editor (the line's inputs + the
              // ×'s removal + the new line's input over the stack's tail —
              // the whole list's commit over the value's form: the plain's
              // plain stand, the typed's typed stand; the read-only's
              // display's stand over the stacked lines); the boolean (plain
              // or the typed stand) runs the project's checkbox (the
              // checked's toggle — one write over the same form; the
              // read-only's disabled stand over the view / published's
              // modes); the string (plain or the typed stand), the number,
              // and the mention reference run the inline input (the typed
              // form's write-back — the type stands kept; the invalid
              // number's commit is the no-write's stand over the old
              // value).
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
              const commitValue = (next: string): void => {
                const trimmed = next.trim();
                if (trimmed === "") {
                  remove(key);
                  return;
                }
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
              const editKey = `custom:${key}`;
              const isTyping = editingKey === editKey;
              // The boolean's checked's stand (the plain's plain value, the
              // typed's typed value — the branch stands the `isBoolean`'s
              // guard over the type's read).
              const booleanChecked =
                typeof rawValue === "boolean"
                  ? rawValue
                  : typed !== null && typed.type === "boolean"
                    ? typed.value
                    : false;
              return (
                <AttributeRow
                  key={key}
                  attributeKey={key}
                  label={key}
                  removable={!viewMode}
                  onRemove={() => remove(key)}
                  removeAria={t("attributes.removeAria", { name: key })}
                  topAlign={isList}
                >
                  {valueZone(
                    key,
                    isList ? (
                      // The vertical's line editor's stand (the read-only's
                      // display over the stacked lines): the commit keeps
                      // the value's form (the plain's plain stand, the
                      // typed's typed stand).
                      <ListEditor
                        items={listItems}
                        name={key}
                        readOnly={viewMode}
                        slot={`docblocks/attribute-${key}-list`}
                        onItemsChange={(next) => {
                          if (Array.isArray(rawValue)) set(key, next);
                          else set(key, { type: "list", value: next });
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
                          data-attribute-key={key}
                          aria-label={t("attributes.booleanToggleAria", { name: key })}
                          checked={booleanChecked}
                          disabled={viewMode}
                          onCheckedChange={(next) => {
                            if (typeof next !== "boolean") return;
                            if (typeof rawValue === "boolean") set(key, next);
                            else set(key, { type: "boolean", value: next });
                          }}
                        />
                      </span>
                    ) : !editable ? (
                      <DisplayValue value={rawValue} placeholder={t("attributes.notSet")} />
                    ) : isTyping ? (
                      inlineEdit(
                        editKey,
                        `docblocks/attribute-${key}-edit`,
                        key,
                        initialOf(),
                        (next) => {
                          setEditingKey(null);
                          commitValue(next);
                        },
                        t("attributes.valuePlaceholder")
                      )
                    ) : (
                      <button
                        type="button"
                        data-slot="docblocks/attribute-custom"
                        data-attribute-key={key}
                        className="w-full rounded-md text-left hover:bg-muted/50"
                        onClick={() => setEditingKey(editKey)}
                      >
                        <DisplayValue value={rawValue} placeholder={t("attributes.notSet")} />
                      </button>
                    )
                  )}
                </AttributeRow>
              );
            };
            // The custom rows' stand: the drag's preview over the edit mode
            // (the `Reorder.Group`'s live reorder + the rows' position slide —
            // the blocks' rows' parity), the display-only's stand over the
            // read-only modes (no grip, no drag).
            return viewMode ? (
              <div data-slot="docblocks/attributes-custom">{displayCustomKeys.map((key) => renderCustomRow(key))}</div>
            ) : (
              <Reorder.Group
                as="div"
                data-slot="docblocks/attributes-custom"
                axis="y"
                values={displayCustomKeys}
                onReorder={(next: string[]) => setDragOrder(next)}
                className="flex flex-col"
              >
                {displayCustomKeys.map((key) => (
                  <DraggableAttributeRow
                    key={key}
                    attributeKey={key}
                    onDragStart={() => setDragging(true)}
                    onDragEnd={commitCustomReorder}
                  >
                    {renderCustomRow(key)}
                  </DraggableAttributeRow>
                ))}
              </Reorder.Group>
            );
          })()}

          {viewMode ? null : (
            // The add's entry over the list's tail (the button stands over
            // the last row): the popover's type pick + the name's draft +
            // the commit (the row's creation — the list's replenish; the
            // button stands over the list's tail over the commit).
            <div data-slot="docblocks/attributes-add" className="mt-1.5">
              <Popover
                open={addOpen}
                onOpenChange={(next) => {
                  setAddOpen(next);
                  if (!next) {
                    setAddKey("");
                    setAddError(null);
                  }
                }}
              >
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    data-slot="docblocks/attributes-add-button"
                    aria-label={t("attributes.addAttribute")}
                    aria-haspopup="dialog"
                    className="
                      flex items-center gap-1.5 rounded-md px-1.5 py-1 text-sm text-muted-foreground
                      hover:bg-muted/50 hover:text-foreground
                    "
                  >
                    <Plus className="size-3.5" />
                    {t("attributes.addAttribute")}
                  </button>
                </PopoverTrigger>
                <PopoverContent align="start" className="w-fit min-w-72">
                  {/* The type's picker (the consumer's `attributeTypePicker`'
                      stand; the built-in's sliding-pill's stand otherwise —
                      the document view's selector's parity). */}
                  {TypePicker !== null ? (
                    <TypePicker value={addType} onChange={setAddType} />
                  ) : (
                    <SegmentSelector<AttributeType>
                      options={ATTRIBUTE_TYPES.map((type) => ({
                        value: type,
                        label: t(`attributes.type${type[0]!.toUpperCase()}${type.slice(1)}`),
                      }))}
                      value={addType}
                      onChange={setAddType}
                      ariaLabel={t("attributes.typeAria")}
                      slot="docblocks/attributes-add-type"
                      pillSlot="docblocks/attributes-add-type-pill"
                      buttonAttrName="type"
                      size="text"
                    />
                  )}
                  <div className="flex items-center gap-2">
                    <Input
                      data-slot="docblocks/attributes-add-key"
                      aria-label={t("attributes.namePlaceholder")}
                      className="h-8 min-w-0 flex-1 text-sm"
                      placeholder={t("attributes.namePlaceholder")}
                      value={addKey}
                      onChange={(event) => setAddKey(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") commitAdd();
                      }}
                    />
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      data-slot="docblocks/attributes-add-confirm"
                      disabled={addKey.trim() === ""}
                      onClick={commitAdd}
                    >
                      {t("attributes.addConfirm")}
                    </Button>
                  </div>
                  {addError !== null ? (
                    <span data-slot="docblocks/attributes-add-error" className="text-xs text-destructive">
                      {addError}
                    </span>
                  ) : null}
                </PopoverContent>
              </Popover>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}

export { AttributesPanel };
