/**
 * The database unit's entry — the unit's barrel for the cross-unit
 * importers. The bridge contract (the DatabaseBridge interface + the
 * cell-value helpers + the enum-option palette), the default in-memory
 * bridge, the filter builder, the table-reading hook, and the grid (the
 * live grid + the enum-options motion slot) stand re-exported here.
 */
export { columnAnnotation, conditionMatches, parseCellValue, ENUM_OPTION_PALETTE } from "./bridge";
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
} from "./bridge";
export { createMemoryDatabaseBridge, getDefaultDatabaseBridge } from "./memory-bridge";
export { emptyFilter, filterIsComplete, FilterBuilder } from "./filter-builder";
export { useDatabaseTable } from "./use-database-table";
export type { DatabaseTablePhase, DatabaseTableRow } from "./use-database-table";
export { DatabaseGrid, EnumOptionsMotionSlot } from "./grid";
export type { EnumOptionDraft } from "./grid";
