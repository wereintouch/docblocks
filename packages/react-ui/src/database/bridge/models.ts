/**
 * The DatabaseBridge contract's types. The stable data model: the
 * `tableId` / `rowId` / `fieldId` are stable opaque identifiers (the
 * label is never the identity); a page's rows are an ORDERED array of
 * `RowWire`, not an id-keyed record, so the server's row order survives
 * the wire. The client keeps in the document only the table reference
 * and the block's view (filter / sort / column display); the schema, the
 * rows, the event log and the authorization live in the consumer's
 * database. Every `tableId` / `rowId` / `fieldId`, filter, sort, cursor,
 * cell and the document's reference is untrusted input — the server
 * validates and normalizes each one and scopes the lookup by the
 * verified session.
 *
 * The grid-facing shapes (`BridgeColumn` / `BridgeTableDescription`) are
 * the hook's view over the wire schema (the display attributes flattened);
 * the cell annotation + the value parse + the filter evaluation stand the
 * cell editor and the filter builder.
 */

export type {
  DomainEvent,
  MutationContext,
  MutationReceipt,
  OperationStatus,
  ProtocolCapability,
  ProtocolDescriptor,
  ProtocolLimits,
  SubscriptionHandle,
  SubscriptionObserver,
  SubscriptionStatus,
  TableEnvelopeBase,
  TableEvent,
} from "./event-types";
export type {
  BridgeColumn,
  BridgeColumnAnnotation,
  BridgeTableDescription,
  BridgeValueInput,
  CellValueParse,
} from "./grid-types";
export type { BatchOp, DatabaseBridge } from "./mutation-types";
export type {
  CellMap,
  Column,
  FilterConditionInput,
  FilterInput,
  Id,
  IsoInstant,
  PageQuery,
  PageSnapshot,
  QueryOperator,
  QuerySemantics,
  Revision,
  RowPage,
  RowWire,
  SortInput,
  TableDescription,
  TableRef,
  TableSnapshot,
} from "./wire-types";
