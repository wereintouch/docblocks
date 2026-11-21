// The callout's block menu's split set's shared stand: the doc's render
// (the view's mode's optional), the block's inner + the text node's reads,
// the callout's attrs' read, the range's selection + the view's sync, the
// toolbar / the icon button / the menu's reads, and the menu's control's
// press (the popover's click's open + the control's dispatch).
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, expect } from "vitest";

import { createDoc } from "docblocks-core";
import type { BlockId } from "docblocks-core";

import { Editor } from "../src/Editor";
import { EditorProvider } from "../src/editor-provider";

const CREATED_AT = "2026-10-10T00:00:00.000Z";
type TestDoc = ReturnType<typeof createDoc>;

function renderDoc(prepare: (doc: TestDoc) => void, mode?: "view"): TestDoc {
  const doc = createDoc({ id: "doc-1", createdAt: CREATED_AT });
  prepare(doc);
  render(
    <EditorProvider doc={doc} mode={mode}>
      <Editor />
    </EditorProvider>
  );
  return doc;
}

/** The block's inner editable + its text node (the callout carries a run). */
function innerOf(id: BlockId): HTMLElement {
  const el = document.querySelector<HTMLElement>(`[data-block-id="${id}"][data-slot="docblocks/block-content"]`);
  expect(el).not.toBeNull();
  return el!;
}
function textNodeOf(id: BlockId): Text {
  const node = innerOf(id).firstChild;
  expect(node).not.toBeNull();
  return node as Text;
}

/** The callout block's attrs (narrowed to the callout shape; null when absent). */
function calloutAttrsOf(
  doc: TestDoc,
  id: BlockId
): { variant?: string; color?: string | null; icon?: string | null } | undefined {
  const block = doc.getBlock(id);
  if (block === null || block.type !== "callout") return undefined;
  return block.attrs;
}

/** Select [from, to) and sync the view selection (the toolbar re-renders in act). */
function selectRange(id: BlockId, from: number, to: number): void {
  const range = document.createRange();
  range.setStart(textNodeOf(id), from);
  range.setEnd(textNodeOf(id), to);
  const selection = window.getSelection()!;
  selection.removeAllRanges();
  selection.addRange(range);
  act(() => {
    document.dispatchEvent(new Event("selectionchange"));
  });
}

function toolbarOf(): HTMLElement {
  const el = document.querySelector('[data-slot="docblocks/format-toolbar"]');
  expect(el, "the toolbar should be visible for the selected callout range").not.toBeNull();
  return el as HTMLElement;
}

function iconButtonOf(): HTMLElement {
  const el = document.querySelector('[data-slot="docblocks/callout-icon-button"]');
  expect(el, "the callout's icon button should be present").not.toBeNull();
  return el as HTMLElement;
}

function menuOf(): HTMLElement {
  const el = document.querySelector('[data-slot="docblocks/callout-menu"]');
  expect(el, "the callout's menu should be open").not.toBeNull();
  return el as HTMLElement;
}

/**
 * Open the block menu (a click — the radix Popover trigger activates on
 * click, not pointerdown) and press a control inside it. No text
 * selection stands for the gesture (the menu manages the block's attrs).
 */
function pressCalloutControl(selector: string): void {
  act(() => {
    fireEvent.click(iconButtonOf());
  });
  const control = menuOf().querySelector(selector);
  expect(control, `the ${selector} control should be present`).not.toBeNull();
  act(() => {
    (control as HTMLElement).dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });
}

afterEach(() => {
  cleanup();
  window.getSelection()?.removeAllRanges();
});

export { calloutAttrsOf, iconButtonOf, menuOf, pressCalloutControl, renderDoc, selectRange, toolbarOf };
