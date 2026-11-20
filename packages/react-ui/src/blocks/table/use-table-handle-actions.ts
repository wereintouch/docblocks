/** The table handle's menu actions (insert / move / duplicate / clear /
 * delete) and the background color set / remove — the doc's commands
 * behind a rejection guard (a concurrent structural change wins the
 * race, the doc stands as-is). */
import type { Doc } from "docblocks-core";

import { focusCaretIn } from "../../editing/block-commands";
import { assertNever } from "../../shared/utils";
import type { HandleAction, HandleKind } from "./models";

interface UseTableHandleActionsArgs {
  doc: Doc;
  rows: string[];
  tableBlockId: string;
  /** The handle menu's close (the pick's stand: the swatch's press is no
   * menu item — the Radix's item-close does not reach it). */
  setMenu: (menu: { kind: HandleKind; index: number } | null) => void;
  scrollRef: { current: HTMLDivElement | null };
}

function useTableHandleActions({ doc, rows, tableBlockId, setMenu, scrollRef }: UseTableHandleActionsArgs) {
  /** The handle's menu action (the item's doc command; the last-row/column
   * delete converts the table into a paragraph — the caret seats in it). */
  const handleAction = (kind: HandleKind, index: number, action: HandleAction) => {
    const rowId = rows[index] ?? "";
    try {
      switch (action) {
        case "insert-after":
          if (kind === "column") doc.insertTableColumn(tableBlockId, index + 1);
          else doc.insertTableRow(tableBlockId, index + 1);
          break;
        case "insert-before":
          if (kind === "column") doc.insertTableColumn(tableBlockId, index);
          else doc.insertTableRow(tableBlockId, index);
          break;
        case "move-next":
          // The core's pre-move target index: one slot down/right is
          // `index + 2` (the row's own slot is `index + 1`); one up/left is
          // `index - 1`.
          if (kind === "column") doc.moveTableColumn(tableBlockId, index, index + 2);
          else doc.moveTableRow(tableBlockId, rowId, index + 2);
          break;
        case "move-prev":
          if (kind === "column") doc.moveTableColumn(tableBlockId, index, index - 1);
          else doc.moveTableRow(tableBlockId, rowId, index - 1);
          break;
        case "duplicate":
          if (kind === "column") doc.duplicateTableColumn(tableBlockId, index);
          else doc.duplicateTableRow(tableBlockId, rowId);
          break;
        case "clear":
          if (kind === "column") doc.clearTableColumn(tableBlockId, index);
          else doc.clearTableRow(tableBlockId, rowId);
          break;
        case "remove": {
          if (kind === "column") doc.removeTableColumn(tableBlockId, index);
          else doc.removeTableRow(tableBlockId, rowId);
          const converted = doc.getBlock(tableBlockId);
          if (converted !== null && converted.type === "paragraph") {
            const scope = scrollRef.current?.closest<HTMLElement>('[data-slot="docblocks/editor"]') ?? document;
            focusCaretIn(tableBlockId, 0, scope);
          }
          break;
        }
        default:
          assertNever(action);
      }
    } catch {
      // A rejected command (a concurrent structural change won the race):
      // the doc stands as-is, the menu closes on the selection anyway.
    }
  };

  /** The background color set/remove (the palette swatches and the remove item). */
  const handleSetColor = (kind: HandleKind, index: number, color: string | null) => {
    const rowId = rows[index] ?? "";
    try {
      if (kind === "column") doc.setTableColumnColor(tableBlockId, index, color);
      else doc.setTableRowColor(tableBlockId, rowId, color);
    } catch {
      // A rejected command (a concurrent structural change won the race).
    }
    setMenu(null);
  };

  // The handle menu's action / color commits stand the handle's kind +
  // index over the shared handle handlers (the map's per-item stand).
  const onColumnHandleAction =
    (index: number) =>
    (action: HandleAction): void =>
      handleAction("column", index, action);
  const onRowHandleAction =
    (rowIndex: number) =>
    (action: HandleAction): void =>
      handleAction("row", rowIndex, action);
  const onColumnHandleColor =
    (index: number) =>
    (color: string | null): void =>
      handleSetColor("column", index, color);
  const onRowHandleColor =
    (rowIndex: number) =>
    (color: string | null): void =>
      handleSetColor("row", rowIndex, color);

  return { onColumnHandleAction, onColumnHandleColor, onRowHandleAction, onRowHandleColor };
}

export { useTableHandleActions };
