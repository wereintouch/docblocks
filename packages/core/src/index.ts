/**
 * docblocks-core — public entry (headless).
 *
 * Layers (imports only downward): schema <- core <- sync.
 */

/** Stable package marker (useful for diagnostics). */
const PACKAGE = "docblocks-core" as const;

export { Doc, createDoc, fromJSON, loadDoc } from "./core";
export {
  DetachedBlockError,
  DestroyedViewError,
  DocBlocksError,
  InvalidAttrsError,
  InvalidChildError,
  InvalidMarkError,
  InvalidOperationError,
  InvalidRangeError,
  InvalidSelectionError,
  InvalidSnapshotError,
  SelectionView,
  UnknownBlockError,
  UnknownBlockTypeError,
  createSelection,
} from "./core";
export type {
  Change,
  CreateDocOptions,
  InsertBlockArgs,
  InsertBlockPosition,
  MarkInput,
  Selection,
  TextPoint,
} from "./core";
export { attach, WsSyncProvider } from "./sync";
export type {
  PresenceSelection,
  PresenceState,
  SyncProvider,
  SyncSession,
  Unsubscribe,
  WsLike,
  WsSyncOptions,
} from "./sync";

export {
  BLOCK_REGISTRY,
  LEAF_BLOCK_TYPES,
  MARK_REGISTRY,
  validateBlockAttrs,
  validateDoc,
  validateMarkSet,
} from "./schema";
export { PACKAGE };
export type {
  AttrsFor,
  Block,
  BlockAttrsPatch,
  BlockContent,
  BlockId,
  BlockSpec,
  BlockType,
  CalloutAttrs,
  CalloutBlock,
  CodeAttrs,
  CodeBlock,
  DocJSON,
  DocMeta,
  DividerBlock,
  HeadingAttrs,
  HeadingBlock,
  ImageAttrs,
  ImageBlock,
  LatexAttrs,
  LatexBlock,
  ListItemAttrs,
  ListItemBlock,
  MarkName,
  MarkSet,
  MarkSpec,
  ParagraphBlock,
  RootBlock,
  TableAttrs,
  TableBlock,
  TableCellBlock,
  TableRowBlock,
  TextRun,
  ValidationError,
} from "./schema";
