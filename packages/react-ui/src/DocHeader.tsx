/**
 * The document's header panel — a consumer-placed component (outside the
 * editor, so it takes the core `Doc` directly, not the editor context). It
 * stands the page/canvas mode switcher (left), the page avatar, and the
 * document title. It reads the doc's meta and re-renders on the meta
 * changes (the onChange feed). The title and the avatar are inline-editable:
 * a click opens the edit, the blur / the Enter commit (one command — one
 * undo step, one wire update), the Escape cancels without a write; a commit
 * of the current value is the no-op stand (nothing is written). The mode
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
import { SegmentSelector } from "./shared/ui/SegmentSelector";
import { cn } from "./shared/ui/cn";
import { Network, SquareText } from "./shared/ui/icons";

/** The inline edit's input: the focus + select-all on mount, the commit on the blur / the Enter (one write), the Escape cancels without a write. */
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
    inputRef.current?.focus();
    inputRef.current?.select();
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
  const [editing, setEditing] = useState<null | "title" | "avatar">(null);

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
      {editing === "avatar" ? (
        <InlineEditInput
          initial={meta.avatar ?? ""}
          ariaLabel="Document avatar"
          slot="docblocks/doc-header-avatar-edit"
          className={`
            h-8 w-24 rounded-full border border-input bg-background px-3 text-center text-lg
            focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-1
            focus-visible:outline-ring
          `}
          onCommit={(value) => {
            setEditing(null);
            if (value.trim() === (meta.avatar ?? "")) return; // the no-op stand
            doc.setAvatar(value.trim());
          }}
          onCancel={() => setEditing(null)}
        />
      ) : (
        <button
          type="button"
          data-slot="docblocks/doc-header-avatar"
          aria-label="Edit the document avatar"
          title="Edit the avatar"
          onClick={() => setEditing("avatar")}
          className={cn(
            `
              flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-full text-base transition-colors
              focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-1
              focus-visible:outline-ring
            `,
            meta.avatar ? "bg-muted" : "border border-dashed border-input text-muted-foreground"
          )}
        >
          {meta.avatar ? meta.avatar : "+"}
        </button>
      )}
      {editing === "title" ? (
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
            setEditing(null);
            if (value === doc.meta.title) return; // the no-op stand (the doc's own read)
            doc.setTitle(value);
          }}
          onCancel={() => setEditing(null)}
        />
      ) : (
        <button
          type="button"
          data-slot="docblocks/doc-header-title"
          aria-label="Edit the document title"
          title="Edit the title"
          onClick={() => setEditing("title")}
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
