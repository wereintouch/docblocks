/**
 * The per-block attrs interfaces and the page / sync-embed / divider
 * block interfaces (the block-union's members over this file). The inline
 * text types stand in text; the table / canvas / database block types
 * stand in their own files; the doc-level types stand in types.
 */
import type { BlockContent } from "./text";
import type { BlockId, PageIndent, TextAlign } from "./types";

interface HeadingAttrs {
  /** Heading level 1-6. */
  level: 1 | 2 | 3 | 4 | 5 | 6;
  align?: TextAlign;
  /** Nesting depth in the page sequence (default 0). */
  indent?: PageIndent;
}

interface ListItemAttrs {
  list: "bullet" | "number" | "task";
  checked?: boolean;
  align?: TextAlign;
  /** Nesting depth in the page sequence (default 0). */
  indent?: PageIndent;
}

interface ParagraphAttrs {
  align?: TextAlign;
  /** Nesting depth in the page sequence (default 0). */
  indent?: PageIndent;
}

interface CalloutAttrs {
  variant?: "info" | "warning" | "danger";
  /** The color override (a hex); absent or `null` = the preset color per
   *  `variant` (the null idiom — attrs are never removed). */
  color?: string | null;
  /** The icon override (a name from the callout's icon catalog); absent or
   *  `null` = the preset icon per `variant`. */
  icon?: string | null;
  align?: TextAlign;
  /** Nesting depth in the page sequence (default 0). */
  indent?: PageIndent;
}

interface QuoteAttrs {
  align?: TextAlign;
  /** Nesting depth in the page sequence (default 0). */
  indent?: PageIndent;
}

interface CodeAttrs {
  language?: string;
  /** The five-line collapsed view (default false). */
  collapsed?: boolean;
  /** The caption line below the block; the empty string means no caption (attrs are never removed). */
  caption?: string;
  /** The line-number column (default true). */
  lineNumbers?: boolean;
  /** Wrap at the container width instead of horizontal scroll (default true). */
  wrap?: boolean;
  /** The mermaid view mode (default "code"). */
  mermaidMode?: "code" | "preview";
  /**
   * The diagram viewport's persisted zoom (the scale factor; 1 = 100%).
   * The mermaid preview's stand — the plain code's rendering stands it
   * inert. Absent or `null` = the identity (the null idiom — attrs are
   * never removed).
   */
  zoom?: number | null;
  /** The diagram viewport's persisted horizontal pan offset (px); absent or `null` = 0. */
  panX?: number | null;
  /** The diagram viewport's persisted vertical pan offset (px); absent or `null` = 0. */
  panY?: number | null;
  /**
   * The diagram viewport's height (px). Absent or `null` = the diagram's
   * natural's height (the auto's stand); a set value stands the clipped
   * window (the pan/zoom's viewport over the large diagram's stand).
   */
  height?: number | null;
  /** Nesting depth in the page sequence (default 0). */
  indent?: PageIndent;
}

interface TableCellAttrs {
  /** The column this cell belongs to (a `columnOrder` entry). Set automatically by the insert path (the cell's position in the row's columnOrder). */
  columnId?: string;
  align?: TextAlign;
  /** The column background color (hex); the display priority layer over the row color. */
  columnColor?: string;
  /** The row background color (hex); stands under the column color. */
  rowColor?: string;
}

interface FileAttrs {
  /** Consumer-owned file id; the blob and its metadata live outside the document. */
  fileId: string;
  /** Nesting depth in the page sequence (default 0). */
  indent?: PageIndent;
}

interface ImageAttrs {
  /** Opaque blob key (resolved by the consumer). */
  src: string;
  /** The display width in px (the aspect ratio stands — the height
   *  follows); absent or `null` = the editor's full width. The renderer
   *  never draws the figure wider than the editor. */
  width?: number | null;
  /** The figure's horizontal placement at a reduced width ("left" is the
   *  absent attr). */
  align?: TextAlign;
  /** The caption line below the figure (the code block's caption idiom;
   *  the empty string is the removed state). */
  caption?: string;
  /** Nesting depth in the page sequence (default 0). */
  indent?: PageIndent;
}

