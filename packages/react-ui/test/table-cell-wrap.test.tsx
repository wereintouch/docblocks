// @vitest-environment jsdom
// The cell text's wrap: the long word's break on the cell's text surfaces
// (both modes).
import { cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { renderTableDoc } from "./table-cell.helpers";

describe("the cell text's wrap (the long word's break)", () => {
  afterEach(cleanup);

  it("carries the long word's break on the cell's text surfaces (both modes)", () => {
    // The fixed-width cell's long word must break inside the cell: the
    // inner's own `break-words` (the read-only modes have no editable's
    // UA default to inherit — the word spilled onto the neighbor without
    // it).
    const filled = renderTableDoc(true);
    const inner = document.querySelector<HTMLElement>(
      `[data-block-id="${filled.firstCellId}"] [data-slot="docblocks/block-content"]`
    );
    expect(inner?.className).toContain("wrap-break-word");
    cleanup();

    // The empty cell's activation layer (the first input materializes the
    // paragraph — the typed word stands in the layer first).
    const empty = renderTableDoc(false);
    const activation = document.querySelector<HTMLElement>('[data-slot="docblocks/cell-activation"]');
    expect(activation?.className).toContain("wrap-break-word");
    expect(empty.firstCellId).not.toBe("");
  });
});
