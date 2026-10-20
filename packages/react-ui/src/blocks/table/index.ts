/** The table block segment's public API (the original export surface). */
export { TableBlock } from "./TableBlock";
export {
  cellPlainText,
  clampColumnWidth,
  columnDropPosition,
  pasteCellText,
  readClipboardText,
  rowDropPosition,
} from "./utils";
export type { ColumnResizeSession, HandleKind, TableHandleSession, TableDragPreview } from "./models";
