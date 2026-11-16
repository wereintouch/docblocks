/**
 * The document-attributes panel: the collapsible stand inside the page
 * column, above the first block (the consumer's own document metadata —
 * the markdown frontmatter's stand). Collapsed by default (the collapse
 * state is session state — never document data). The rows: the system
 * read-only rows (the meta's derivatives — id / createdAt / the live
 * lastUpdatedAt), the preset rows (description / tags / author / cover /
 * status / publishedAt), and the custom rows (every non-preset key of
 * the `meta.attributes` record). Over the read-only stands (the view /
 * published's modes) every row stands display-only. `hiddenAttributes`
 * hides the named rows (the preset and the custom keys, the system rows);
 * `tagEditor` replaces the default tags editor. The panel renders over
 * the page's shared editable: its root is a non-editable island (the
 * cross-drag's mousedown guard and the surface's container-targeted
 * dispatch keep their stands over the island's controls).
 */
import { useTranslation } from "react-i18next";
import { useStore } from "zustand";

import { useEffect, useRef, useState } from "react";

import { InvalidAttributeError } from "docblocks-core";
import type { DocAttributeValue, MentionRef } from "docblocks-core";

import { useBlobFile } from "../blocks/use-blob-file";
import { useEditorContext } from "../editor-provider";
import { Button } from "../shared/ui/Button";
import { InlineEditInput } from "../shared/ui/InlineEditInput";
import { Input } from "../shared/ui/Input";
import { Popover, PopoverContent, PopoverTrigger } from "../shared/ui/Popover";
import { cn } from "../shared/ui/cn";
import { ChevronDown, Image, Plus, Trash, User, X } from "../shared/ui/icons";
import { preventDefault } from "../shared/utils";
import { PRESET_KEYS } from "./presets";

