/**
 * The embed's hover / focus reveal's toolbar (the code header's controls
 * idiom): the zoom's controls (the in / out's multiplicative step, the
 * percent's display, the identity's reset) + the URL's edit (the editing
 * mode's stand) — the panel over the toolbar changes the `src` (the safe
 * non-empty's write — the unsafe's rejection over the slash form's rule;
 * the iframe's navigation over the new src, the view's / the height's attrs
 * stand untouched). The read-only's stand: the URL's edit stands absent
 * (the editing surface's gate).
 */
import { useTranslation } from "react-i18next";

import { useEffect, useRef, useState } from "react";

import { isSafeEmbedSrc } from "docblocks-core";
import type { BlockId, EmbedBlock as EmbedBlockType } from "docblocks-core";

import { useEditorContext } from "../editor-provider";
import { Button } from "../shared/ui/Button";
import { Input } from "../shared/ui/Input";
import { Check, Minus, Pen, Plus, RotateCcw, X } from "../shared/ui/icons";
import { preventDefault } from "../shared/utils";
import { EMBED_MAX_SCALE, EMBED_MIN_SCALE } from "./embed-view";
import type { UseEmbedViewResult } from "./use-embed-view";

interface EmbedToolbarProps {
  id: BlockId;
  block: EmbedBlockType;
  /** The view's state + the zoom's controls (the toolbar's buttons stand on it). */
  controls: UseEmbedViewResult;
}

