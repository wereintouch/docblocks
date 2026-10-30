/**
 * Schema v1 — data contract: public types and block/marks registries.
 * Zero dependencies by design.
 */
export {
  BLOCK_REGISTRY,
  CALLOUT_ICONS,
  DEFAULT_TABLE_COLUMN_WIDTH,
  LEAF_BLOCK_TYPES,
  MARK_REGISTRY,
  PAGE_BLOCK_TYPES,
} from "./registry";
export type { AttrSpec, BlockSpec, MarkFieldSpec, MarkSpec } from "./registry";
export { flattenDoc } from "./flatten";
export { isReservedId, RESERVED_ID_KEYS } from "./id-safety";
export { normalizeZOrder } from "./z-order";
export {
  checkDatabaseCellValue,
  validateBlockAttrs,
  validateCanvasBlock,
  validateDatabaseBlock,
  validateDoc,
  validateMarkSet,
} from "./validate";
export type { ValidationError } from "./validate";
export type { AttrsFor, Block, BlockAttrsPatch, BlockType } from "./block-union";
export type {
  BlockId,
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
  DatabaseFilterCondition,
  DatabaseFilterPayload,
  DatabaseSavedView,
  DocJSON,
  DocMeta,
  DividerAttrs,
  DividerBlock,
  EmbedAttrs,
  EmbedBlock,
  FrameBlock,
  Geometry,
  HeadingAttrs,
  HeadingBlock,
  ImageAttrs,
  ImageBlock,
  ListItemAttrs,
  ListItemBlock,
  OpaqueBlock,
  PageIndent,
  ParagraphAttrs,
  ParagraphBlock,
  RootBlock,
  ShapeAttrs,
  ShapeBlock,
  SurfaceAttrs,
  SurfaceBlock,
  TableCellAttrs,
  SyncEmbedAttrs,
  SyncEmbedBlock,
  SyncEmbedRef,
  TextAlign,
} from "./types";
export type { BlockContent, MarkName, MarkSet, MentionKind, MentionMark, TextRun } from "./text";
export type { TableAttrs, TableBlock, TableCellBlock, TableRowBlock } from "./table";
