// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { createDoc } from "docblocks-core";
import type { BlockId } from "docblocks-core";

import { Editor } from "../src/Editor";
import { EditorProvider } from "../src/editor-provider";

const CREATED_AT = "2026-10-10T00:00:00.000Z";
type TestDoc = ReturnType<typeof createDoc>;

function renderDoc(prepare: (doc: TestDoc) => void): TestDoc {
  const doc = createDoc({ id: "doc-1", createdAt: CREATED_AT });
  prepare(doc);
  render(
    <EditorProvider doc={doc}>
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

/**
 * Open the callout menu (a click — the radix Popover trigger activates on
 * click, not pointerdown) and press a control inside it. The gesture range
 * is re-seated after the open (jsdom's focus() moves the DOM selection with
 * the roving focus, where a browser keeps the editable's selection).
 */
function pressCalloutControl(id: BlockId, from: number, to: number, selector: string): void {
  const trigger = toolbarOf().querySelector('button[aria-label="Callout"]');
  expect(trigger, "the callout menu trigger should be present").not.toBeNull();
  act(() => {
    fireEvent.click(trigger as Element);
  });
  selectRange(id, from, to);
  const menu = document.querySelector('[data-slot="docblocks/format-callout-menu"]');
  expect(menu, "the callout menu should be open").not.toBeNull();
  const control = (menu as HTMLElement).querySelector(selector);
  expect(control, `the ${selector} control should be present`).not.toBeNull();
  act(() => {
    (control as HTMLElement).dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });
}

afterEach(() => {
  cleanup();
  window.getSelection()?.removeAllRanges();
});

describe("the callout menu (the list-type menu's callout target)", () => {
  it("stands for a callout range and not the list-type menu", () => {
    let co: BlockId = "";
    renderDoc((d) => {
      co = d.insertBlock("callout", { variant: "info" });
      d.insertText(co, 0, "note");
    });
    selectRange(co, 0, 4);
    const toolbar = toolbarOf();
    expect(toolbar.querySelector('button[aria-label="Callout"]')).not.toBeNull();
    // The list-type radio menu stands no trigger for a callout.
    expect(toolbar.querySelector('button[aria-label="List type"]')).toBeNull();
  });

  it("switches the type (the preset: the variant + the overrides reset) in one undo step", () => {
    let co: BlockId = "";
    const doc = renderDoc((d) => {
      co = d.insertBlock("callout", { variant: "info", color: "#ff0000", icon: "star" });
      d.insertText(co, 0, "note");
    });
    selectRange(co, 0, 4);
    pressCalloutControl(co, 0, 4, '[data-callout-type-btn="danger"]');
    // The variant stands the new preset; the overrides are reset to null.
    expect(calloutAttrsOf(doc, co)).toMatchObject({ variant: "danger", color: null, icon: null });
    // One undo step for the whole switch (the inverse stands the prior stand
    // back — the overrides and the variant).
    doc.undo();
    expect(calloutAttrsOf(doc, co)).toMatchObject({ variant: "info", color: "#ff0000", icon: "star" });
  });

  it("picks an icon (the override stands, the variant is kept)", () => {
    let co: BlockId = "";
    const doc = renderDoc((d) => {
      co = d.insertBlock("callout", { variant: "danger" });
      d.insertText(co, 0, "note");
    });
    selectRange(co, 0, 4);
    pressCalloutControl(co, 0, 4, '[data-callout-icon-btn="lightbulb"]');
    expect(calloutAttrsOf(doc, co)).toMatchObject({ variant: "danger", icon: "lightbulb" });
    // The variant stood (the preset identity is kept).
    expect(calloutAttrsOf(doc, co)?.variant).toBe("danger");
  });

  it("the icon preset clears the override (icon: null, the variant stands)", () => {
    let co: BlockId = "";
    const doc = renderDoc((d) => {
      co = d.insertBlock("callout", { variant: "warning", icon: "star" });
      d.insertText(co, 0, "note");
    });
    selectRange(co, 0, 4);
    pressCalloutControl(co, 0, 4, "[data-callout-icon-preset]");
    expect(calloutAttrsOf(doc, co)).toMatchObject({ variant: "warning", icon: null });
  });

  it("clears the color override with the none swatch (the variant stands)", () => {
    let co: BlockId = "";
    const doc = renderDoc((d) => {
      co = d.insertBlock("callout", { variant: "info", color: "#ff0000" });
      d.insertText(co, 0, "note");
    });
    selectRange(co, 0, 4);
    pressCalloutControl(co, 0, 4, '[data-slot="docblocks/palette-none"]');
    expect(calloutAttrsOf(doc, co)).toMatchObject({ variant: "info", color: null });
  });

  it("stands no write for a no-op type re-pick (the same variant, no override)", () => {
    let co: BlockId = "";
    const doc = renderDoc((d) => {
      co = d.insertBlock("callout", { variant: "info" });
      d.insertText(co, 0, "note");
    });
    selectRange(co, 0, 4);
    const before = doc.encode();
    pressCalloutControl(co, 0, 4, '[data-callout-type-btn="info"]');
    // A no-op stand writes nothing: the wire bytes are invariant.
    expect(doc.encode()).toStrictEqual(before);
  });
});
