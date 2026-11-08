/**
 * The document's header panel — a consumer-placed component (outside the
 * editor, so it takes the core `Doc` directly, not the editor context). It
 * stands the page/canvas mode switcher (left), the document mode's
 * switcher (the Edit / View / Published's stand — the consumer-controlled
 * `mode` over the `onModeChange`, gated over the "editor"'s access level;
 * a "viewer" stands no switcher — the published's mode is forced), the
 * page avatar, and the document title. It reads the doc's meta and
 * re-renders on the meta changes (the onChange feed); over the published's
 * stand the meta stands from the `publishedDoc`'s snapshot (the live's
 * meta stands off — the reader stands the published's state). The title is
 * inline-editable over the edit's mode only (a click opens the edit, the
 * caret seats at the end — no select-all, the blur / the Enter commit —
 * one command, the Escape cancels without a write; the read-only's stand
 * shows the title display-only). The avatar is a popover picker over the
 * edit's mode only (a click opens the emoji grid — a portaled
 * standard-token surface, a pick commits `setAvatar` — one write — and
 * closes, the clear option removes it; the read-only's stand shows the
 * avatar display-only). The mode switchers are controlled (the `view` +
 * the `onViewChange`, the `mode` + the `onModeChange` — the consumer owns
 * the editor's view and the document's mode).
 *
 * The panel stands the standard theme tokens (not the `--docblocks-*` ones):
 * it renders in the consumer's chrome, outside the editor root where the
 * `--docblocks-*` tokens are not mapped.
 */
import { useEffect, useRef, useState } from "react";

import type { Doc } from "docblocks-core";

import type { EditorView } from "./Editor";
import type { AccessLevel, EditorMode } from "./editor-provider";
import { Button } from "./shared/ui/Button";
import { EmojiPicker } from "./shared/ui/EmojiPicker";
import { Input } from "./shared/ui/Input";
import { Popover, PopoverContent, PopoverTrigger } from "./shared/ui/Popover";
import { SegmentSelector } from "./shared/ui/SegmentSelector";
import { cn } from "./shared/ui/cn";
import { BookOpen, Eye, Network, Pen, SquareText } from "./shared/ui/icons";
import { preventDefault } from "./shared/utils";

/** The inline edit's input: the focus with the caret seated at the end (no select-all) on mount, the commit on the blur / the Enter (one write), the Escape cancels without a write. */
function InlineEditInput({
  initial,
  ariaLabel,
  slot,
  className,
  onCommit,
  onCancel,
}: {
  initial: string;
  ariaLabel: string;
  slot: string;
  className?: string;
  onCommit: (value: string) => void;
  onCancel: () => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const committedRef = useRef(false);

  useEffect(() => {
    const input = inputRef.current;
    if (input === null) return;
    input.focus();
    // The caret seats at the end (the edit continues the value — a
    // select-all would replace it on the first keystroke).
    input.setSelectionRange(input.value.length, input.value.length);
  }, []);

  const commit = (value: string): void => {
    if (committedRef.current) return;
    committedRef.current = true;
    onCommit(value);
  };

  const onInputBlur = (event: React.FocusEvent<HTMLInputElement>) => commit(event.target.value);
  const onInputKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      commit(event.currentTarget.value);
    } else if (event.key === "Escape") {
      // The guard stops the blur's commit (the unmount's blur).
      committedRef.current = true;
      onCancel();
    }
  };

  return (
    <Input
      ref={inputRef}
      data-slot={slot}
      aria-label={ariaLabel}
      defaultValue={initial}
      className={className}
      onBlur={onInputBlur}
      onKeyDown={onInputKeyDown}
    />
  );
}

