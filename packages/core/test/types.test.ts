import { describe, expect, it } from "vitest";

import { BLOCK_REGISTRY, LEAF_BLOCK_TYPES, MARK_REGISTRY } from "../src/schema";

/**
 * The schema's block + marks registry (the sibling types-shapes.test.ts
 * stands the type shapes): the exact type sets, the allowed child sets,
 * and the attrs' pins.
 */

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
      "file",
      "frame",
      "group",
      "heading",
      "image",
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
    for (const type of ["paragraph", "quote", "heading", "callout", "code"] as const) {
      expect(BLOCK_REGISTRY[type].children, `${type} is structurally childless`).toBe(false);
      expect([...(BLOCK_REGISTRY[type].legacyChildrenTypes ?? [])].sort(), `${type} legacy form`).toEqual(pageSet);
    }
    expect(BLOCK_REGISTRY["list-item"].children).toBe(false);
    expect([...(BLOCK_REGISTRY["list-item"].legacyChildrenTypes ?? [])].sort()).toEqual(["list-item"]);
    // The flat page sequences (the indent-jump rule contexts). The frame is
    // a viewport window (no children, no nested page) — not a sequence.
    expect(BLOCK_REGISTRY.root.sequence).toBe(true);
    expect(BLOCK_REGISTRY["table-cell"].sequence).toBe(true);
    expect(BLOCK_REGISTRY.frame.sequence, "the frame is not a page sequence (the window is childless)").toBeFalsy();
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
      "table",
      "image",
      "file",
      "embed",
      "sync-embed",
      "divider",
      "database",
      "surface",
      "frame",
    ] as const) {
      expect(BLOCK_REGISTRY[type].attrs?.indent, `indent on ${type}`).toEqual({
        kind: "number",
        integer: true,
        min: 0,
      });
    }
    for (const type of ["table-row", "table-cell", "shape", "connector", "canvas-text"] as const) {
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
    // The mermaid preview's viewport's stand (the persisted view's attrs —
    // the embed block's parity): the zoom / pan / the stretched's height.
    expect(attrs?.zoom).toEqual({ kind: "nullable-number", positive: true });
    expect(attrs?.panX).toEqual({ kind: "nullable-number" });
    expect(attrs?.panY).toEqual({ kind: "nullable-number" });
    expect(attrs?.height).toEqual({ kind: "nullable-number", positive: true });
    expect(Object.keys(attrs ?? {}).sort()).toEqual(
      [
        "caption",
        "collapsed",
        "height",
        "indent",
        "language",
        "lineNumbers",
        "mermaidMode",
        "panX",
        "panY",
        "wrap",
        "zoom",
      ].sort()
    );
  });

  it("pins the canvas child sets: the surface (no nested surface, the frame with the page set); the frame is childless", () => {
    expect([...(BLOCK_REGISTRY.surface.childrenTypes ?? [])].sort()).toEqual([
      "callout",
      "canvas-text",
      "code",
      "connector",
      "database",
      "divider",
      "embed",
      "file",
      "frame",
      "group",
      "heading",
      "image",
      "list-item",
      "paragraph",
      "quote",
      "shape",
      "sync-embed",
      "table",
    ]);
    // The frame is a viewport window: no children, no nested page, no
    // sequence — the two contexts (the canvas frame, the page-frame block)
    // stand in the parent's element set (the frame's attrs spec and the
    // canvas-text's text style attrs are pinned in blocks.test.ts).
    expect(BLOCK_REGISTRY.frame.children).toBe(false);
    expect(BLOCK_REGISTRY.frame.childrenTypes).toBeUndefined();
  });

  it("keeps table internals out of the top level (the root accepts the surface and the page-frame block)", () => {
    expect([...(BLOCK_REGISTRY.root.childrenTypes ?? [])].sort()).toEqual([
      "callout",
      "code",
      "database",
      "divider",
      "embed",
      "file",
      "frame",
      "heading",
      "image",
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
      "file",
      "heading",
      "image",
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
      "mention",
      "strike",
      "underline",
    ]);
  });

  it("marks code as the only exclusive one", () => {
    const exclusive = Object.entries(MARK_REGISTRY)
      .filter(([, spec]) => spec.exclusive)
      .map(([name]) => name);
    expect(exclusive.sort()).toEqual(["code"]);
  });
});
