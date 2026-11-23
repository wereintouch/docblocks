/** The PDF fullscreen zoom's bar: the zoom out / in buttons over the
 * scale's indicator + the fit-width / fit-height. It stands a separate
 * pill to the left of the page's controls, the same bar's style over the
 * standard tokens (the overlay is portaled over the document body,
 * outside the editor's root, where the --docblocks-* tokens are
 * undefined). */
import { useTranslation } from "react-i18next";

import { Minus, Plus, StretchHorizontal, StretchVertical } from "../shared/ui/icons";
import { ZOOM_MAX, ZOOM_MIN } from "./constants";

type PdfZoomControlsProps = {
  scale: number;
  onZoomOut: () => void;
  onZoomIn: () => void;
  onFitWidth: () => void;
  onFitHeight: () => void;
};

function PdfZoomControls({ scale, onZoomOut, onZoomIn, onFitWidth, onFitHeight }: PdfZoomControlsProps) {
  const { t } = useTranslation("blocks");
  return (
    <div
      data-slot="docblocks/image-pdf-zoom"
      className="
        flex items-center justify-center gap-1 rounded-(--radius) border border-(--border) bg-(--muted) px-2 py-1
        select-none
      "
    >
      <button
        type="button"
        data-slot="docblocks/image-pdf-zoom-out"
        onClick={onZoomOut}
        disabled={scale <= ZOOM_MIN + 1e-9}
        aria-label={t("code.pdfZoomOut")}
        className="
          flex size-6 items-center justify-center rounded-sm text-(--muted-foreground) transition-colors
          hover:bg-(--accent) hover:text-(--accent-foreground)
          disabled:pointer-events-none disabled:opacity-40
        "
      >
        <Minus className="size-4" />
      </button>
      <span
        data-slot="docblocks/image-pdf-zoom-indicator"
        className="inline-block min-w-[4ch] px-1 text-right text-xs text-(--muted-foreground) tabular-nums"
      >
        {Math.round(scale * 100)}%
      </span>
      <button
        type="button"
        data-slot="docblocks/image-pdf-zoom-in"
        onClick={onZoomIn}
        disabled={scale >= ZOOM_MAX - 1e-9}
        aria-label={t("code.pdfZoomIn")}
        className="
          flex size-6 items-center justify-center rounded-sm text-(--muted-foreground) transition-colors
          hover:bg-(--accent) hover:text-(--accent-foreground)
          disabled:pointer-events-none disabled:opacity-40
        "
      >
        <Plus className="size-4" />
      </button>
      <button
        type="button"
        data-slot="docblocks/image-pdf-fit-width"
        onClick={onFitWidth}
        aria-label={t("code.pdfFitWidth")}
        className="
          flex size-6 items-center justify-center rounded-sm text-(--muted-foreground) transition-colors
          hover:bg-(--accent) hover:text-(--accent-foreground)
        "
      >
        <StretchHorizontal className="size-4" />
      </button>
      <button
        type="button"
        data-slot="docblocks/image-pdf-fit-height"
        onClick={onFitHeight}
        aria-label={t("code.pdfFitHeight")}
        className="
          flex size-6 items-center justify-center rounded-sm text-(--muted-foreground) transition-colors
          hover:bg-(--accent) hover:text-(--accent-foreground)
        "
      >
        <StretchVertical className="size-4" />
      </button>
    </div>
  );
}

export { PdfZoomControls };