function DocHeader({
  doc,
  view,
  onViewChange,
  accessLevel = "editor",
  mode = "edit",
  onModeChange,
  publishedDoc,
}: {
  doc: Doc;
  view: EditorView;
  onViewChange: (view: EditorView) => void;
  /** The consumer's user access level (the switcher's gate): a "viewer" stands the published's mode forced (the switcher stands no stand); an "editor" (the default) may switch the modes. */
  accessLevel?: AccessLevel;
  /** The current document mode (consumer-controlled, like `view`): the switcher's value over the "editor"'s level. */
  mode?: EditorMode;
  /** The mode's change (the consumer owns the state, like `onViewChange`): the switcher's entry stands only over the callback's presence. */
  onModeChange?: (mode: EditorMode) => void;
  /** The published snapshot (the meta's source over the published's stand; the "Published"'s option stands disabled over its absence). */
  publishedDoc?: Doc | null;
}) {
  // The effective mode: the viewer's published's forced stand (the current
  // state is never the viewer's stand).
  const effectiveMode: EditorMode = accessLevel === "viewer" ? "published" : mode;
  const viewMode = effectiveMode !== "edit";
  // The meta's source: the snapshot's meta over the published's stand (the
  // reader stands the published's state, the live's meta stands off);
  // the live's meta over the edit's / the view's stands (the view's mode
  // stands the current's state live).
  const snapshot = effectiveMode === "published" ? (publishedDoc ?? null) : null;
  const [meta, setMeta] = useState(() => doc.meta);
  const [titleEditing, setTitleEditing] = useState(false);
  const [avatarOpen, setAvatarOpen] = useState(false);

  // Re-render on the meta changes (the title / the avatar) — the doc's own
  // read (the peer's concurrent edit is not clobbered by a stale snapshot).
  useEffect(() => {
    const off = doc.onChange((change) => {
      if (change.metaChanged) setMeta(doc.meta);
    });
    return off;
  }, [doc]);

  // The core's setAvatar no-ops on the standing value (no write, no undo
  // step) — the pick commits one command otherwise.
  const pickAvatar = (emoji: string) => {
    doc.setAvatar(emoji);
    setAvatarOpen(false);
  };
  const clearAvatar = () => {
    doc.setAvatar(null);
    setAvatarOpen(false);
  };
  const commitTitleEdit = (value: string) => {
    setTitleEditing(false);
    if (value === doc.meta.title) return; // the no-op stand (the doc's own read)
    doc.setTitle(value);
  };
  const cancelTitleEdit = () => setTitleEditing(false);
  const beginTitleEdit = () => setTitleEditing(true);

  const switchView = (next: "page" | "canvas") => {
    if (next !== view) onViewChange(next);
  };

  // The mode's switcher (the consumer's stand over the editor's level +
  // the callback's presence): the three modes, the "Published"'s option
  // stands disabled over the snapshot's absence (there is no published's
  // state to stand).
  const showModeSwitcher = accessLevel === "editor" && onModeChange !== undefined;
  const switchMode = (next: EditorMode) => {
    if (next !== effectiveMode) onModeChange?.(next);
  };
  // The display's meta (the source's stand over the effective mode).
  const displayMeta = snapshot !== null ? snapshot.meta : meta;

  return (
    <div data-slot="docblocks/doc-header" className="flex items-center gap-3">
      <SegmentSelector
        options={[
          { value: "page", label: "Page view", icon: <SquareText className="size-4" /> },
          { value: "canvas", label: "Canvas view", icon: <Network className="size-4" /> },
        ]}
        value={view}
        onChange={switchView}
        ariaLabel="Document view"
        slot="docblocks/doc-header-view"
        pillSlot="docblocks/doc-header-view-pill"
        buttonAttrName="doc-header-view-button"
      />
      {showModeSwitcher ? (
        <SegmentSelector
          options={[
            { value: "edit", label: "Edit mode", icon: <Pen className="size-4" /> },
            { value: "view", label: "View mode", icon: <Eye className="size-4" /> },
            {
              value: "published",
              label: "Published",
              icon: <BookOpen className="size-4" />,
              disabled: publishedDoc === null || publishedDoc === undefined,
            },
          ]}
          value={effectiveMode}
          onChange={switchMode}
          ariaLabel="Document mode"
          slot="docblocks/doc-header-mode"
          pillSlot="docblocks/doc-header-mode-pill"
          buttonAttrName="doc-header-mode-button"
        />
      ) : null}
      {viewMode ? (
        // The read-only stand (the view / published's modes): the avatar
        // stands display-only (the picker's entry is off).
        <span
          data-slot="docblocks/doc-header-avatar"
          aria-label="Document avatar"
          className={cn(
            "flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-full text-base font-normal",
            displayMeta.avatar ? "bg-muted" : "border border-dashed border-input text-muted-foreground"
          )}
        >
          {displayMeta.avatar ?? ""}
        </span>
      ) : (
        <Popover open={avatarOpen} onOpenChange={setAvatarOpen}>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              data-slot="docblocks/doc-header-avatar"
              aria-label="Edit the document avatar"
              title="Edit the avatar"
              className={cn(
                "size-8 shrink-0 overflow-hidden rounded-full text-base font-normal",
                meta.avatar ? "bg-muted" : "border border-dashed border-input text-muted-foreground"
              )}
            >
              {meta.avatar ? meta.avatar : "+"}
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" sideOffset={6} onOpenAutoFocus={preventDefault} className="w-auto p-2.5">
            <EmojiPicker selected={meta.avatar ?? null} onPick={pickAvatar} onClear={clearAvatar} />
          </PopoverContent>
        </Popover>
      )}
      {titleEditing && !viewMode ? (
        <InlineEditInput
          initial={meta.title}
          ariaLabel="Document title"
          slot="docblocks/doc-header-title-edit"
          className="
            h-auto min-w-0 flex-1 border-0 bg-background p-0 text-lg font-semibold shadow-none
            focus-visible:ring-0
            dark:bg-transparent
          "
          onCommit={commitTitleEdit}
          onCancel={cancelTitleEdit}
        />
      ) : viewMode ? (
        // The read-only stand (the view / published's modes): the title
        // stands display-only (the inline edit's entry is off).
        <span
          data-slot="docblocks/doc-header-title"
          aria-label="Document title"
          className="min-w-0 flex-1 truncate text-left text-lg font-semibold"
        >
          {displayMeta.title || <span className="text-muted-foreground">Untitled</span>}
        </span>
      ) : (
        <Button
          type="button"
          variant="ghost"
          data-slot="docblocks/doc-header-title"
          aria-label="Edit the document title"
          title="Edit the title"
          onClick={beginTitleEdit}
          className="h-auto min-w-0 flex-1 truncate text-left text-lg font-semibold"
        >
          {meta.title || <span className="text-muted-foreground">Untitled</span>}
        </Button>
      )}
    </div>
  );
}

export { DocHeader };
