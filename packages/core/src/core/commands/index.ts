/**
 * The command surface of the semantic layer — the unit's barrel. Sibling
 * units (the doc facade, the readers, the events, the selection deltas)
 * import the commands, the command-args types, and the structural
 * accessors (getBlockMap, findParent, derivedZIndex) through this entry
 * rather than the individual command files.
 */
export {
  assertAttributeKey,
  assertAttributeValue,
  removeAttribute,
  removeBlockAttr,
  renameAttribute,
  reorderAttributes,
  setAttribute,
  setAvatar,
  setTitle,
  updateBlock,
} from "./attrs";
export { insertBlock, moveBlock, removeBlock } from "./blocks";
export type { InsertBlockArgs, InsertBlockPosition } from "./blocks";
export { insertRow, moveRow, removeRow, setCell, setDatabaseTable } from "./database";
export { setGeometry } from "./geometry";
export { setMark, unsetMark } from "./marks";
export type { MarkInput } from "./marks";
export { findParent, getBlockMap } from "./structure";
export {
  DEFAULT_TABLE_COLUMN_WIDTH,
  clearTableColumn,
  clearTableRow,
  duplicateTableColumn,
  duplicateTableRow,
  insertTableColumn,
  insertTableRow,
  mergeTableCells,
  moveTableColumn,
  moveTableRow,
  removeTableColumn,
  removeTableRow,
  setTableColumnColor,
  setTableColumnWidth,
  setTableRowColor,
  splitTableCells,
} from "./table";
export type { TableGridPoint } from "./table";
export { deleteText, insertText } from "./text";
export { deleteTextRange, setMarkRange } from "./text-range";
export { changeBlockType } from "./types";
export type { ChangeBlockTypeArgs } from "./types";
export { derivedZIndex, setZOrder } from "./z-order";
export type { ZOrderAction } from "./z-order";
