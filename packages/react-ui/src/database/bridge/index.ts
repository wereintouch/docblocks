// The DatabaseBridge contract's cross-unit surface: the contract's types
// (the ordered row wire, the snapshot / page, the mutation context +
// receipt, the committed-event envelope, the protocol descriptor), the
// structured error, the protocol's negotiation helpers, the column
// annotation, the cell-value parse / filter evaluation, and the enum
// option catalog.
export { TEXT_TYPES, VALUELESS_OPERATORS, columnAnnotation } from "./annotation";
export { conditionMatches, parseCellValue } from "./filter";
export { ENUM_OPTION_COLOR_COLUMN, ENUM_OPTION_NAME_COLUMN, ENUM_OPTION_PALETTE } from "./enum";
export { BridgeError, BRIDGE_ERROR_CODES, isBridgeError, isBridgeErrorCode, toBridgeError } from "./errors";
export type { BridgeErrorCode } from "./errors";
export { BASELINE_CAPABILITIES, PROTOCOL_VERSION, isDatabaseBridge, validateProtocolDescriptor } from "./protocol";
export type {
  BatchOp,
  BridgeColumn,
  BridgeColumnAnnotation,
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
} from "./models";
