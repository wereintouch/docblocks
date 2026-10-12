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
  InvalidCellValueError,
  InvalidChildError,
  InvalidGeometryError,
  InvalidMarkError,
  InvalidOperationError,
  InvalidRangeError,
  InvalidSelectionError,
  InvalidSnapshotError,
  SelectionView,
  UnknownBlockError,
  UnknownBlockTypeError,
  UnknownColumnError,
  UnknownRowError,
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
export { attach, presenceSelectionOf, WsSyncProvider } from "./sync";
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
  CanvasRef,
  CanvasTextAttrs,
  CanvasTextBlock,
  CodeAttrs,
  CodeBlock,
  ConnectorAttrs,
  ConnectorBlock,
  DatabaseAttrs,
  DatabaseBlock,
  DatabaseCellType,
  DatabaseCellValue,
  DatabaseColumn,
  DocJSON,
  DocMeta,
  DividerBlock,
  EmbedAttrs,
  EmbedBlock,
  FrameBlock,
  Geometry,
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
  ParagraphAttrs,
  ParagraphBlock,
  RootBlock,
  ShapeAttrs,
  ShapeBlock,
  SurfaceBlock,
  TableAttrs,
  TableBlock,
  TableCellAttrs,
  TableCellBlock,
  TableRowBlock,
  SyncEmbedAttrs,
  SyncEmbedBlock,
  SyncEmbedRef,
  TextAlign,
  TextRun,
  ValidationError,
} from "./schema";
