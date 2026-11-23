/** The PDF preview's page controls bar: the previous / next page buttons
 * + the page indicator + the trailing action (the fullscreen toggle over
 * the inline view, the close over the portaled overlay). The page number
 * stands a fixed width (the total's digit count): the digit count's change
 * (1 → 2) must not shift the buttons. The bar's border + radius read the
 * --docblocks-* tokens over the editor's root and the standard tokens over
 * the portaled overlay (the overlay renders outside the editor's root,
 * where the --docblocks-* tokens are undefined — an undefined var() would
 * fall back to the border's initial 3px/currentColor + the radius's 0). */
import { useTranslation } from "react-i18next";

import type { ComponentType } from "react";

import { cn } from "../shared/ui/cn";
import { ChevronLeft, ChevronRight } from "../shared/ui/icons";

type PdfPageControlsProps = {
  currentPage: number;
  totalPages: number;
  onPrevPage: () => void;
  onNextPage: () => void;
  /** The trailing action button's slot (the fullscreen toggle / the close). */
  actionSlot: string;
  actionLabel: string;
  actionIcon: ComponentType<{ className?: string }>;
  onAction: () => void;
  /** The portaled stand: the standard tokens (the overlay renders over
   *  the document body, outside the editor's root). */
  portaled?: boolean;
};

function PdfPageControls({
  currentPage,
  totalPages,
  onPrevPage,
  onNextPage,
  actionSlot,
  actionLabel,
  actionIcon: ActionIcon,
  onAction,
  portaled,
}: PdfPageControlsProps) {
  const { t } = useTranslation("blocks");
  return (
    <div
      data-slot="docblocks/image-pdf-controls"
      className={cn(
        `flex items-center justify-center gap-1 px-2 py-1`,
        portaled
          ? `rounded-(--radius) border border-(--border) bg-(--muted) select-none`
          : `
            rounded-(--docblocks-radius) border-(length:--docblocks-table-border-width)
            border-(--docblocks-table-border-color) bg-(--muted)
          `
      )}
    >
      <button
        type="button"
        data-slot="docblocks/image-pdf-prev"
        onClick={onPrevPage}
        disabled={currentPage <= 1}
        aria-label={t("code.pdfPrevPage")}
        className="
          flex size-6 items-center justify-center rounded-sm text-(--muted-foreground) transition-colors
          hover:bg-(--accent) hover:text-(--accent-foreground)
          disabled:pointer-events-none disabled:opacity-40
        "
      >
        <ChevronLeft className="size-4" />
      </button>
      <span
        data-slot="docblocks/image-pdf-page-indicator"
        className="px-1 text-xs text-(--muted-foreground) tabular-nums"
      >
        <span className="inline-block text-right" style={{ minWidth: `${Math.max(1, String(totalPages).length)}ch` }}>
          {currentPage}
        </span>
        {" / "}
        {totalPages}
      </span>
      <button
        type="button"
        data-slot="docblocks/image-pdf-next"
        onClick={onNextPage}
        disabled={currentPage >= totalPages}
        aria-label={t("code.pdfNextPage")}
        className="
          flex size-6 items-center justify-center rounded-sm text-(--muted-foreground) transition-colors
          hover:bg-(--accent) hover:text-(--accent-foreground)
          disabled:pointer-events-none disabled:opacity-40
        "
      >
        <ChevronRight className="size-4" />
      </button>
      <button
        type="button"
        data-slot={actionSlot}
        onClick={onAction}
        aria-label={actionLabel}
        className="
          ml-1 flex size-6 items-center justify-center rounded-sm text-(--muted-foreground) transition-colors
          hover:bg-(--accent) hover:text-(--accent-foreground)
        "
      >
        <ActionIcon className="size-4" />
      </button>
    </div>
  );
}

export { PdfPageControls };
