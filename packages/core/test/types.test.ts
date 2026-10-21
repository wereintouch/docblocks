import { describe, expect, expectTypeOf, it } from "vitest";

import { BLOCK_REGISTRY, LEAF_BLOCK_TYPES, MARK_REGISTRY } from "../src/schema";
import type {
  AttrsFor,
  Block,
  BlockType,
  CalloutAttrs,
  CanvasRef,
  CodeAttrs,
  ConnectorAttrs,
  DatabaseAttrs,
  DatabaseBlock,
  DatabaseCellValue,
  DatabaseColumn,
  DividerAttrs,
  EmbedAttrs,
  Geometry,
  HeadingAttrs,
  ImageAttrs,
  LatexAttrs,
  ListItemAttrs,
  MarkSet,
  ParagraphAttrs,
  ShapeAttrs,
  SurfaceAttrs,
  SyncEmbedAttrs,
  SyncEmbedRef,
  TableAttrs,
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
      "group",
      "heading",
      "image",
      "latex",
      "list-item",
      "paragraph",
      "quote",
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
    // The structural containers (the writer contract).
    expect([...(BLOCK_REGISTRY.table.childrenTypes ?? [])].sort()).toEqual(["table-row"]);
    expect([...(BLOCK_REGISTRY["table-row"].childrenTypes ?? [])].sort()).toEqual(["table-cell"]);
    // The remodeled page types: no children of their own; the LEGACY form
    // (still valid v1) keeps its child-type rules.
    const pageSet = [...(BLOCK_REGISTRY.root.childrenTypes ?? [])].sort();
    for (const type of ["paragraph", "quote", "heading", "callout", "code", "latex"] as const) {
      expect(BLOCK_REGISTRY[type].children, `${type} is structurally childless`).toBe(false);
      expect([...(BLOCK_REGISTRY[type].legacyChildrenTypes ?? [])].sort(), `${type} legacy form`).toEqual(pageSet);
    }
    expect(BLOCK_REGISTRY["list-item"].children).toBe(false);
    expect([...(BLOCK_REGISTRY["list-item"].legacyChildrenTypes ?? [])].sort()).toEqual(["list-item"]);
    // The flat page sequences (the indent-jump rule contexts).
    expect(BLOCK_REGISTRY.root.sequence).toBe(true);
    expect(BLOCK_REGISTRY["table-cell"].sequence).toBe(true);
    expect(BLOCK_REGISTRY.frame.sequence).toBe(true);
    for (const type of ["table", "table-row", "surface", "list-item"] as const) {
      expect(BLOCK_REGISTRY[type].sequence, `${type} is not a page sequence`).toBeFalsy();
    }
  });

  it("pins the indent attr: every page-sequence type, none on the structural-context types", () => {
    for (const type of [
      "paragraph",
      "quote",
      "heading",
      "list-item",
      "callout",
      "code",
      "latex",
      "table",
      "image",
      "embed",
      "sync-embed",
      "divider",
      "database",
      "surface",
    ] as const) {
      expect(BLOCK_REGISTRY[type].attrs?.indent, `indent on ${type}`).toEqual({
        kind: "number",
        integer: true,
        min: 0,
      });
    }
    for (const type of ["table-row", "table-cell", "shape", "connector", "frame", "canvas-text"] as const) {
      expect(BLOCK_REGISTRY[type].attrs?.indent, `no indent on ${type}`).toBeUndefined();
    }
  });

  it("pins the code block's display attrs (the code-block header state)", () => {
    const attrs = BLOCK_REGISTRY.code.attrs;
    expect(attrs?.language).toEqual({ kind: "string" });
    expect(attrs?.collapsed).toEqual({ kind: "boolean" });
    expect(attrs?.caption).toEqual({ kind: "string" });
    expect(attrs?.lineNumbers).toEqual({ kind: "boolean" });
    expect(attrs?.wrap).toEqual({ kind: "boolean" });
    expect(attrs?.mermaidMode).toEqual({ kind: "enum", values: ["code", "preview"] });
    expect(Object.keys(attrs ?? {}).sort()).toEqual(
      ["caption", "collapsed", "indent", "language", "lineNumbers", "mermaidMode", "wrap"].sort()
    );
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
      "group",
      "heading",
      "image",
      "latex",
      "list-item",
      "paragraph",
      "quote",
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
      "quote",
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
      "quote",
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

  it("exposes the 22-type block union", () => {
    expectTypeOf<BlockType>().toEqualTypeOf<
      | "root"
      | "paragraph"
      | "quote"
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
      | "group"
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
    // The flat page model: the surface (a page-sequence type) carries the
    // optional indent; the frame (structural context) has no attrs.
    expectTypeOf<AttrsFor<"surface">>().toEqualTypeOf<SurfaceAttrs | undefined>();
    expectTypeOf<AttrsFor<"frame">>().toEqualTypeOf<undefined>();
  });

  it("shape attrs: required variant enum, the optional paint attrs, the freehand points", () => {
    expectTypeOf<ShapeAttrs["variant"]>().toEqualTypeOf<
      "rect" | "rounded" | "ellipse" | "diamond" | "cylinder" | "cloud"
    >();
    expectTypeOf<ShapeAttrs["opacity"]>().toEqualTypeOf<number | undefined>();
    expectTypeOf<ShapeAttrs["points"]>().toEqualTypeOf<[number, number][] | undefined>();
    expectTypeOf<AttrsFor<"shape">>().toEqualTypeOf<ShapeAttrs | undefined>();
  });

  it("connector attrs: the required endpoints (a block ref with an optional port, or a free x/y point)", () => {
    expectTypeOf<CanvasRef>().toEqualTypeOf<{
      docId?: string | undefined;
      blockId?: string | undefined;
      port?: "north" | "east" | "south" | "west" | undefined;
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
    expectTypeOf<LatexAttrs["indent"]>().toEqualTypeOf<number | undefined>();
    expectTypeOf<TableAttrs["indent"]>().toEqualTypeOf<number | undefined>();
    expectTypeOf<ImageAttrs["indent"]>().toEqualTypeOf<number | undefined>();
    expectTypeOf<EmbedAttrs["indent"]>().toEqualTypeOf<number | undefined>();
    expectTypeOf<SyncEmbedAttrs["indent"]>().toEqualTypeOf<number | undefined>();
    expectTypeOf<DividerAttrs["indent"]>().toEqualTypeOf<number | undefined>();
    expectTypeOf<DatabaseAttrs["indent"]>().toEqualTypeOf<number | undefined>();
    expectTypeOf<SurfaceAttrs["indent"]>().toEqualTypeOf<number | undefined>();
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
