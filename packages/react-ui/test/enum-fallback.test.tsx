// @vitest-environment jsdom
// Unknown enum values on KNOWN attrs (a future minor's data, the cross-minor
// reader stand): the editor renders the document, not a crash — the heading
// outside the level set stands the fallback tag, the shape with an unknown
// variant stands the empty figure. The pure geometry's port guard stands
// pinned in connector-path.test.ts (the endpointPointOf's unknown-port
// fallback).
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { fromJSON } from "docblocks-core";
import type { Doc, DocJSON } from "docblocks-core";

import { Editor } from "../src/Editor";
import { EditorProvider } from "../src/editor-provider";

const CREATED_AT = "2026-10-10T00:00:00.000Z";

/**
 * A v1 document carrying the NEW enum values on the known attrs (a future
 * minor's level / variant): the lenient reader boundary tolerates them, so
 * the document loads and the renderer must stand a fallback, not crash.
 */
function enumDoc(): Doc {
  const json: DocJSON = {
    v: 1,
    id: "doc-enum",
    title: "Enum",
    createdAt: CREATED_AT,
    blocks: {
      "doc-enum": { type: "root", children: ["h7", "surface"] },
      // The new heading level (the v1 set is 1-6).
      h7: {
        type: "heading",
        attrs: { level: 7 as 1 },
        content: [{ text: "deep heading", marks: {} }],
      },
      surface: { type: "surface", children: ["hex"] },
      // The new shape variant (the v1 set has no hexagon).
      hex: {
        type: "shape",
        attrs: { variant: "hexagon" as "rect" },
        geometry: { x: 0, y: 0, w: 120, h: 80 },
      },
    },
  };
  return fromJSON(json);
}

describe("the lenient render of unknown enum values", () => {
  afterEach(cleanup);

  it("a heading outside the level set renders (the fallback tag, the text intact)", () => {
    render(
      <EditorProvider doc={enumDoc()}>
        <Editor />
      </EditorProvider>
    );
    const el = document.querySelector<HTMLElement>('[data-block-id="h7"]');
    expect(el).not.toBeNull();
    expect(el!.tagName).toBe("H6");
    expect(el!.textContent).toContain("deep heading");
  });

  it("a shape with an unknown variant renders (the figure stands empty, no crash)", () => {
    const { container } = render(
      <EditorProvider doc={enumDoc()}>
        <Editor view="canvas" />
      </EditorProvider>
    );
    const svg = container.querySelector<SVGElement>('svg[data-slot="docblocks/shape"][data-block-id="hex"]');
    expect(svg).not.toBeNull();
    // The unknown variant draws no figure (the shape's box stands).
    expect(svg!.querySelectorAll("path, rect, ellipse, polygon, line").length).toBe(0);
  });
});
