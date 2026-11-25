/** The slash menu's shared stand: the block's indent read, the keyboard
 *  scope's hold across the rebuild, the table's first-cell read, and the typed
 *  command insertion (the plan and the apply both stand on them). */
import type { Block, BlockId, Doc, InsertBlockPosition } from "docblocks-core";
import { DEFAULT_TABLE_COLUMN_WIDTH } from "docblocks-core";

import { UnknownSlashCommandError } from "../../shared/errors";
import type { SlashCommand } from "./models";

/** The block snapshot's indent: a non-negative integer attr; absent is 0. */
function indentOf(block: Block): number {
  if (!("attrs" in block)) return 0;
  const indent = (block.attrs as { indent?: unknown } | undefined)?.indent;
  return typeof indent === "number" && Number.isInteger(indent) && indent >= 0 ? indent : 0;
}

/**
 * Hold the editor root's focus across a structural rebuild: the focused
 * inner editable unmounts during the store-driven re-render, and the
 * browser drops the focus to <body> until the next-frame caret re-seating
 * lands. Focusing the (tabIndex -1) root before the rebuild keeps the
 * focus — and the keyboard scope — inside the editor while the gap lasts
 * (the root's keydown handler still owns the hotkeys).
 */
function holdFocus(scope: ParentNode): void {
  if (scope instanceof HTMLElement && scope.isConnected) scope.focus({ preventScroll: true });
}

/** The table's first cell (the caret's seat after the slash Table lands). */
function firstCellOf(doc: Doc, tableId: BlockId): BlockId | undefined {
  const firstRow = doc.getChildren(tableId)[0];
  return firstRow === undefined ? undefined : doc.getChildren(firstRow)[0];
}

/** Insert the command's block with its default attrs (type-safe per type), keeping the trigger's attach level (a subtree view's root level may sit deeper than 0 — the same position and indent were valid before, so the sequence's jump rule holds at the landing). */
function insertCommand(doc: Doc, command: SlashCommand, at?: InsertBlockPosition, indent = 0): BlockId {
  const ind: { indent?: number } = indent !== 0 ? { indent } : {};
  switch (command.type) {
    case "paragraph":
      return doc.insertBlock("paragraph", ind.indent === undefined ? undefined : { ...ind }, at);
    case "heading":
      return doc.insertBlock("heading", { level: command.attrs.level, ...ind }, at);
    case "list-item":
      return doc.insertBlock("list-item", { list: command.attrs.list, ...ind }, at);
    case "quote":
      return doc.insertBlock("quote", ind.indent === undefined ? undefined : { ...ind }, at);
    case "callout":
      return doc.insertBlock("callout", ind.indent === undefined ? undefined : { ...ind }, at);
    case "code":
      return doc.insertBlock(
        "code",
        command.attrs?.language === undefined
          ? ind.indent === undefined
            ? undefined
            : { ...ind }
          : { language: command.attrs.language, ...ind },
        at
      );
    case "divider":
      return doc.insertBlock("divider", ind.indent === undefined ? undefined : { ...ind }, at);
    case "table": {
      // A 2×2 table with the default column widths; the cells stand empty
      // (no child paragraph until the first input activates one).
      const tableId = doc.insertBlock(
        "table",
        { cols: 2, columnWidths: [DEFAULT_TABLE_COLUMN_WIDTH, DEFAULT_TABLE_COLUMN_WIDTH], ...ind },
        at
      );
      for (let row = 0; row < 2; row++) {
        const rowId = doc.insertBlock("table-row", undefined, { parent: tableId });
        for (let col = 0; col < 2; col++) {
          doc.insertBlock("table-cell", undefined, { parent: rowId });
        }
      }
      return tableId;
    }
    default:
      throw new UnknownSlashCommandError(`Unknown slash command type "${(command as { type: string }).type}".`);
  }
}

export { firstCellOf, holdFocus, indentOf, insertCommand };
