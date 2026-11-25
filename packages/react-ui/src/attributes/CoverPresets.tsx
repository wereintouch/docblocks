/** The cover modal's preset's surface (the modal's subcomponent over the
 * `cover.ts`'s contract): the preset's cell (the consumer's store's
 * id's thumbnail), the preset's grid, and the editor's width's read over
 * the anchor (the modal's measurement's source). */
import { useTranslation } from "react-i18next";

import { ScrollArea } from "../shared/ui/ScrollArea";
import { Image } from "../shared/ui/icons";
import { useCoverImage } from "./use-cover-image";

/** The editor frame's selector (the editor width's source — the measured
 *  frame's box over the anchor's nearest editor root). */
const EDITOR_SELECTOR = '[data-slot="docblocks/editor"]';

/** The editor width's read over the anchor (the no-page / no-layout's
 *  stand keeps zero — the width gate's fail-open). */
function editorWidthOf(anchor: HTMLElement | null): number {
  const editor = anchor?.closest(EDITOR_SELECTOR) ?? null;
  if (editor === null) return 0;
  return Math.round(editor.getBoundingClientRect().width);
}

/** A preset grid's cell: the consumer's store's id resolved to the
 *  thumbnail (the bytes' stand — the preset's id is the consumer's store's
 *  id, the same one the banner's resolution stands); the placeholder over
 *  the loading / the missing's stands. A pick commits the id over the
 *  caller's mode (the upload's no stand — the consumer's catalog's curation
 *  is the gate's stand over the presets). */
function CoverPresetCell({
  fileId,
  label,
  busy,
  onPick,
}: {
  fileId: string;
  label: string;
  busy: boolean;
  onPick: () => void;
}) {
  const { status, url } = useCoverImage(fileId, { eager: true });
  return (
    <button
      type="button"
      data-slot="docblocks/cover-preset"
      data-cover-preset-id={fileId}
      aria-label={label}
      title={label}
      disabled={busy}
      onClick={onPick}
      className="
        flex h-18 w-full items-center justify-center overflow-hidden rounded-md border border-border bg-muted
        text-muted-foreground
        hover:border-primary
        disabled:opacity-60
      "
    >
      {status === "ready" && url !== null ? (
        <img src={url} alt="" className="size-full object-cover" />
      ) : (
        <Image className="size-4" />
      )}
    </button>
  );
}

/** The preset's grid (the consumer's catalog's stand): the current
 *  mode's set over the 4-column's stand (the visible's 3-row's cap
 *  over the thin-scrollbar's ScrollArea — the overflow scrolls, the
 *  width's columns stand fixed). A pick commits the id over the mode
 *  (the upload's no stand — no gate's run over a preset). */
function CoverPresetGrid({
  presets,
  busy,
  onPick,
}: {
  presets: readonly string[];
  busy: boolean;
  onPick: (fileId: string) => void;
}) {
  const { t } = useTranslation("editor");
  return (
    <div className="mt-3" data-slot="docblocks/cover-preset-grid">
      <span className="mb-1.5 block text-xs text-muted-foreground">{t("attributes.coverPresetsLabel")}</span>
      <ScrollArea className="max-h-58">
        <div className="grid grid-cols-4 gap-2" data-slot="docblocks/cover-preset-cells">
          {presets.map((fileId) => (
            <CoverPresetCell
              key={fileId}
              fileId={fileId}
              busy={busy}
              label={t("attributes.coverPresetAria", { id: fileId })}
              onPick={() => onPick(fileId)}
            />
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}

export { CoverPresetGrid, editorWidthOf };
