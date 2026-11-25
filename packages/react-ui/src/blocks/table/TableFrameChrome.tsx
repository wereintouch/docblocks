/** The table's frame-level chrome (pinned to the frame — it stays put
 * while the content scrolls): the add-row chip (below the table, centered
 * on the visible part of it), the size's stand over the add chips' drag
 * (the frame's top-left corner), and the cell's right-click menu (the 0×0
 * trigger stands at the pointer (frame-relative) while the menu is open —
 * the content anchors to the cursor, like a native context menu). The
 * gesture + the doc's commands stand over `use-table-cell-menu` +
 * `use-table-add-chips`. */
import { useTranslation } from "react-i18next";

import type { PointerEvent as ReactPointerEvent } from "react";

import type { BlockId } from "docblocks-core";

import { Button } from "../../shared/ui";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "../../shared/ui/DropdownMenu";
import { cn } from "../../shared/ui/cn";
import { Plus } from "../../shared/ui/icons";
import { preventDefault } from "../../shared/utils";
import { ADD_BUTTON_CLASSES } from "./constants";
import type { HandleKind } from "./models";

interface TableCellMenuStand {
  ctx: { x: number; y: number; cellId: BlockId } | null;
  /** The merge stands over a selected rectangle of at least two cells. */
  canMerge: boolean;
  /** The split stands over a merged cell. */
  canSplit: boolean;
  onMergeCells: () => void;
  onSplitCells: () => void;
  onOpenChange: (open: boolean) => void;
  onCopy: () => void;
  onPaste: () => void;
  onClear: () => void;
}

interface TableFrameChromeProps {
  /** The read-only stand (view / published): the chrome stands no stand. */
  viewMode: boolean;
  insertTableRow: () => void;
  onAddChipPointerDown: (kind: HandleKind) => (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onAddChipPointerMove: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onAddChipPointerUp: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onAddChipPointerCancel: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  rowButtonLeft: number;
  addPreview: { kind: HandleKind; count: number } | null;
  columnCount: number;
  rowCount: number;
  cellMenu: TableCellMenuStand;
}

function TableFrameChrome({
  viewMode,
  insertTableRow,
  onAddChipPointerDown,
  onAddChipPointerMove,
  onAddChipPointerUp,
  onAddChipPointerCancel,
  rowButtonLeft,
  addPreview,
  columnCount,
  rowCount,
  cellMenu,
}: TableFrameChromeProps) {
  const { t } = useTranslation("table");
  return (
    <>
      {!viewMode && (
        <Button
          type="button"
          data-slot="docblocks/table-add-row"
          aria-label={t("add.row")}
          variant="ghost"
          size="icon"
          onClick={insertTableRow}
          onPointerDown={onAddChipPointerDown("row")}
          onPointerMove={onAddChipPointerMove}
          onPointerUp={onAddChipPointerUp}
          onPointerCancel={onAddChipPointerCancel}
          className={cn(ADD_BUTTON_CLASSES, "absolute top-full size-6 -translate-y-1/2 rounded-full")}
          style={{ left: rowButtonLeft }}
        >
          <Plus />
        </Button>
      )}
      {/* The table's size stand (the columns x the rows' RESULTING size +
          the drag's delta): stands only during the add chips' drag (the
          add / remove's preview — the count stands nonzero), the frame's
          top-left corner (the handle band's free zone), muted. The delta
          makes the removal's count explicit (the dimmed rows stand which
          ones go, the number stands how many). */}
      {addPreview !== null && addPreview.count !== 0 ? (
        <div
          data-slot="docblocks/table-size"
          aria-hidden
          className="pointer-events-none absolute top-0.5 left-1.5 text-xs text-(--muted-foreground) select-none"
        >
          {`${
            addPreview.kind === "column" ? columnCount + addPreview.count : columnCount
          } × ${addPreview.kind === "row" ? rowCount + addPreview.count : rowCount} ${
            addPreview.count > 0 ? `+ ${addPreview.count}` : `− ${-addPreview.count}`
          }`}
        </div>
      ) : null}
      <DropdownMenu modal={false} open={cellMenu.ctx !== null} onOpenChange={cellMenu.onOpenChange}>
        <DropdownMenuTrigger asChild>
          <div
            aria-hidden
            className="pointer-events-none absolute size-0"
            style={{ left: cellMenu.ctx?.x ?? 0, top: cellMenu.ctx?.y ?? 0 }}
          />
        </DropdownMenuTrigger>
        <DropdownMenuContent
          data-slot="docblocks/table-cell-menu"
          aria-label={t("cell.options")}
          sideOffset={4}
          onFocusOutside={preventDefault}
        >
          <DropdownMenuItem disabled={!cellMenu.canMerge} onSelect={cellMenu.onMergeCells}>
            {t("cell.merge")}
          </DropdownMenuItem>
          <DropdownMenuItem disabled={!cellMenu.canSplit} onSelect={cellMenu.onSplitCells}>
            {t("cell.split")}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={cellMenu.onCopy}>{t("common:copy")}</DropdownMenuItem>
          <DropdownMenuItem onSelect={cellMenu.onPaste}>{t("common:paste")}</DropdownMenuItem>
          <DropdownMenuItem onSelect={cellMenu.onClear}>{t("common:clear")}</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}

export { TableFrameChrome };
export type { TableCellMenuStand, TableFrameChromeProps };
