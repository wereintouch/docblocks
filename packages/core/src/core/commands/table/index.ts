/**
 * Table row/column commands: insertTableRow, removeTableRow,
 * moveTableRow, duplicateTableRow, clearTableRow, setTableRowColor, and
 * the column-side counterparts (insertTableColumn, removeTableColumn,
 * moveTableColumn, duplicateTableColumn, clearTableColumn,
 * setTableColumnColor, setTableColumnWidth). Rows and cells are blocks
 * (unlike the database's data rows), so the commands compose the layout
 * primitives inside one local transaction: one command is one update and
 * one undo step.
 *
 * Column identity: `columnWidths` and the per-cell colors follow the
 * column (a move reorders the entries, a duplicate copies them), so a
 * reordered column keeps its width and colors.
 *
 * Removing the LAST row or column converts the table into a plain
 * paragraph in place (the children are gone by then; the indent attr
 * stands).
 */
export { DEFAULT_TABLE_COLUMN_WIDTH } from "./common";
export {
  clearTableColumn,
  duplicateTableColumn,
  insertTableColumn,
  moveTableColumn,
  removeTableColumn,
  setTableColumnColor,
  setTableColumnWidth,
} from "./columns";
export {
  clearTableRow,
  duplicateTableRow,
  insertTableRow,
  moveTableRow,
  removeTableRow,
  setTableRowColor,
} from "./rows";
