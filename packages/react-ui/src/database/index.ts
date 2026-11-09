/**
 * The database unit's entry — the unit's barrel for the cross-unit
 * importers. The bridge contract (the `DatabaseBridge` interface + the
 * ordered row wire + the committed-event envelope + the protocol's
 * negotiation + the structured error + the cell-value helpers + the
 * enum-option palette), the filter builder, the table-reading hook, and
 * the grid (the live grid + the enum-options motion slot) stand
 * re-exported here. The in-memory reference bridge is the harness's
 * implementation (the consumer's stand) — the package ships the contract
 * and the UI only; the `databaseBridge` prop stands the consumer's bridge.
 */
export { columnAnnotation, conditionMatches, parseCellValue, TEXT_TYPES, ENUM_OPTION_PALETTE } from "./bridge";
export type {
  BatchOp,
  BridgeColumn,
  BridgeColumnAnnotation,
  BridgeErrorCode,
  BridgeTableDescription,
  BridgeValueInput,
  CellMap,
  CellValueParse,
  Column,
  DatabaseBridge,
  DomainEvent,
  FilterConditionInput,
  FilterInput,
  Id,
  IsoInstant,
  MutationContext,
  MutationReceipt,
  OperationStatus,
  PageQuery,
  PageSnapshot,
  ProtocolCapability,
  ProtocolDescriptor,
  ProtocolLimits,
  QueryOperator,
  QuerySemantics,
  Revision,
  RowPage,
  RowWire,
  SortInput,
  SubscriptionHandle,
  SubscriptionObserver,
  SubscriptionStatus,
  TableDescription,
  TableEnvelopeBase,
  TableEvent,
  TableRef,
  TableSnapshot,
} from "./bridge";
export {
  BASELINE_CAPABILITIES,
  BRIDGE_ERROR_CODES,
  BridgeError,
  PROTOCOL_VERSION,
  isBridgeError,
  isBridgeErrorCode,
  isDatabaseBridge,
  toBridgeError,
  validateProtocolDescriptor,
} from "./bridge";
export { emptyFilter, filterIsComplete, FilterBuilder } from "./filter-builder";
export { cellValueEqual, newMutationContext, useDatabaseTable } from "./use-database-table";
export type { DatabaseTablePhase, DatabaseTableRow, UseDatabaseTable } from "./use-database-table";
export { DatabaseGrid, EnumOptionsMotionSlot } from "./grid";
export type { EnumOptionDraft } from "./grid";
export { DatabaseTable, useTableList } from "./standalone";
export type { DatabaseTableView, UseTableList } from "./standalone";
export type { DatabaseTableProps } from "./standalone";
