/** The text block's row chrome: the gutter's controls (the drag grip, the
 * quick-insert plus, the delete affordance), the task checkbox, the
 * quote's left rule, the callout's block menu, the flat row's rendered
 * marker, and the collapse toggle. The chrome stands in the wrapper (the
 * page's row level — the cell / surface / read-only stands gate it). */
import { useTranslation } from "react-i18next";

import type { MouseEvent as ReactMouseEvent } from "react";

import type { BlockId, Doc } from "docblocks-core";

import { Button } from "../shared/ui/Button";
import { Checkbox } from "../shared/ui/Checkbox";
import { cn } from "../shared/ui/cn";
import { GripVertical, Plus, Trash, TriangleFilled } from "../shared/ui/icons";
import { CalloutBlockMenu } from "./CalloutBlockMenu";
import { numberMarkerLabel } from "./flat";
import type { EditableBlock } from "./models";
import {
  CHECKBOX_CLASS,
  collapseClassOf,
  gutterClassOf,
  gutterPlusClassOf,
  gutterPlusShiftOf,
  gutterShiftOf,
} from "./text-block-classes";

interface TextBlockRowChromeProps {
  id: BlockId;
  block: EditableBlock;
  /** The marker's cycle index (1|2|3) from the block's indent. */
  cycle: number;
  /** The run position of a `number` item (the marker label; 1-based). */
  number?: number;
  flat: boolean;
  /** The flat list row's marker-zone shift (absent = no shift). */
  flatListShift?: string;
  collapsed: boolean;
  selected: boolean;
  /** The cell context (the row chrome stands off over a table cell). */
  inCell: boolean;
  /** The canvas item's surface context (the row chrome stands off). */
  onSurface: boolean;
  viewMode: boolean;
  /** The block's collapse gate (a non-empty derived segment; the entry's
   * view prop, never document data). */
  collapsible: boolean;
  doc: Doc;
  deleteBlock: (element: HTMLElement, id: BlockId) => void;
  onGutterClick: (event: ReactMouseEvent<HTMLButtonElement>) => void;
  onGutterPlusClick: (event: ReactMouseEvent<HTMLButtonElement>) => void;
  onControlMouseDown: (event: ReactMouseEvent<HTMLButtonElement>) => void;
  onCollapseClick: (event: ReactMouseEvent<HTMLButtonElement>) => void;
}

