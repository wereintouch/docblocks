import { describe, expect, expectTypeOf, it } from "vitest";

import { BLOCK_REGISTRY, LEAF_BLOCK_TYPES, MARK_REGISTRY } from "../src/schema";
import type {
  AttrsFor,
  Block,
  BlockType,
  CanvasRef,
  ConnectorAttrs,
  DatabaseBlock,
  DatabaseCellValue,
  DatabaseColumn,
  EmbedAttrs,
  Geometry,
  HeadingAttrs,
  ImageAttrs,
  MarkSet,
  ShapeAttrs,
  SyncEmbedAttrs,
  SyncEmbedRef,
} from "../src/schema";

describe("block registry", () => {
  it("covers exactly the block types (v1 + the v2 canvas set)", () => {
    expect(Object.keys(BLOCK_REGISTRY).sort()).toEqual([
      "callout",
      "canvas-text",
      "code",
      "connector",
      "database",
      "divider",
      "embed",
      "frame",
      "heading",
      "image",
      "latex",
      "list-item",
      "paragraph",
      "root",
      "shape",
      "surface",
      "sync-embed",
      "table",
      "table-cell",
      "table-row",
    ]);
  });

  it("pins the exact allowed child sets per container", () => {
    expect([...(BLOCK_REGISTRY["list-item"].childrenTypes ?? [])].sort()).toEqual(["list-item"]);
    expect([...(BLOCK_REGISTRY.table.childrenTypes ?? [])].sort()).toEqual(["table-row"]);
    expect([...(BLOCK_REGISTRY["table-row"].childrenTypes ?? [])].sort()).toEqual(["table-cell"]);
  });

  it("pins the canvas child sets: surface (no nested surface), frame (page blocks only)", () => {
    expect([...(BLOCK_REGISTRY.surface.childrenTypes ?? [])].sort()).toEqual([
      "callout",
      "canvas-text",
      "code",
      "connector",
      "database",
      "divider",
      "embed",
      "frame",
      "heading",
      "image",
      "latex",
      "list-item",
      "paragraph",
      "shape",
      "sync-embed",
      "table",
    ]);
    expect([...(BLOCK_REGISTRY.frame.childrenTypes ?? [])].sort()).toEqual([
      "callout",
      "code",
      "database",
      "divider",
      "embed",
      "heading",
      "image",
      "latex",
      "list-item",
      "paragraph",
      "sync-embed",
      "table",
    ]);
  });

  it("keeps table internals out of the top level (the root accepts the surface)", () => {
    expect([...(BLOCK_REGISTRY.root.childrenTypes ?? [])].sort()).toEqual([
      "callout",
      "code",
      "database",
      "divider",
      "embed",
      "heading",
      "image",
      "latex",
      "list-item",
      "paragraph",
      "surface",
      "sync-embed",
      "table",
    ]);
  });

  it("marks the database as the only rows-carrying type (leaf, no children)", () => {
    const rowsTypes = Object.entries(BLOCK_REGISTRY)
      .filter(([, spec]) => spec.rows)
      .map(([name]) => name);
    expect(rowsTypes).toEqual(["database"]);
    expect(BLOCK_REGISTRY.database.content).toBe(false);
    expect(BLOCK_REGISTRY.database.children).toBe(false);
  });

  it("allows leaf types only inside table cells (the canvas types are not cell-eligible)", () => {
    expect([...LEAF_BLOCK_TYPES].sort()).toEqual([
      "callout",
      "code",
      "database",
      "divider",
      "embed",
      "heading",
      "image",
      "latex",
      "paragraph",
      "sync-embed",
    ]);
    expect(BLOCK_REGISTRY["table-cell"].childrenTypes).toEqual(LEAF_BLOCK_TYPES);
  });
});

describe("marks registry", () => {
  it("covers exactly the v1 marks", () => {
    expect(Object.keys(MARK_REGISTRY).sort()).toEqual([
      "bold",
      "code",
      "color",
      "highlight",
      "italic",
      "link",
      "math",
      "strike",
      "underline",
    ]);
  });

  it("marks code and math as the only exclusive ones", () => {
    const exclusive = Object.entries(MARK_REGISTRY)
      .filter(([, spec]) => spec.exclusive)
      .map(([name]) => name);
    expect(exclusive.sort()).toEqual(["code", "math"]);
  });
});

describe("type shapes", () => {
  it("heading level is 1-6", () => {
    expectTypeOf<HeadingAttrs["level"]>().toEqualTypeOf<1 | 2 | 3 | 4 | 5 | 6>();
  });

  it("image width is nullable", () => {
    expectTypeOf<ImageAttrs["width"]>().toEqualTypeOf<number | null | undefined>();
  });

  it("maps each mark to its own value type", () => {
    expectTypeOf<MarkSet["bold"]>().toEqualTypeOf<true | undefined>();
    expectTypeOf<MarkSet["link"]>().toEqualTypeOf<{ href: string } | undefined>();
    expectTypeOf<MarkSet["color"]>().toEqualTypeOf<{ value: string } | undefined>();
    expectTypeOf<MarkSet["highlight"]>().toEqualTypeOf<{ value?: string } | undefined>();
    expectTypeOf<MarkSet["math"]>().toEqualTypeOf<{ tex: string } | undefined>();
  });

  it("exposes the 20-type block union", () => {
    expectTypeOf<BlockType>().toEqualTypeOf<
      | "root"
      | "paragraph"
      | "heading"
      | "list-item"
      | "callout"
      | "code"
      | "latex"
      | "table"
      | "table-row"
      | "table-cell"
      | "image"
      | "embed"
      | "sync-embed"
      | "divider"
      | "database"
      | "surface"
      | "shape"
      | "connector"
      | "frame"
      | "canvas-text"
    >();
  });

  it("geometry: the center-anchor shape, optional on every block", () => {
    expectTypeOf<Geometry>().toEqualTypeOf<{
      x: number;
      y: number;
      w: number;
      h: number;
      rotation?: number | undefined;
    }>();
    // Extract keeps working per member and carries the geometry.
    type Shape = Extract<Block, { type: "shape" }>;
    expectTypeOf<Shape["geometry"]>().toEqualTypeOf<Geometry | undefined>();
    expectTypeOf<AttrsFor<"surface">>().toEqualTypeOf<undefined>();
    expectTypeOf<AttrsFor<"frame">>().toEqualTypeOf<undefined>();
  });

  it("shape attrs: required variant enum, the optional paint attrs, the freehand points", () => {
    expectTypeOf<ShapeAttrs["variant"]>().toEqualTypeOf<"rect" | "ellipse" | "diamond" | "line">();
    expectTypeOf<ShapeAttrs["opacity"]>().toEqualTypeOf<number | undefined>();
    expectTypeOf<ShapeAttrs["points"]>().toEqualTypeOf<[number, number][] | undefined>();
    expectTypeOf<AttrsFor<"shape">>().toEqualTypeOf<ShapeAttrs | undefined>();
  });

  it("connector attrs: the required weak refs (at least one field each), the optional label", () => {
    expectTypeOf<CanvasRef>().toEqualTypeOf<{ docId?: string | undefined; blockId?: string | undefined }>();
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
    expectTypeOf<AttrsFor<"database">["columns"]>().toEqualTypeOf<DatabaseColumn[]>();
  });
});
