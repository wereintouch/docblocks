// @vitest-environment jsdom
// The base view's re-render contract (the BlockGroups' interning's stand,
// the nested mini-doc's path — the table cell's content): a text edit
// inside one cell's mini-doc re-renders only the edited block — the
// sibling cell's content stands (the block's reference's stability over
// the unchanged JSON + the interning), so the per-block subscription and
// the memo's parity hold over the nesting's level as over the page's.
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { createDoc } from "docblocks-core";

import { Editor } from "../src/Editor";
import type { BlockRendererProps } from "../src/blocks/renderers";
import { EditorProvider } from "../src/editor-provider";

const CREATED_AT = "2026-10-10T00:00:00.000Z";

function setup() {
  const doc = createDoc({ id: "base-rerender-doc", createdAt: CREATED_AT });
  const tableId = doc.insertBlock("table", { cols: 2 });
  const rowId = doc.insertBlock("table-row", undefined, { parent: tableId });
  const cellA = doc.insertBlock("table-cell", undefined, { parent: rowId });
  const cellB = doc.insertBlock("table-cell", undefined, { parent: rowId });
  const pA = doc.insertBlock("paragraph", undefined, { parent: cellA });
  doc.insertText(pA, 0, "alpha");
  const pB = doc.insertBlock("paragraph", undefined, { parent: cellB });
  doc.insertText(pB, 0, "beta");
  const seen: Record<string, number> = {};
  const paragraphRenderer = (props: BlockRendererProps) => {
    seen[props.id] = (seen[props.id] ?? 0) + 1;
    return <div data-testid="spy-paragraph">{props.id}</div>;
  };
  const utils = render(
    <EditorProvider doc={doc} blockRenderers={{ paragraph: paragraphRenderer }}>
      <Editor />
    </EditorProvider>
  );
  return { doc, pA, pB, seen, utils };
}

describe("the base view's re-render contract", () => {
  afterEach(cleanup);

  it("a cell's text edit stands the sibling cell's content", () => {
    const { doc, pA, pB, seen } = setup();
    const beforeA = seen[pA]!;
    const beforeB = seen[pB]!;
    expect(beforeA).toBeGreaterThan(0);
    expect(beforeB).toBeGreaterThan(0);

    act(() => {
      doc.insertText(pA, 0, "x");
    });

    // The edited block's view re-renders once; the sibling cell's content
    // stands (the reference's stability over the unchanged JSON).
    expect(seen[pA]).toBe(beforeA + 1);
    expect(seen[pB]).toBe(beforeB);
  });
});
