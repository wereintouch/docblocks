/**
 * Schema v1 — data contract: public types and block/marks registries.
 * Zero dependencies by design.
 */
export { BLOCK_REGISTRY, LEAF_BLOCK_TYPES, MARK_REGISTRY } from "./registry";
export type { AttrSpec, BlockSpec, MarkSpec } from "./registry";
export { validateBlockAttrs, validateDoc, validateMarkSet } from "./validate";
export type { ValidationError } from "./validate";
export type {
  AttrsFor,
  Block,
  BlockAttrsPatch,
  BlockContent,
  BlockId,
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
  ParagraphBlock,
  RootBlock,
  TableAttrs,
  TableBlock,
  TableCellBlock,
  TableRowBlock,
  TextRun,
} from "./types";
