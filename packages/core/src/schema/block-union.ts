/**
 * The block union: any v1/v1.1/v2 block type, each member carrying the
 * optional canvas geometry.
 *
 * The geometry is intersected per member (not over the whole union) so the
 * discriminated union stays distributive: `Extract<Block, { type: T }>` and
 * `AttrsFor<T>` keep working and the snapshot type carries the geometry.
 */
import type {
  CanvasTextAttrs,
  CanvasTextBlock,
  ConnectorAttrs,
  ConnectorBlock,
  FrameBlock,
  GroupAttrs,
  GroupBlock,
  ShapeAttrs,
  ShapeBlock,
  SurfaceBlock,
  WithGeometry,
} from "./canvas";
import type { DatabaseAttrs, DatabaseBlock } from "./database";
import type {
  CalloutAttrs,
  CalloutBlock,
  CodeAttrs,
  CodeBlock,
  DividerBlock,
  EmbedAttrs,
  EmbedBlock,
  HeadingAttrs,
  HeadingBlock,
  ImageAttrs,
  ImageBlock,
  LatexAttrs,
  LatexBlock,
  ListItemAttrs,
  ListItemBlock,
  ParagraphAttrs,
  ParagraphBlock,
  QuoteBlock,
  RootBlock,
  SyncEmbedAttrs,
  SyncEmbedBlock,
  TableAttrs,
  TableBlock,
  TableCellAttrs,
  TableCellBlock,
  TableRowBlock,
} from "./types";

type Block =
  | WithGeometry<RootBlock>
  | WithGeometry<ParagraphBlock>
  | WithGeometry<QuoteBlock>
  | WithGeometry<HeadingBlock>
  | WithGeometry<ListItemBlock>
  | WithGeometry<CalloutBlock>
  | WithGeometry<CodeBlock>
  | WithGeometry<LatexBlock>
  | WithGeometry<TableBlock>
  | WithGeometry<TableRowBlock>
  | WithGeometry<TableCellBlock>
  | WithGeometry<ImageBlock>
  | WithGeometry<EmbedBlock>
  | WithGeometry<SyncEmbedBlock>
  | WithGeometry<DividerBlock>
  | WithGeometry<DatabaseBlock>
  | WithGeometry<SurfaceBlock>
  | WithGeometry<ShapeBlock>
  | WithGeometry<ConnectorBlock>
  | WithGeometry<FrameBlock>
  | WithGeometry<CanvasTextBlock>
  | WithGeometry<GroupBlock>;

/** Block type discriminator. */
type BlockType = Block["type"];

/** Attribute type of the block with the given type; `undefined` for types without attrs. */
type AttrsFor<T extends BlockType> = "attrs" extends keyof Extract<Block, { type: T }>
  ? Extract<Block, { type: T }>["attrs"]
  : undefined;

/**
 * Partial attribute patch accepted by `updateBlock` (any attribute key).
 * The `variant` key is widened: callout, shape, and connector each carry a
 * `variant` with a disjoint enum (an intersection of the three would
 * collapse the bag to never).
 */
type BlockAttrsPatch = Partial<
  ParagraphAttrs &
    TableCellAttrs &
    HeadingAttrs &
    ListItemAttrs &
    Omit<CalloutAttrs, "variant"> &
    CodeAttrs &
    LatexAttrs &
    TableAttrs &
    ImageAttrs &
    EmbedAttrs &
    SyncEmbedAttrs &
    DatabaseAttrs &
    Omit<ShapeAttrs, "variant"> &
    Omit<ConnectorAttrs, "variant"> &
    CanvasTextAttrs &
    GroupAttrs & {
      variant?:
        | "info"
        | "warning"
        | "danger"
        | "rect"
        | "rounded"
        | "ellipse"
        | "diamond"
        | "straight"
        | "orthogonal"
        | "curved";
    }
>;

export type { AttrsFor, Block, BlockAttrsPatch, BlockType };
