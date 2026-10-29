// The DatabaseBridge contract's cross-unit surface (C6): the contract types,
// the column annotation, the cell-value parse / filter evaluation, and the
// enum option catalog.

export { TEXT_TYPES, VALUELESS_OPERATORS, columnAnnotation } from "./annotation";
export { conditionMatches, parseCellValue } from "./filter";
export { ENUM_OPTION_COLOR_COLUMN, ENUM_OPTION_NAME_COLUMN, ENUM_OPTION_PALETTE } from "./enum";
export type {
  BridgeColumn,
  BridgeColumnAnnotation,
  BridgeTableDescription,
  BridgeValueInput,
  CellValueParse,
  DatabaseBridge,
  RowPage,
  RowQuery,
  TableEvent,
  TableRef,
} from "./models";
