/**
 * The slash `Frame` picker: the search row + the list of the document's
 * canvas frames (the walk: the root's surfaces over their direct `frame`
 * children; the name is the frame's `title` — the absent / empty stand
 * falls back to the localized "Frame" label at render time). The menu
 * stands open over the phrase while the picker stands;
 * the pick commits the phrase strip + the `insertBlock('frame', { frameId
 * })` (the page-frame block's weak reference) in the caller's transact.
 * The frames stand live over the doc's changes (the digest's subscription
 * re-renders the list — the frame's add / remove / rename stands the
 * list's own stand). The cancel keeps the command list on the phrase (no
 * write). The no-gate stand (unlike the database's bridge gate): the
 * frames are the doc's own canvas data — the picker stands always (the
 * empty stand is the "no frames yet" line).
 */
import { useTranslation } from "react-i18next";
import { useStore } from "zustand";

import { useEffect, useMemo, useRef, useState } from "react";

import type { Block, BlockId } from "docblocks-core";

import { useEditorContext } from "../../editor-provider";
import { Button } from "../../shared/ui/Button";
import { Input } from "../../shared/ui/Input";
import { preventDefault } from "../../shared/utils";

/** The picker's frame stand: the weak reference + the frame's title
 *  (the empty stand is the localized fallback, applied at render time). */
interface CanvasFrameOption {
  id: BlockId;
  name: string;
}

/**
 * The document's canvas frames in document order: the root's surfaces'
 * direct `frame` children (the frame's weak reference's target — the
 * frame is a surface's direct child, the group's member's posture).
 */
function canvasFrames(rootChildren: readonly BlockId[], blocks: Readonly<Record<BlockId, Block>>): CanvasFrameOption[] {
  const frames: CanvasFrameOption[] = [];
  for (const childId of rootChildren) {
    const child = blocks[childId];
    if (child === undefined || child.type !== "surface") continue;
    for (const grandId of child.children ?? []) {
      const grand = blocks[grandId];
      if (grand === undefined || grand.type !== "frame") continue;
      const title = grand.attrs?.title ?? "";
      frames.push({ id: grandId, name: title });
    }
  }
  return frames;
}

function FrameSlashPicker({ onCommit, onCancel }: { onCommit: (frameId: string) => void; onCancel: () => void }) {
  const { t } = useTranslation("slash");
  const { store } = useEditorContext();
  // The frames' digest (the surfaces' frame children + their titles): the
  // primitive's stand memoizes the walk — the list re-renders over the
  // doc's changes (the frame's add / remove / rename) and bails while the
  // data stands.
  const digest = useStore(store, (state) => JSON.stringify(canvasFrames(state.rootChildren, state.blocks)));
  const frames = useMemo(() => canvasFrames(store.getState().rootChildren, store.getState().blocks), [digest, store]);
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement | null>(null);

  // The display name: the frame's title, the localized fallback over the
  // absent / empty stand.
  const nameOf = (frame: CanvasFrameOption): string => (frame.name !== "" ? frame.name : t("frame.fallback"));

  // The search stands focused on the open (the keyboard's flow: the type
  // filters the list, the pick commits).
  useEffect(() => {
    searchRef.current?.focus();
  }, []);

  const filtered = frames.filter((frame) => nameOf(frame).toLowerCase().includes(query.trim().toLowerCase()));

  // The picker's own keys are not the slash query's: stop the propagation
  // (the block's key handler would move the highlight and re-derive the
  // query). Escape cancels the picker (the command list stands on the
  // phrase).
  const stopPickerKey = (event: React.KeyboardEvent<HTMLInputElement>) => {
    event.stopPropagation();
    if (event.key === "Escape") onCancel();
  };
  const onQueryChange = (event: React.ChangeEvent<HTMLInputElement>) => setQuery(event.target.value);
  const commitFrameAt = (frameId: BlockId) => () => onCommit(frameId);

  return (
    <div data-slot="docblocks/slash-frame-picker" className="flex w-56 flex-col gap-2 p-1">
      <Input
        ref={searchRef}
        size="sm"
        type="text"
        data-slot="docblocks/slash-frame-search"
        className="rounded-sm"
        aria-label={t("frame.searchAria")}
        placeholder={t("frame.searchPlaceholder")}
        value={query}
        onKeyDown={stopPickerKey}
        onChange={onQueryChange}
      />
      <div data-slot="docblocks/slash-frame-list" className="max-h-40 overflow-y-auto">
        {filtered.length === 0 && (
          <div data-slot="docblocks/slash-frame-empty" className="px-2 py-1 text-sm text-muted-foreground">
            {frames.length === 0 ? t("frame.empty") : t("frame.noMatch")}
          </div>
        )}
        {filtered.map((frame) => (
          <Button
            key={frame.id}
            data-slot="docblocks/slash-frame-option"
            data-frame-id={frame.id}
            variant="ghost"
            size="sm"
            role="menuitem"
            className="h-auto w-full cursor-default justify-start rounded-sm px-2 py-1.5 text-sm font-normal"
            // The mousedown suppression keeps the caret's selection alive
            // across the click (the menu panel idiom).
            onMouseDown={preventDefault}
            onClick={commitFrameAt(frame.id)}
          >
            {nameOf(frame)}
          </Button>
        ))}
      </div>
    </div>
  );
}

export { FrameSlashPicker };