function TextBlockRowChrome({
  id,
  block,
  cycle,
  number,
  flat,
  flatListShift,
  collapsed,
  selected,
  inCell,
  onSurface,
  viewMode,
  collapsible,
  doc,
  deleteBlock,
  onGutterClick,
  onGutterPlusClick,
  onControlMouseDown,
  onCollapseClick,
}: TextBlockRowChromeProps) {
  const { t } = useTranslation("blocks");
  // The flat (motion) row's rendered list marker: a `number` item carries
  // its run-position label (cycled by the marker's cycle); a `bullet`
  // item is an empty span the stylesheet's ::before glyph fills per
  // data-cycle. A `task` item has no marker (the checkbox stands in for
  // it).
  const flatMarkerIsNumber = flat && block.type === "list-item" && block.attrs.list === "number";
  const flatMarkerIsBullet = flat && block.type === "list-item" && block.attrs.list === "bullet";

  return (
    <>
      {!inCell && !onSurface && !viewMode && (
        <Button
          type="button"
          data-slot="docblocks/gutter"
          aria-label={t("row.selectBlock")}
          variant="ghost"
          size="icon"
          onClick={onGutterClick}
          onMouseDown={onControlMouseDown}
          className={cn(gutterClassOf(selected), "size-5")}
          style={gutterShiftOf(flatListShift)}
        >
          <GripVertical />
        </Button>
      )}
      {!inCell && !onSurface && !viewMode && (
        <Button
          type="button"
          data-slot="docblocks/gutter-plus"
          aria-label={t("row.addBlockBelow")}
          variant="ghost"
          size="icon"
          onClick={onGutterPlusClick}
          onMouseDown={onControlMouseDown}
          className={cn(gutterPlusClassOf(selected), "size-5")}
          style={gutterPlusShiftOf(flatListShift)}
        >
          <Plus />
        </Button>
      )}
      {/* The row's delete affordance: the hover's trash icon at the row's
          right edge (centered on the first line, as the grip). The click
          is a true deletion — the Delete key's image special case (the
          in-place conversion) stands for the key gesture only. The icon
          stands the same offset from the block content as the grip (the
          gutter's left offset, mirrored to the right). */}
      {!inCell && !onSurface && !viewMode && (
        <Button
          type="button"
          data-slot="docblocks/gutter-delete"
          aria-label={t("row.deleteBlock")}
          variant="ghost"
          size="icon"
          onClick={(event) => deleteBlock(event.currentTarget, id)}
          onMouseDown={onControlMouseDown}
          className={cn(
            "absolute top-[calc((var(--docblocks-line-box-height)-var(--docblocks-gutter-size))/2)]",
            "cursor-pointer rounded-full opacity-0 group-hover:opacity-100",
            "text-(--docblocks-gutter-color)",
            "size-5",
            selected && "opacity-100"
          )}
          style={{ right: "var(--docblocks-gutter-left)" }}
        >
          <Trash />
        </Button>
      )}
      {block.type === "list-item" && block.attrs.list === "task" && (
        <Checkbox
          data-slot="docblocks/checkbox"
          checked={block.attrs.checked === true}
          disabled={viewMode}
          aria-label={block.attrs.checked ? t("task.markNotDone") : t("task.markDone")}
          // One command is its own transaction: one undo step, one wire update.
          onCheckedChange={(checked) => {
            doc.updateBlock(id, { checked: checked === true });
          }}
          onMouseDown={onControlMouseDown}
          className={CHECKBOX_CLASS}
        />
      )}
      {block.type === "quote" && (
        <div
          data-slot="docblocks/quote-rule"
          aria-hidden
          contentEditable={false}
          className="
            pointer-events-none absolute top-0 bottom-0 left-0 w-(--docblocks-quote-border-width)
            bg-(--docblocks-quote-border-color)
          "
        />
      )}
      {block.type === "callout" && <CalloutBlockMenu id={id} block={block} />}
      {(flatMarkerIsNumber || flatMarkerIsBullet) && (
        <span
          data-slot="docblocks/row-marker"
          data-cycle={cycle}
          data-kind={block.attrs.list}
          // The label is chrome over the shared page editable: unselectable
          // and caret-less (a caret in the label would type over the label
          // itself — the island's stand, the selection's highlight skips it).
          contentEditable={false}
          className="select-none"
        >
          {flatMarkerIsNumber && number !== undefined ? numberMarkerLabel(number, cycle) : null}
        </span>
      )}
      {collapsible ? collapsibleButton(block, collapsed, t, onCollapseClick, onControlMouseDown, flatListShift) : null}
    </>
  );
}

/** The collapse toggle (the view-state flip; the reveal stand while expanded). */
function collapsibleButton(
  block: EditableBlock,
  collapsed: boolean,
  t: (key: string) => string,
  onCollapseClick: (event: ReactMouseEvent<HTMLButtonElement>) => void,
  onControlMouseDown: (event: ReactMouseEvent<HTMLButtonElement>) => void,
  flatListShift: string | undefined
) {
  return (
    <Button
      type="button"
      data-slot="docblocks/collapse"
      aria-label={collapsed ? t("collapse.expand") : t("collapse.collapse")}
      aria-expanded={!collapsed}
      variant="ghost"
      onClick={onCollapseClick}
      onMouseDown={onControlMouseDown}
      className={cn(collapseClassOf(collapsed), "p-0 has-[>svg]:p-0")}
      style={
        flatListShift === undefined
          ? undefined
          : { left: `calc(var(--docblocks-collapse-band-left) - ${flatListShift})` }
      }
    >
      <TriangleFilled className={cn("size-2", collapsed ? "rotate-90" : "rotate-180")} />
    </Button>
  );
}

export { TextBlockRowChrome };
export type { TextBlockRowChromeProps };
