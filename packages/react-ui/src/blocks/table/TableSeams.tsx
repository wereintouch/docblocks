/** The table's seam + column-chip chrome over the content (the content's
 * div — it scrolls with the table): the column seams (the interior
 * boundaries + the table's right edge — the resize session), the add
 * chips' ghost column previews (the add / the remove's dimmed last ones),
 * and the add-column chip (the table's right edge). The add-row chip and
 * the size's stand stand at the frame's level (they stay pinned while the
 * content scrolls) — over the entry. */
import { useTranslation } from "react-i18next";

import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from "react";

import { DEFAULT_TABLE_COLUMN_WIDTH } from "docblocks-core";

import { Button } from "../../shared/ui";
import { cn } from "../../shared/ui/cn";
import { Plus } from "../../shared/ui/icons";
import { ADD_BUTTON_CLASSES, HANDLE_ZONE } from "./constants";
import type { HandleKind } from "./models";

interface TableSeamsProps {
  widths: number[];
  tableWidth: number;
  tableHeight: number;
  seamXs: number[];
  resizePreview: { col: number; width: number } | null;
  addPreview: { kind: HandleKind; count: number } | null;
  onSeamPointerDown: (index: number) => (event: ReactPointerEvent<HTMLDivElement>) => void;
  onSeamPointerMove: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onSeamPointerUp: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onSeamPointerCancel: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onSeamKeyDown: (index: number) => (event: ReactKeyboardEvent<HTMLDivElement>) => void;
  onAddChipPointerDown: (kind: HandleKind) => (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onAddChipPointerMove: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onAddChipPointerUp: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onAddChipPointerCancel: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  insertTableColumn: () => void;
}

function TableSeams({
  widths,
  tableWidth,
  tableHeight,
  seamXs,
  resizePreview,
  addPreview,
  onSeamPointerDown,
  onSeamPointerMove,
  onSeamPointerUp,
  onSeamPointerCancel,
  onSeamKeyDown,
  onAddChipPointerDown,
  onAddChipPointerMove,
  onAddChipPointerUp,
  onAddChipPointerCancel,
  insertTableColumn,
}: TableSeamsProps) {
  const { t } = useTranslation("table");
  return (
    <>
      {widths.map((_, col) => {
        // The seam stands at the column's RIGHT edge (the interior
        // boundary, or the table's right edge for the last column —
        // the last column resizes there too).
        const seamIndex = col + 1;
        const x = col + 1 < widths.length ? (seamXs[seamIndex] ?? HANDLE_ZONE + tableWidth) : HANDLE_ZONE + tableWidth;
        return (
          <div
            key={`seam-${seamIndex}`}
            data-slot="docblocks/table-col-resize"
            data-index={col}
            role="separator"
            aria-orientation="vertical"
            aria-label={t("resize.column", { index: col + 1 })}
            tabIndex={0}
            className={cn(
              `
                absolute flex w-1.5 -translate-x-1/2 cursor-col-resize items-stretch justify-center opacity-0
                transition-opacity outline-none
                hover:opacity-100
                focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring
              `,
              resizePreview?.col === seamIndex && "opacity-100"
            )}
            style={{ left: x, top: HANDLE_ZONE, height: tableHeight }}
            onPointerDown={onSeamPointerDown(seamIndex)}
            onPointerMove={onSeamPointerMove}
            onPointerUp={onSeamPointerUp}
            onPointerCancel={onSeamPointerCancel}
            onKeyDown={onSeamKeyDown(seamIndex)}
          >
            <div data-slot="docblocks/table-col-resize-line" className="h-full w-0.5 rounded bg-(--muted-foreground)" />
          </div>
        );
      })}
      {addPreview !== null && addPreview.kind === "column" && addPreview.count > 0
        ? Array.from({ length: addPreview.count }, (_, i) => (
            <div
              key={`ghost-col-${i}`}
              aria-hidden
              data-slot="docblocks/table-ghost-column"
              className="pointer-events-none absolute border-dashed border-border bg-muted/40"
              style={{
                left: HANDLE_ZONE + tableWidth + i * DEFAULT_TABLE_COLUMN_WIDTH,
                top: HANDLE_ZONE,
                width: DEFAULT_TABLE_COLUMN_WIDTH,
                height: tableHeight,
              }}
            />
          ))
        : null}
      {addPreview !== null && addPreview.kind === "column" && addPreview.count < 0
        ? Array.from({ length: -addPreview.count }, (_, i) => {
            const col = widths.length - 1 - i;
            const left = HANDLE_ZONE + widths.slice(0, col).reduce((sum, w) => sum + w, 0);
            return (
              <div
                key={`ghost-col-remove-${i}`}
                aria-hidden
                data-slot="docblocks/table-ghost-column-remove"
                className="pointer-events-none absolute bg-(--muted-foreground)/30"
                style={{ left, top: HANDLE_ZONE, width: widths[col] ?? 0, height: tableHeight }}
              />
            );
          })
        : null}
      <Button
        type="button"
        data-slot="docblocks/table-add-column"
        aria-label={t("add.column")}
        variant="ghost"
        size="icon"
        onClick={insertTableColumn}
        onPointerDown={onAddChipPointerDown("column")}
        onPointerMove={onAddChipPointerMove}
        onPointerUp={onAddChipPointerUp}
        onPointerCancel={onAddChipPointerCancel}
        className={cn(ADD_BUTTON_CLASSES, "absolute size-6 -translate-x-1/2 -translate-y-1/2 rounded-full")}
        style={{
          left:
            HANDLE_ZONE +
            tableWidth +
            (addPreview !== null && addPreview.kind === "column" && addPreview.count > 0
              ? addPreview.count * DEFAULT_TABLE_COLUMN_WIDTH
              : 0),
          top: HANDLE_ZONE + tableHeight / 2,
        }}
      >
        <Plus />
      </Button>
    </>
  );
}

export { TableSeams };
export type { TableSeamsProps };
