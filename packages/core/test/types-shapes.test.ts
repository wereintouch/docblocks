import { describe, expectTypeOf, it } from "vitest";

import type {
  AttrsFor,
  Block,
  BlockType,
  CalloutAttrs,
  CanvasRef,
  CanvasTextAttrs,
  CodeAttrs,
  ConnectorAttrs,
  DatabaseAttrs,
  DatabaseBlock,
  DatabaseCellValue,
  DatabaseColumn,
  DividerAttrs,
  EmbedAttrs,
  FileAttrs,
  FrameAttrs,
  Geometry,
  HeadingAttrs,
  ImageAttrs,
  ListItemAttrs,
  MarkSet,
  PageIndent,
  ParagraphAttrs,
  ShapeAttrs,
  SurfaceAttrs,
  SyncEmbedAttrs,
  SyncEmbedRef,
  TableAttrs,
} from "../src/schema";

/**
 * The schema's type shapes (the sibling of types.test.ts): the attrs'
 * value types, the 22-type block union, and the canvas / frame / embed /
 * sync-embed / database shapes over the expectTypeOf pins.
 */

describe("type shapes", () => {
  it("heading level is 1-6", () => {
    expectTypeOf<HeadingAttrs["level"]>().toEqualTypeOf<1 | 2 | 3 | 4 | 5 | 6>();
  });

  it("image width is nullable", () => {
    expectTypeOf<ImageAttrs["width"]>().toEqualTypeOf<number | null | undefined>();
  });

  it("file carries only the consumer's file id and the page indent", () => {
    expectTypeOf<FileAttrs["fileId"]>().toEqualTypeOf<string>();
    expectTypeOf<FileAttrs["indent"]>().toEqualTypeOf<PageIndent | undefined>();
  });

  it("maps each mark to its own value type", () => {
    expectTypeOf<MarkSet["bold"]>().toEqualTypeOf<true | undefined>();
    expectTypeOf<MarkSet["link"]>().toEqualTypeOf<{ href: string } | undefined>();
    expectTypeOf<MarkSet["color"]>().toEqualTypeOf<{ value: string } | undefined>();
    expectTypeOf<MarkSet["highlight"]>().toEqualTypeOf<{ value?: string } | undefined>();
  });

  it("exposes the 22-type block union", () => {
    expectTypeOf<BlockType>().toEqualTypeOf<
      | "root"
      | "paragraph"
      | "quote"
      | "heading"
      | "list-item"
      | "callout"
      | "code"
      | "table"
      | "table-row"
      | "table-cell"
      | "image"
      | "file"
      | "embed"
      | "sync-embed"
      | "divider"
      | "database"
      | "surface"
      | "shape"
      | "connector"
      | "frame"
      | "canvas-text"
      | "group"
    >();
  });

  it("geometry: the center-anchor shape, optional on every block", () => {
    expectTypeOf<Geometry>().toEqualTypeOf<{
      x: number;
      y: number;
      w: number;
      h: number;
    }>();
    // Extract keeps working per member and carries the geometry.
    type Shape = Extract<Block, { type: "shape" }>;
    expectTypeOf<Shape["geometry"]>().toEqualTypeOf<Geometry | undefined>();
    // The flat page model: the surface and the frame (page-sequence types)
    // carry the optional indent.
    expectTypeOf<AttrsFor<"surface">>().toEqualTypeOf<SurfaceAttrs | undefined>();
    expectTypeOf<AttrsFor<"frame">>().toEqualTypeOf<FrameAttrs | undefined>();
  });

  it("frame attrs: the two-context window (the canvas frame's title, the page frame's frameId)", () => {
    expectTypeOf<FrameAttrs["title"]>().toEqualTypeOf<string | undefined>();
    expectTypeOf<FrameAttrs["frameId"]>().toEqualTypeOf<string | undefined>();
    // The frame is a viewport window: no children, no content — the block
    // type stands exactly the discriminator, the attrs, and the geometry.
    type Frame = Extract<Block, { type: "frame" }>;
    expectTypeOf<keyof Frame>().toEqualTypeOf<"type" | "attrs" | "geometry">();
  });

  it("canvas-text attrs: the text style attrs (the shape's text parity)", () => {
    expectTypeOf<CanvasTextAttrs["textColor"]>().toEqualTypeOf<string | undefined>();
    expectTypeOf<CanvasTextAttrs["textStyle"]>().toEqualTypeOf<
      "regular" | "semibold" | "light" | "light-italic" | "italic" | "semibold-italic" | undefined
    >();
    expectTypeOf<AttrsFor<"canvas-text">>().toEqualTypeOf<CanvasTextAttrs | undefined>();
  });

  it("shape attrs: required variant enum, the optional paint attrs, the freehand points", () => {
    expectTypeOf<ShapeAttrs["variant"]>().toEqualTypeOf<
      "rect" | "rounded" | "ellipse" | "diamond" | "cylinder" | "cloud"
    >();
    expectTypeOf<ShapeAttrs["opacity"]>().toEqualTypeOf<number | undefined>();
    expectTypeOf<ShapeAttrs["points"]>().toEqualTypeOf<[number, number][] | undefined>();
    expectTypeOf<AttrsFor<"shape">>().toEqualTypeOf<ShapeAttrs | undefined>();
  });

  it("connector attrs: the required endpoints (a block ref with an optional port / portT, or a free x/y point)", () => {
    expectTypeOf<CanvasRef>().toEqualTypeOf<{
      docId?: string | undefined;
      blockId?: string | undefined;
      port?: "north" | "east" | "south" | "west" | undefined;
      portT?: number | undefined;
      x?: number | undefined;
      y?: number | undefined;
    }>();
    expectTypeOf<ConnectorAttrs["start"]>().toEqualTypeOf<CanvasRef>();
    expectTypeOf<ConnectorAttrs["label"]>().toEqualTypeOf<string | undefined>();
    expectTypeOf<AttrsFor<"connector">>().toEqualTypeOf<ConnectorAttrs>();
  });

  it("embed attrs: required kind enum and required src, optional title", () => {
    expectTypeOf<EmbedAttrs["kind"]>().toEqualTypeOf<"iframe" | "github" | "figma" | "loom" | "html">();
    expectTypeOf<EmbedAttrs["src"]>().toEqualTypeOf<string>();
    expectTypeOf<EmbedAttrs["title"]>().toEqualTypeOf<string | undefined>();
    expectTypeOf<AttrsFor<"embed">>().toEqualTypeOf<EmbedAttrs>();
  });

  it("indent: an optional number on every page-sequence type (the flat page model)", () => {
    expectTypeOf<ParagraphAttrs["indent"]>().toEqualTypeOf<number | undefined>();
    expectTypeOf<HeadingAttrs["indent"]>().toEqualTypeOf<number | undefined>();
    expectTypeOf<ListItemAttrs["indent"]>().toEqualTypeOf<number | undefined>();
    expectTypeOf<CalloutAttrs["indent"]>().toEqualTypeOf<number | undefined>();
    expectTypeOf<CodeAttrs["indent"]>().toEqualTypeOf<number | undefined>();
    expectTypeOf<TableAttrs["indent"]>().toEqualTypeOf<number | undefined>();
    expectTypeOf<ImageAttrs["indent"]>().toEqualTypeOf<number | undefined>();
    expectTypeOf<EmbedAttrs["indent"]>().toEqualTypeOf<number | undefined>();
    expectTypeOf<SyncEmbedAttrs["indent"]>().toEqualTypeOf<number | undefined>();
    expectTypeOf<DividerAttrs["indent"]>().toEqualTypeOf<number | undefined>();
    expectTypeOf<DatabaseAttrs["indent"]>().toEqualTypeOf<number | undefined>();
    expectTypeOf<SurfaceAttrs["indent"]>().toEqualTypeOf<number | undefined>();
    expectTypeOf<FrameAttrs["indent"]>().toEqualTypeOf<number | undefined>();
  });

  it("sync-embed attrs: required ref with required docId, optional blockId", () => {
    expectTypeOf<SyncEmbedRef["docId"]>().toEqualTypeOf<string>();
    expectTypeOf<SyncEmbedRef["blockId"]>().toEqualTypeOf<string | undefined>();
    expectTypeOf<AttrsFor<"sync-embed">>().toEqualTypeOf<SyncEmbedAttrs>();
  });

  it("database: the column type union, the cell value union, rows + rowOrder", () => {
    expectTypeOf<DatabaseColumn["type"]>().toEqualTypeOf<
      "text" | "number" | "checkbox" | "select" | "multi-select" | "date"
    >();
    expectTypeOf<DatabaseCellValue>().toEqualTypeOf<string | number | boolean | string[]>();
    expectTypeOf<DatabaseBlock["rows"]>().toEqualTypeOf<Record<string, Record<string, DatabaseCellValue>>>();
    expectTypeOf<DatabaseBlock["rowOrder"]>().toEqualTypeOf<string[]>();
    expectTypeOf<AttrsFor<"database">["columns"]>().toEqualTypeOf<DatabaseColumn[] | undefined>();
    expectTypeOf<AttrsFor<"database">["tableId"]>().toEqualTypeOf<string | undefined>();
  });
});
