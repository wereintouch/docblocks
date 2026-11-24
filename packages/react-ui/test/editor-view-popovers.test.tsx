// @vitest-environment jsdom
// The page view's transient surfaces over the view switch: the slash menu
// (and its pickers), the mention picker, the hover card and the link editor
// are page affordances — the canvas view closes them instead of letting a
// ghost menu hang over the canvas.
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { act } from "react";

import { createDoc } from "docblocks-core";

import { Editor } from "../src/Editor";
import { EditorProvider } from "../src/editor-provider";
import { CREATED_AT } from "./input-safety.helpers";

/** The doc with one empty starter paragraph (the trigger's block). */
function seedDoc() {
  const doc = createDoc({ id: "view-popovers-doc", createdAt: CREATED_AT });
  const block = doc.insertBlock("paragraph");
  return { doc, block };
}

/** Render the editor over the page view; the returned `rerender` flips the view. */
function renderEditor(doc: ReturnType<typeof seedDoc>["doc"]) {
  const ui = (view: "page" | "canvas") => (
    <EditorProvider doc={doc}>
      <Editor view={view} />
    </EditorProvider>
  );
  const view = render(ui("page"));
  return { rerender: (next: "page" | "canvas") => view.rerender(ui(next)) };
}

/** Press "/" with a collapsed caret at the block inner's start (the trigger's stand). */
function pressSlash(blockId: string): void {
  const inner = document.querySelector<HTMLElement>(
    `[data-block-id="${blockId}"][data-slot="docblocks/block-content"]`
  )!;
  const wrapper = inner.closest<HTMLElement>(`[data-block-id="${blockId}"]`)!;
  const range = document.createRange();
  range.setStart(inner, 0);
  range.collapse(true);
  const selection = window.getSelection()!;
  selection.removeAllRanges();
  selection.addRange(range);
  act(() => {
    wrapper.dispatchEvent(new KeyboardEvent("keydown", { key: "/", bubbles: true, cancelable: true }));
  });
}

const slashMenu = () => document.querySelector('[data-slot="docblocks/slash-menu"]');

describe("the view switch closes the page's transient surfaces", () => {
  it("closes the slash menu on the canvas switch (and does not resurrect it on the way back)", () => {
    const { doc, block } = seedDoc();
    const { rerender } = renderEditor(doc);
    pressSlash(block);
    expect(slashMenu(), "the slash menu should stand over the page view").not.toBeNull();

    rerender("canvas");
    expect(slashMenu(), "the canvas view stands no slash menu").toBeNull();

    // The state is dropped, not just hidden: the page view does not bring
    // the stale menu back.
    rerender("page");
    expect(slashMenu(), "the returned page view stands no stale menu").toBeNull();
    // The trigger character stays the doc's text (the close writes nothing).
    expect(doc.getText(block)).toBe("/");
  });
});