/** The mention reference's read (the `author` value's shape stand). */
const mentionRefOf = (value: DocAttributeValue | undefined): MentionRef | null => {
  if (value === undefined || value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  return typeof record.id === "string" && typeof record.label === "string" ? (value as MentionRef) : null;
};

/** The attribute row's frame: the label column + the value zone + the optional remove button. */
function AttributeRow({
  attributeKey,
  label,
  removable,
  onRemove,
  children,
}: {
  attributeKey: string;
  label: string;
  removable: boolean;
  onRemove?: () => void;
  children: React.ReactNode;
}) {
  return (
    <div data-slot="docblocks/attribute-row" data-attribute-key={attributeKey} className="flex items-start gap-3 py-1">
      <span className="w-32 shrink-0 pt-1.5 text-xs text-muted-foreground">{label}</span>
      <div className="min-w-0 flex-1">{children}</div>
      {removable && onRemove !== undefined ? (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={attributeKey}
          data-slot="docblocks/attribute-row-remove"
          className="size-6 shrink-0 text-muted-foreground hover:text-foreground"
          onClick={onRemove}
        >
          <Trash className="size-3.5" />
        </Button>
      ) : null}
    </div>
  );
}

/** The display stand (a value's read-only rendering). */
function DisplayValue({ value, placeholder }: { value: DocAttributeValue | undefined; placeholder: string }) {
  if (value === undefined) return <span className="text-xs text-muted-foreground">{placeholder}</span>;
  if (Array.isArray(value))
    return (
      <span className="text-sm">
        {value.join(", ") || <span className="text-muted-foreground">{placeholder}</span>}
      </span>
    );
  if (typeof value === "boolean") return <span className="text-sm">{String(value)}</span>;
  const mention = mentionRefOf(value);
  if (mention !== null) {
    return (
      <span className="inline-flex items-center gap-1 text-sm">
        <User className="size-3.5 text-muted-foreground" />
        {mention.label}
      </span>
    );
  }
  return <span className="text-sm">{String(value)}</span>;
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
            h-6 min-w-24 flex-1 rounded-md border border-transparent bg-transparent px-1.5 text-xs outline-none
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

/** The author's picker (the mention provider's users over a search input). */
function AuthorPicker({
  current,
  onPick,
  onClear,
}: {
  current: DocAttributeValue | undefined;
  onPick: (ref: MentionRef) => void;
  onClear: () => void;
}) {
  const { t } = useTranslation("editor");
  const { mentionProvider } = useEditorContext();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Array<{ id: string; label: string }>>([]);
  const requestSeq = useRef(0);

  useEffect(() => {
    if (!open) return;
    const seq = ++requestSeq.current;
    void mentionProvider
      ?.searchUsers(query)
      .then((entries) => {
        if (seq === requestSeq.current) setResults(entries);
      })
      .catch(() => {
        if (seq === requestSeq.current) setResults([]);
      });
  }, [open, query, mentionProvider]);

  const label =
    current === undefined
      ? t("attributes.notSet")
      : (mentionRefOf(current)?.label ??
        (typeof current === "string" || typeof current === "number" ? String(current) : t("attributes.notSet")));

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          data-slot="docblocks/attributes-author"
          aria-label={t("attributes.pickAuthorAria")}
          className="h-auto max-w-full justify-start gap-1.5 px-1.5 py-1 text-sm"
        >
          <User className="size-3.5 shrink-0 text-muted-foreground" />
          <span className={cn("truncate", current === undefined && "text-muted-foreground")}>{label}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" sideOffset={4} onOpenAutoFocus={preventDefault} className="w-56 p-1.5">
        <Input
          autoFocus
          data-slot="docblocks/attributes-author-search"
          aria-label={t("attributes.searchUsersPlaceholder")}
          className="h-8 text-sm"
          placeholder={t("attributes.searchUsersPlaceholder")}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <div className="mt-1.5 max-h-48 overflow-y-auto">
          {results.map((entry) => (
            <button
              key={entry.id}
              type="button"
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted"
              onClick={() => {
                onPick({ id: entry.id, label: entry.label });
                setOpen(false);
              }}
            >
              <User className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="truncate">{entry.label}</span>
            </button>
          ))}
          {results.length === 0 ? (
            <div className="px-2 py-1.5 text-xs text-muted-foreground">{t("attributes.notSet")}</div>
          ) : null}
        </div>
        {current !== undefined ? (
          <button
            type="button"
            className="
              mt-1 flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-muted-foreground
              hover:bg-muted hover:text-foreground
            "
            onClick={() => {
              onClear();
              setOpen(false);
            }}
          >
            <X className="size-3" />
            {t("attributes.removeAria", { name: t("attributes.author") })}
          </button>
        ) : null}
      </PopoverContent>
    </Popover>
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
      ) : fileId !== undefined && file.status === "missing" ? (
        <span data-slot="docblocks/attributes-cover" className="text-xs text-muted-foreground">
          {t("attributes.notSet")}
        </span>
      ) : (
        <span data-slot="docblocks/attributes-cover" className="text-xs text-muted-foreground">
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
  const { t } = useTranslation("editor");
  const { store, doc, viewMode, hiddenAttributes, tagEditor, mentionProvider } = useEditorContext();
  const meta = useStore(store, (state) => state.meta);
  // The per-change stamp: the live `lastUpdatedAt` row re-renders over
  // every store write (the `meta` slice is replaced only over the
  // `metaChanged`, the Yjs-only `updatedAt` moves on every transaction).
  useStore(store, (state) => state.changeStamp);
  // The collapse's session state (the default: collapsed).
  const [open, setOpen] = useState(false);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [addError, setAddError] = useState<string | null>(null);
  const [addKey, setAddKey] = useState("");
  const [addValue, setAddValue] = useState("");

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

  const statusValue = value("status");
  const statusOptions = ["draft", "published"];
  const statusCurrent = typeof statusValue === "string" ? statusValue : undefined;
  const tagsValue = value("tags");
  const tagsList = Array.isArray(tagsValue) ? tagsValue : [];

  const customKeys = Object.keys(attributes).filter((key) => !(PRESET_KEYS as readonly string[]).includes(key));

  const commitAdd = (): void => {
    const key = addKey.trim();
    if (key === "") return;
    let parsed: DocAttributeValue = addValue;
    const trimmed = addValue.trim();
    if (trimmed !== "" && /^-?\d+(\.\d+)?$/.test(trimmed)) parsed = Number(trimmed);
    if (trimmed === "true") parsed = true;
    if (trimmed === "false") parsed = false;
    try {
      doc.setAttribute(key, parsed);
      setAddKey("");
      setAddValue("");
      setAddError(null);
    } catch (error) {
      if (error instanceof InvalidAttributeError) {
        setAddError(error.message.includes("key") ? t("attributes.keyReserved") : t("attributes.valueInvalid"));
      } else {
        setAddError(t("attributes.valueInvalid"));
      }
    }
  };

  const TagEditor = tagEditor;

  return (
    <div data-slot="docblocks/attributes" contentEditable={false} suppressContentEditableWarning className="mb-4">
      <button
        type="button"
        data-slot="docblocks/attributes-toggle"
        aria-expanded={open}
        aria-label={t("attributes.toggleAria")}
        className="
          flex w-full items-center gap-1.5 rounded-md px-1.5 py-1 text-left text-xs font-medium text-muted-foreground
          hover:bg-muted/50 hover:text-foreground
        "
        onClick={() => setOpen((next) => !next)}
      >
        <ChevronDown className={cn("size-3.5 transition-transform", !open && "-rotate-90")} />
        {t("attributes.title")}
        {customKeys.length + PRESET_KEYS.filter((key) => has(key)).length > 0 ? (
          <span className="text-muted-foreground">
            {t("attributes.customCount", { count: customKeys.length + PRESET_KEYS.filter((key) => has(key)).length })}
          </span>
        ) : null}
      </button>
      {open ? (
        <div data-slot="docblocks/attributes-body" className="mt-1 border-t pt-1.5">
          {hidden.has("id") ? null : (
            <AttributeRow key="id" attributeKey="id" label={t("attributes.id")} removable={false}>
              <span className="font-mono text-xs break-all">{meta.id}</span>
            </AttributeRow>
          )}
          {hidden.has("createdAt") ? null : (
            <AttributeRow key="createdAt" attributeKey="createdAt" label={t("attributes.createdAt")} removable={false}>
              <span className="text-xs">{meta.createdAt}</span>
            </AttributeRow>
          )}
          {hidden.has("updatedAt") ? null : (
            <AttributeRow
              key="updatedAt"
              attributeKey="updatedAt"
              label={t("attributes.lastUpdatedAt")}
              removable={false}
            >
              <span className="text-xs">{doc.lastUpdatedAt ?? meta.createdAt}</span>
            </AttributeRow>
          )}

          {hidden.has("description") ? null : (
            <AttributeRow
              key="description"
              attributeKey="description"
              label={t("attributes.description")}
              removable={has("description") && !viewMode}
              onRemove={() => remove("description")}
            >
              {viewMode || editingKey !== "description" ? (
                <button
                  type="button"
                  data-slot="docblocks/attributes-description"
                  aria-label={t("attributes.editAria", { name: t("attributes.description") })}
                  className="w-full truncate rounded-md px-1.5 py-1 text-left text-sm hover:bg-muted/50"
                  onClick={() => {
                    if (!viewMode) setEditingKey("description");
                  }}
                >
                  {stringValue("description") !== undefined && stringValue("description") !== "" ? (
                    stringValue("description")
                  ) : (
                    <span className="text-muted-foreground">{t("attributes.notSet")}</span>
                  )}
                </button>
              ) : (
                <InlineEditInput
                  initial={stringValue("description") ?? ""}
                  ariaLabel={t("attributes.editAria", { name: t("attributes.description") })}
                  slot="docblocks/attributes-description-edit"
                  className="h-8 text-sm"
                  onCommit={(next) => {
                    setEditingKey(null);
                    if (next === "") remove("description");
                    else set("description", next);
                  }}
                  onCancel={() => setEditingKey(null)}
                />
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
            >
              {TagEditor !== null ? (
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
              )}
            </AttributeRow>
          )}

          {hidden.has("author") ? null : (
            <AttributeRow
              key="author"
              attributeKey="author"
              label={t("attributes.author")}
              removable={has("author") && !viewMode}
              onRemove={() => remove("author")}
            >
              {viewMode || mentionProvider === null ? (
                <DisplayValue value={value("author")} placeholder={t("attributes.notSet")} />
              ) : (
                <AuthorPicker
                  current={value("author")}
                  onPick={(ref) => set("author", ref)}
                  onClear={() => remove("author")}
                />
              )}
            </AttributeRow>
          )}

          {hidden.has("cover") ? null : (
            <AttributeRow
              key="cover"
              attributeKey="cover"
              label={t("attributes.cover")}
              removable={has("cover") && !viewMode}
              onRemove={() => remove("cover")}
            >
              {viewMode ? (
                <CoverEditor fileId={stringValue("cover")} readOnly onSet={() => undefined} onClear={() => undefined} />
              ) : (
                <CoverEditor
                  fileId={stringValue("cover")}
                  readOnly={false}
                  onSet={(id) => set("cover", id)}
                  onClear={() => remove("cover")}
                />
              )}
            </AttributeRow>
          )}

          {hidden.has("status") ? null : (
            <AttributeRow
              key="status"
              attributeKey="status"
              label={t("attributes.status")}
              removable={has("status") && !viewMode}
              onRemove={() => remove("status")}
            >
              {viewMode ? (
                <DisplayValue value={value("status")} placeholder={t("attributes.notSet")} />
              ) : (
                <select
                  data-slot="docblocks/attributes-status"
                  aria-label={t("attributes.statusAria")}
                  className="
                    h-8 rounded-md border border-input bg-transparent px-2 text-sm outline-none
                    focus-visible:border-ring
                  "
                  value={statusCurrent ?? ""}
                  onChange={(event) => {
                    if (event.target.value === "") remove("status");
                    else set("status", event.target.value);
                  }}
                >
                  <option value="">{t("attributes.notSet")}</option>
                  <option value="draft">{t("attributes.statusDraft")}</option>
                  <option value="published">{t("attributes.statusPublished")}</option>
                  {statusCurrent !== undefined && !statusOptions.includes(statusCurrent) ? (
                    <option value={statusCurrent}>{statusCurrent}</option>
                  ) : null}
                </select>
              )}
            </AttributeRow>
          )}

          {hidden.has("publishedAt") ? null : (
            <AttributeRow
              key="publishedAt"
              attributeKey="publishedAt"
              label={t("attributes.publishedAt")}
              removable={has("publishedAt") && !viewMode}
              onRemove={() => remove("publishedAt")}
            >
              {viewMode || editingKey !== "publishedAt" ? (
                <button
                  type="button"
                  data-slot="docblocks/attributes-published-at"
                  aria-label={t("attributes.editAria", { name: t("attributes.publishedAt") })}
                  className="w-full truncate rounded-md px-1.5 py-1 text-left text-sm hover:bg-muted/50"
                  onClick={() => {
                    if (!viewMode) setEditingKey("publishedAt");
                  }}
                >
                  {stringValue("publishedAt") !== undefined && stringValue("publishedAt") !== "" ? (
                    stringValue("publishedAt")
                  ) : (
                    <span className="text-muted-foreground">{t("attributes.notSet")}</span>
                  )}
                </button>
              ) : (
                <InlineEditInput
                  initial={stringValue("publishedAt") ?? ""}
                  ariaLabel={t("attributes.editAria", { name: t("attributes.publishedAt") })}
                  slot="docblocks/attributes-published-at-edit"
                  className="h-8 text-sm"
                  onCommit={(next) => {
                    setEditingKey(null);
                    if (next === "") remove("publishedAt");
                    else set("publishedAt", next);
                  }}
                  onCancel={() => setEditingKey(null)}
                />
              )}
            </AttributeRow>
          )}

          {customKeys.map((key) => (
            <AttributeRow key={key} attributeKey={key} label={key} removable={!viewMode} onRemove={() => remove(key)}>
              {viewMode || editingKey !== `custom:${key}` ? (
                <button
                  type="button"
                  data-slot="docblocks/attribute-custom"
                  data-attribute-key={key}
                  className="w-full truncate rounded-md px-1.5 py-1 text-left text-sm hover:bg-muted/50"
                  onClick={() => {
                    if (!viewMode && typeof attributes[key] === "string") setEditingKey(`custom:${key}`);
                  }}
                >
                  <DisplayValue value={attributes[key]} placeholder={t("attributes.notSet")} />
                </button>
              ) : (
                <InlineEditInput
                  initial={String(attributes[key] ?? "")}
                  ariaLabel={key}
                  slot={`docblocks/attribute-${key}-edit`}
                  className="h-8 text-sm"
                  onCommit={(next) => {
                    setEditingKey(null);
                    if (next === "") remove(key);
                    else set(key, next);
                  }}
                  onCancel={() => setEditingKey(null)}
                />
              )}
            </AttributeRow>
          ))}

          {viewMode ? null : (
            <div data-slot="docblocks/attributes-add" className="mt-1.5 flex items-center gap-1.5 border-t pt-1.5">
              <Input
                data-slot="docblocks/attributes-add-key"
                aria-label={t("attributes.keyPlaceholder")}
                className="h-7 w-32 text-xs"
                placeholder={t("attributes.keyPlaceholder")}
                value={addKey}
                onChange={(event) => setAddKey(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") commitAdd();
                }}
              />
              <Input
                data-slot="docblocks/attributes-add-value"
                aria-label={t("attributes.valuePlaceholder")}
                className="h-7 min-w-0 flex-1 text-xs"
                placeholder={t("attributes.valuePlaceholder")}
                value={addValue}
                onChange={(event) => setAddValue(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") commitAdd();
                }}
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={t("attributes.addAttribute")}
                data-slot="docblocks/attributes-add-button"
                className="size-6 shrink-0 text-muted-foreground hover:text-foreground"
                onClick={commitAdd}
              >
                <Plus className="size-3.5" />
              </Button>
              {addError !== null ? <span className="text-xs text-destructive">{addError}</span> : null}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}

export { AttributesPanel };
