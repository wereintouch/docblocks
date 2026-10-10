/**
 * docblocks-core — public entry (headless).
 *
 * Layers (imports only downward): schema <- core <- sync.
 */

/** Stable package marker (useful for diagnostics). */
const PACKAGE = "docblocks-core" as const;

export * from "./core";
export * from "./sync";

export { BLOCK_REGISTRY, LEAF_BLOCK_TYPES, MARK_REGISTRY, validateDoc } from "./schema";
export { PACKAGE };
export type {
  Block,
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