interface EmbedAttrs {
  /** Embed kind; a renderer hint (all kinds render as an iframe in v1). */
  kind: "iframe" | "github" | "figma" | "loom" | "html";
  /** The embedded page URL. */
  src: string;
  /** Accessible title; falls back to the kind in the renderer. */
  title?: string;
  /**
   * The persisted zoom (the scale factor; 1 = 100%). Absent or `null` = the
   * identity (the null idiom — attrs are never removed).
   */
  zoom?: number | null;
  /** The persisted horizontal pan offset (px); absent or `null` = 0. */
  panX?: number | null;
  /** The persisted vertical pan offset (px); absent or `null` = 0. */
  panY?: number | null;
  /**
   * The persisted height (px; the block's stretched stand). Absent or
   * `null` = the default (the `--docblocks-embed-height` token's stand —
   * the minimum; the resize only stretches over it).
   */
  height?: number | null;
  /** Nesting depth in the page sequence (default 0). */
  indent?: PageIndent;
}

interface RootBlock {
  type: "root";
  /** Top-level page blocks, in reading order. */
  children: BlockId[];
}

interface ParagraphBlock {
  type: "paragraph";
  attrs?: ParagraphAttrs;
  content?: BlockContent;
  /** LEGACY nesting form (readable v1): normalized to `indent` on load; the writer never emits it. */
  children?: BlockId[];
}

interface HeadingBlock {
  type: "heading";
  attrs: HeadingAttrs;
  content?: BlockContent;
  /** LEGACY nesting form (readable v1): normalized to `indent` on load; the writer never emits it. */
  children?: BlockId[];
}

interface ListItemBlock {
  type: "list-item";
  attrs: ListItemAttrs;
  content?: BlockContent;
  /** LEGACY nesting form (readable v1): nested `list-item` blocks only; normalized to `indent` on load. */
  children?: BlockId[];
}

interface CalloutBlock {
  type: "callout";
  attrs?: CalloutAttrs;
  content?: BlockContent;
  /** LEGACY nesting form (readable v1): normalized to `indent` on load; the writer never emits it. */
  children?: BlockId[];
}

interface QuoteBlock {
  type: "quote";
  attrs?: QuoteAttrs;
  content?: BlockContent;
  /** LEGACY nesting form (readable v1): normalized to `indent` on load; the writer never emits it. */
  children?: BlockId[];
}

interface CodeBlock {
  type: "code";
  attrs?: CodeAttrs;
  content?: BlockContent;
  /** LEGACY nesting form (readable v1): normalized to `indent` on load; the writer never emits it. */
  children?: BlockId[];
}

interface ImageBlock {
  type: "image";
  attrs: ImageAttrs;
}

interface FileBlock {
  type: "file";
  attrs: FileAttrs;
}

interface EmbedBlock {
  type: "embed";
  attrs: EmbedAttrs;
}

/**
 * A sync-embed reference: the master document, optionally narrowed to a
 * block subtree inside it (the subtree's entry list renders).
 */
interface SyncEmbedRef {
  /** The master document id; the consumer resolves the doc from their own store. */
  docId: string;
  /** A subtree root block of the master; absent — the whole master document. */
  blockId?: string;
}

interface SyncEmbedAttrs {
  /** The reference to the master document. */
  ref: SyncEmbedRef;
  /** Nesting depth in the page sequence (default 0). */
  indent?: PageIndent;
}

interface SyncEmbedBlock {
  type: "sync-embed";
  attrs: SyncEmbedAttrs;
}

interface DividerAttrs {
  /** Nesting depth in the page sequence (default 0). */
  indent?: PageIndent;
}

interface DividerBlock {
  type: "divider";
  attrs?: DividerAttrs;
}

export type {
  CalloutAttrs,
  CalloutBlock,
  CodeAttrs,
  CodeBlock,
  DividerAttrs,
  DividerBlock,
  EmbedAttrs,
  EmbedBlock,
  FileAttrs,
  FileBlock,
  HeadingAttrs,
  HeadingBlock,
  ImageAttrs,
  ImageBlock,
  ListItemAttrs,
  ListItemBlock,
  ParagraphAttrs,
  ParagraphBlock,
  QuoteAttrs,
  QuoteBlock,
  RootBlock,
  SyncEmbedAttrs,
  SyncEmbedBlock,
  SyncEmbedRef,
  TableCellAttrs,
};
