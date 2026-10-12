/**
 * Schema v1 — data contract: public types and block/marks registries.
 * Zero dependencies by design.
 */
export { BLOCK_REGISTRY, LEAF_BLOCK_TYPES, MARK_REGISTRY } from "./registry";
export type { AttrSpec, BlockSpec, MarkSpec } from "./registry";
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
  BlockContent,
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
  ParagraphBlock,
  RootBlock,
  ShapeAttrs,
  ShapeBlock,
  SurfaceBlock,
  TableAttrs,
  TableBlock,
  TableCellBlock,
  TableRowBlock,
  SyncEmbedAttrs,
  SyncEmbedBlock,
  SyncEmbedRef,
  TextRun,
} from "./types";
