/**
 * core — Doc: Y.Doc + semantic commands + transactions + undo + fine-grained
 * reactivity. The only path for normal document editing.
 */
export {
  DetachedBlockError,
  DestroyedViewError,
  DocBlocksError,
  ExternalDatabaseError,
  InvalidAttrsError,
  InvalidCellValueError,
  InvalidChildError,
  InvalidGeometryError,
  InvalidMarkError,
  InvalidOperationError,
  InvalidRangeError,
  InvalidSelectionError,
  InvalidSnapshotError,
  UnknownBlockError,
  UnknownBlockTypeError,
  UnknownColumnError,
  UnknownRowError,
} from "./errors";
export { DEFAULT_TABLE_COLUMN_WIDTH } from "./commands/table";
export type { InsertBlockArgs, InsertBlockPosition } from "./commands/blocks";
export type { ChangeBlockTypeArgs } from "./commands/types";
export type { MarkInput } from "./commands/marks";
export type { ZOrderAction } from "./commands/z-order";
export type { Change } from "./events";
export { localOriginOf } from "./layout";
export { undoManagerOf } from "./history";
export { Doc, createDoc, fromJSON, loadDoc } from "./doc";
export type { CreateDocOptions } from "./doc";
export { SelectionView, createSelection } from "./selection";
export type { Selection, TextPoint } from "./selection";