function EmbedToolbar({ id, block, controls }: EmbedToolbarProps) {
  const { t } = useTranslation("blocks");
  const { kind, src } = block.attrs;
  const { view, atIdentity, zoomIn, zoomOut, resetView } = controls;
  const { doc, viewMode } = useEditorContext();
  // The URL's edit (the toolbar's edit affordance): the panel stands the
  // current src pre-filled, the commit stands the `src` attr's write (the
  // iframe's navigation over the new src), the cancel stands the close.
  const [editOpen, setEditOpen] = useState(false);
  const [draft, setDraft] = useState(src);
  const editInputRef = useRef<HTMLInputElement | null>(null);

  /** The edit's open: the draft stands the block's own src (the cancel's restore). */
  const openEdit = () => {
    setDraft(src);
    setEditOpen(true);
  };
  const closeEdit = () => setEditOpen(false);

  // The edit's input stands focused when the panel stands (the keyboard's
  // flow: the edit's click, the URL's type, the Enter / check's commit).
  useEffect(() => {
    if (editOpen) editInputRef.current?.focus();
  }, [editOpen]);

  const trimmedDraft = draft.trim();
  const canSave = trimmedDraft.length > 0 && isSafeEmbedSrc(kind, trimmedDraft);
  // The unsafe-scheme hint (the commit stands rejected over the same rule —
  // the input feedback instead of the silent no-op, the slash form's parity).
  const editHint = trimmedDraft.length > 0 && !isSafeEmbedSrc(kind, trimmedDraft) ? t("embed.unsafeHint") : null;

  /** The edit's commit: the safe non-empty draft stands the `src`'s write.
   *  The unchanged draft writes nothing (no updatedAt's stamp, no wire update). */
  const commitEdit = () => {
    if (!canSave) return;
    if (trimmedDraft !== src) doc.updateBlock(id, { src: trimmedDraft });
    setEditOpen(false);
  };

  // The edit's own keys are not the page's hotkeys: stop the propagation
  // (the mode's switch / the canvas's shortcuts would fire over the typed
  // letters). Enter commits, Escape cancels.
  const onEditKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    event.stopPropagation();
    if (event.key === "Enter") {
      event.preventDefault();
      commitEdit();
    } else if (event.key === "Escape") {
      closeEdit();
    }
  };

  return (
    <>
      {/* The hover / focus reveal (the code header's controls idiom):
          invisible and unclickable unless the wrapper is hovered or a zoom
          control holds the keyboard focus (the wrapper's focus-within). The
          opacity (not the display) hides it, so the controls stay in the
          Tab's path. */}
      <div
        data-slot="docblocks/embed-toolbar"
        className="
          pointer-events-none absolute top-1.5 right-1.5 z-10 flex items-center gap-0.5 rounded-(--docblocks-radius)
          border-(length:--docblocks-divider-border-width) border-(--docblocks-divider-border-color)
          bg-(--docblocks-page-card-background) p-0.5 text-(--docblocks-text-color) opacity-0
          shadow-(--docblocks-formatbar-shadow) transition-opacity
          group-focus-within:pointer-events-auto group-focus-within:opacity-100
          group-hover:pointer-events-auto group-hover:opacity-100
        "
      >
        <Button
          data-slot="docblocks/embed-zoom-out"
          variant="ghost"
          size="icon"
          aria-label={t("embed.zoomOut")}
          className="size-6 cursor-default rounded-sm text-(--docblocks-text-color) disabled:opacity-50"
          disabled={view.scale <= EMBED_MIN_SCALE}
          onMouseDown={preventDefault}
          onClick={zoomOut}
        >
          <Minus className="size-4" />
        </Button>
        <span
          data-slot="docblocks/embed-zoom"
          className="min-w-10 px-1 text-center text-xs text-(--docblocks-text-color) tabular-nums"
        >
          {Math.round(view.scale * 100)}%
        </span>
        <Button
          data-slot="docblocks/embed-zoom-in"
          variant="ghost"
          size="icon"
          aria-label={t("embed.zoomIn")}
          className="size-6 cursor-default rounded-sm text-(--docblocks-text-color) disabled:opacity-50"
          disabled={view.scale >= EMBED_MAX_SCALE}
          onMouseDown={preventDefault}
          onClick={zoomIn}
        >
          <Plus className="size-4" />
        </Button>
        <Button
          data-slot="docblocks/embed-zoom-reset"
          variant="ghost"
          size="icon"
          aria-label={t("embed.zoomReset")}
          className="size-6 cursor-default rounded-sm text-(--docblocks-text-color) disabled:opacity-50"
          disabled={atIdentity}
          onMouseDown={preventDefault}
          onClick={resetView}
        >
          <RotateCcw className="size-4" />
        </Button>
        {/* The URL's edit (the editing surface's gate: the read-only's stands absent). */}
        {!viewMode && (
          <>
            <div className="mx-0.5 h-4 w-px bg-(--docblocks-divider-border-color)" aria-hidden />
            <Button
              data-slot="docblocks/embed-edit-url"
              variant="ghost"
              size="icon"
              aria-label={t("embed.editUrl")}
              className="size-6 cursor-default rounded-sm text-(--docblocks-text-color)"
              onMouseDown={preventDefault}
              onClick={openEdit}
            >
              <Pen className="size-4" />
            </Button>
          </>
        )}
      </div>
      {/* The URL's edit panel (the toolbar's stand over the top-right's): the
          input's pre-fill over the current src, the Enter / check's commit
          (the `src`'s write, the unsafe's no-commit), the Escape / x's cancel. */}
      {!viewMode && editOpen && (
        <div
          data-slot="docblocks/embed-edit"
          className="
            absolute top-8 right-1.5 z-10 flex w-56 flex-col gap-1.5 rounded-(--docblocks-radius)
            border-(length:--docblocks-divider-border-width) border-(--docblocks-divider-border-color)
            bg-(--docblocks-page-card-background) p-1.5 text-(--docblocks-text-color)
            shadow-(--docblocks-formatbar-shadow)
          "
        >
          <div className="flex items-center gap-1">
            <Input
              size="sm"
              ref={editInputRef}
              type="text"
              data-slot="docblocks/embed-edit-input"
              className="h-7 flex-1 rounded-sm"
              placeholder={t("embed.srcPlaceholder")}
              value={draft}
              onChange={(event: React.ChangeEvent<HTMLInputElement>) => setDraft(event.target.value)}
              onKeyDown={onEditKeyDown}
            />
            <Button
              data-slot="docblocks/embed-edit-save"
              variant="ghost"
              size="icon"
              aria-label={t("embed.saveUrl")}
              className="size-7 shrink-0 cursor-default rounded-sm text-(--docblocks-text-color) disabled:opacity-50"
              disabled={!canSave}
              onMouseDown={preventDefault}
              onClick={commitEdit}
            >
              <Check className="size-4" />
            </Button>
            <Button
              data-slot="docblocks/embed-edit-cancel"
              variant="ghost"
              size="icon"
              aria-label={t("embed.cancelEdit")}
              className="size-7 shrink-0 cursor-default rounded-sm text-(--docblocks-text-color)"
              onMouseDown={preventDefault}
              onClick={closeEdit}
            >
              <X className="size-4" />
            </Button>
          </div>
          {editHint !== null && (
            <p data-slot="docblocks/embed-edit-hint" className="px-1 text-xs text-destructive">
              {editHint}
            </p>
          )}
        </div>
      )}
    </>
  );
}

export { EmbedToolbar };
