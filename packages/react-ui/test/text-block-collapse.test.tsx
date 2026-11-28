// @vitest-environment jsdom
// The list item's collapse's toggle: the children's hide over the click
// (the view's state, the doc's no change) + the restore, and the
// childless's no-toggle's stand.
import { act, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { BlockId } from "docblocks-core";

import { renderDoc } from "./text-block.helpers";

describe("Collapse toggle", () => {
  it("hides the children on click (view state: no doc change) and restores them", async () => {
    let parent: BlockId = "";
    let child: BlockId = "";
    const doc = renderDoc((d) => {
      parent = d.insertBlock("list-item", { list: "bullet" });
      d.insertText(parent, 0, "parent");
      child = d.insertBlock("list-item", { list: "bullet", indent: 1 });
      d.insertText(child, 0, "child");
    });
    const before = JSON.stringify(doc.toJSON());
    const wrapper = document.querySelector(`[data-block-id="${parent}"]:not([data-slot="docblocks/row"])`);
    expect(wrapper, "the parent list item should be rendered").not.toBeNull();
    const toggle = wrapper!.querySelector<HTMLButtonElement>(':scope > button[data-slot="docblocks/collapse"]');
    expect(toggle, "a list item with children should render a collapse toggle").not.toBeNull();
    expect(toggle!.getAttribute("aria-expanded")).toBe("true");
    expect(
      document.querySelector(`[data-block-id="${child}"]:not([data-slot="docblocks/row"])`),
      "the child should be visible"
    ).not.toBeNull();

    act(() => toggle!.click());

    expect(toggle!.getAttribute("aria-expanded")).toBe("false");
    // The row's exit animation keeps the element in the DOM while it
    // collapses; the unmount stands once it completes (the motion page's
    // row list stands the visible rows only).
    await waitFor(
      () => expect(document.querySelector(`[data-block-id="${child}"]:not([data-slot="docblocks/row"])`)).toBeNull(),
      {
        timeout: 5000,
      }
    );
    expect(JSON.stringify(doc.toJSON()), "a collapse must not touch the doc").toBe(before);

    act(() => toggle!.click());
    await waitFor(
      () =>
        expect(document.querySelector(`[data-block-id="${child}"]:not([data-slot="docblocks/row"])`)).not.toBeNull(),
      {
        timeout: 5000,
      }
    );
  });

  it("renders no toggle for a childless list item", () => {
    renderDoc((d) => {
      const id = d.insertBlock("list-item", { list: "bullet" });
      d.insertText(id, 0, "a leaf");
    });
    expect(document.querySelector('[data-slot="docblocks/collapse"]')).toBeNull();
  });
});
