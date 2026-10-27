/**
 * The document's header panel — a consumer-placed component (outside the
 * editor, so it takes the core `Doc` directly, not the editor context). It
 * stands the page/canvas mode switcher (left), the page avatar, and the
 * document title. It reads the doc's meta and re-renders on the meta
 * changes (the onChange feed). The title is inline-editable: a click opens
 * the edit (the caret seats at the end — no select-all), the blur / the
 * Enter commit (one command — one undo step, one wire update), the Escape
 * cancels without a write; a commit of the current value is the no-op stand
 * (nothing is written). The avatar is a popover picker: a click opens the
 * emoji grid (a portaled standard-token surface), a pick commits
 * `setAvatar` (one write) and closes, the clear option removes it. The mode
 * switcher is controlled (the `view` + the `onViewChange` — the consumer
 * owns the editor's view).
 *
 * The panel stands the standard theme tokens (not the `--docblocks-*` ones):
 * it renders in the consumer's chrome, outside the editor root where the
 * `--docblocks-*` tokens are not mapped.
 */
import { useEffect, useRef, useState } from "react";

import type { Doc } from "docblocks-core";

import type { EditorView } from "./Editor";
import { EmojiPicker } from "./shared/ui/EmojiPicker";
import { Popover, PopoverContent, PopoverTrigger } from "./shared/ui/Popover";
import { SegmentSelector } from "./shared/ui/SegmentSelector";
import { cn } from "./shared/ui/cn";
import { Network, SquareText } from "./shared/ui/icons";

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

  return (
    <input
      ref={inputRef}
      type="text"
      data-slot={slot}
      aria-label={ariaLabel}
      defaultValue={initial}
      className={className}
      onBlur={(event) => commit(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          commit(event.currentTarget.value);
        } else if (event.key === "Escape") {
          // The guard stops the blur's commit (the unmount's blur).
          committedRef.current = true;
          onCancel();
        }
      }}
    />
  );
}

function DocHeader({
  doc,
  view,
  onViewChange,
}: {
  doc: Doc;
  view: EditorView;
  onViewChange: (view: EditorView) => void;
}) {
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

  return (
    <div data-slot="docblocks/doc-header" className="flex items-center gap-3">
      <SegmentSelector
        options={[
          { value: "page", label: "Page view", icon: <SquareText className="size-4" /> },
          { value: "canvas", label: "Canvas view", icon: <Network className="size-4" /> },
        ]}
        value={view}
        onChange={(next) => {
          if (next !== view) onViewChange(next);
        }}
        ariaLabel="Document view"
        slot="docblocks/doc-header-view"
        pillSlot="docblocks/doc-header-view-pill"
        buttonAttrName="doc-header-view-button"
      />
      <Popover open={avatarOpen} onOpenChange={setAvatarOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            data-slot="docblocks/doc-header-avatar"
            aria-label="Edit the document avatar"
            title="Edit the avatar"
            className={cn(
              `
                flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-full text-base
                transition-colors
                focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-1
                focus-visible:outline-ring
              `,
              meta.avatar ? "bg-muted" : "border border-dashed border-input text-muted-foreground"
            )}
          >
            {meta.avatar ? meta.avatar : "+"}
          </button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          sideOffset={6}
          onOpenAutoFocus={(event) => event.preventDefault()}
          className="w-auto p-2.5"
        >
          <EmojiPicker
            selected={meta.avatar ?? null}
            onPick={(emoji) => {
              // The core's setAvatar no-ops on the standing value (no write,
              // no undo step) — the pick commits one command otherwise.
              doc.setAvatar(emoji);
              setAvatarOpen(false);
            }}
            onClear={() => {
              doc.setAvatar(null);
              setAvatarOpen(false);
            }}
          />
        </PopoverContent>
      </Popover>
      {titleEditing ? (
        <InlineEditInput
          initial={meta.title}
          ariaLabel="Document title"
          slot="docblocks/doc-header-title-edit"
          className={`
            min-w-0 flex-1 rounded-md border border-input bg-background px-2 py-1 text-lg font-semibold
            focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-1
            focus-visible:outline-ring
          `}
          onCommit={(value) => {
            setTitleEditing(false);
            if (value === doc.meta.title) return; // the no-op stand (the doc's own read)
            doc.setTitle(value);
          }}
          onCancel={() => setTitleEditing(false)}
        />
      ) : (
        <button
          type="button"
          data-slot="docblocks/doc-header-title"
          aria-label="Edit the document title"
          title="Edit the title"
          onClick={() => setTitleEditing(true)}
          className={`
            min-w-0 flex-1 truncate rounded-md px-2 py-1 text-left text-lg font-semibold transition-colors
            hover:bg-accent
            focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-1
            focus-visible:outline-ring
          `}
        >
          {meta.title || <span className="text-muted-foreground">Untitled</span>}
        </button>
      )}
    </div>
  );
}

export { DocHeader };
