// @vitest-environment jsdom
// The callout's block menu (the clickable marker-zone icon): the type
// preset (one transact), the background's swatches + the custom picker,
// and the icon catalog commit one updateBlock each (one undo step, one
// wire update). The menu stands for an empty callout (no text selection
// needed). The read-only stand renders the icon without a button.
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

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

describe("the callout's block menu (the marker-zone icon's button)", () => {
  it("stands the icon button, and the toolbar's callout range keeps no callout controls", () => {
    let co: BlockId = "";
    renderDoc((d) => {
      co = d.insertBlock("callout", { variant: "info" });
      d.insertText(co, 0, "note");
    });
    expect(iconButtonOf()).not.toBeNull();
    // The text range's toolbar stands the shared marks only: the callout
    // menu's trigger and the list-type menu are both absent.
    selectRange(co, 0, 4);
    const toolbar = toolbarOf();
    expect(toolbar.querySelector('[data-mark="bold"]')).not.toBeNull();
    expect(toolbar.querySelector('button[aria-label="Callout"]')).toBeNull();
    expect(toolbar.querySelector('button[aria-label="List type"]')).toBeNull();
  });

  it("switches the type (the preset: the variant + the overrides reset) in one undo step", () => {
    let co: BlockId = "";
    const doc = renderDoc((d) => {
      co = d.insertBlock("callout", { variant: "info", color: "#ff0000", icon: "star" });
      d.insertText(co, 0, "note");
    });
    pressCalloutControl('[data-callout-type-btn="danger"]');
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
    pressCalloutControl('[data-callout-icon-btn="lightbulb"]');
    expect(calloutAttrsOf(doc, co)).toMatchObject({ variant: "danger", icon: "lightbulb" });
    // The variant stood (the preset identity is kept). The pick's stand:
    // the menu closes (the picker stands no hanging over the apply).
    expect(document.querySelector('[data-slot="docblocks/callout-menu"]')).toBeNull();
  });

  it("the type preset clears the icon override (the variant stands, the override resets)", () => {
    let co: BlockId = "";
    const doc = renderDoc((d) => {
      co = d.insertBlock("callout", { variant: "warning", icon: "star" });
      d.insertText(co, 0, "note");
    });
    // The current variant's re-pick stands the preset's reset (the override
    // clears — the former's "Preset" icon's row's stand).
    pressCalloutControl('[data-callout-type-btn="warning"]');
    expect(calloutAttrsOf(doc, co)).toMatchObject({ variant: "warning", icon: null, color: null });
  });

  it("clears the color override with the none swatch (the variant stands)", () => {
    let co: BlockId = "";
    const doc = renderDoc((d) => {
      co = d.insertBlock("callout", { variant: "info", color: "#ff0000" });
      d.insertText(co, 0, "note");
    });
    pressCalloutControl('[data-slot="docblocks/palette-none"]');
    expect(calloutAttrsOf(doc, co)).toMatchObject({ variant: "info", color: null });
    // The pick's stand: the menu closes over the color's apply.
    expect(document.querySelector('[data-slot="docblocks/callout-menu"]')).toBeNull();
  });

  it("stands no write for a no-op type re-pick (the same variant, no override)", () => {
    let co: BlockId = "";
    const doc = renderDoc((d) => {
      co = d.insertBlock("callout", { variant: "info" });
      d.insertText(co, 0, "note");
    });
    const before = doc.encode();
    pressCalloutControl('[data-callout-type-btn="info"]');
    // A no-op stand writes nothing: the wire bytes are invariant.
    expect(doc.encode()).toStrictEqual(before);
  });

  it("stands for an empty callout (no text, no selection)", () => {
    let co: BlockId = "";
    const doc = renderDoc((d) => {
      co = d.insertBlock("callout", {});
    });
    pressCalloutControl('[data-callout-type-btn="warning"]');
    expect(calloutAttrsOf(doc, co)).toMatchObject({ variant: "warning" });
  });
});

describe("the callout's custom color picker (the custom swatch's inline section)", () => {
  /** Open the menu + the picker's section; returns the picker's element. */
  function openPicker(): HTMLElement {
    act(() => {
      fireEvent.click(iconButtonOf());
    });
    const custom = menuOf().querySelector('[data-slot="docblocks/palette-custom"]');
    expect(custom, "the custom swatch should stand").not.toBeNull();
    act(() => {
      custom!.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });
    const picker = document.querySelector('[data-slot="docblocks/callout-color-picker"]');
    expect(picker, "the picker's section should stand (the menu's stand)").not.toBeNull();
    return picker as HTMLElement;
  }

  it("commits the hex field's valid Enter (one write, the menu's close)", () => {
    let co: BlockId = "";
    const doc = renderDoc((d) => {
      co = d.insertBlock("callout", {});
      d.insertText(co, 0, "note");
    });
    const picker = openPicker();
    const field = picker.querySelector<HTMLInputElement>('input[aria-label="Hex color value"]');
    expect(field, "the hex field should stand").not.toBeNull();
    act(() => {
      fireEvent.change(field!, { target: { value: "#1A2B3C" } });
      fireEvent.keyDown(field!, { key: "Enter" });
    });
    expect(calloutAttrsOf(doc, co)?.color).toBe("#1a2b3c");
    // The apply stands the menu's close.
    expect(document.querySelector('[data-slot="docblocks/callout-menu"]')).toBeNull();
  });

  it("commits the native dialog's change (the write + the menu's close)", () => {
    let co: BlockId = "";
    const doc = renderDoc((d) => {
      co = d.insertBlock("callout", {});
      d.insertText(co, 0, "note");
    });
    const picker = openPicker();
    const native = picker.querySelector<HTMLInputElement>('input[aria-label="Color picker"]');
    expect(native, "the native's input should stand").not.toBeNull();
    act(() => {
      fireEvent.change(native!, { target: { value: "#336699" } });
    });
    expect(calloutAttrsOf(doc, co)?.color).toBe("#336699");
    expect(document.querySelector('[data-slot="docblocks/callout-menu"]')).toBeNull();
  });

  it("commits the scrubbed value over the close without a commit (the grid shows the new current)", () => {
    let co: BlockId = "";
    const doc = renderDoc((d) => {
      co = d.insertBlock("callout", {});
      d.insertText(co, 0, "note");
    });
    const picker = openPicker();
    const native = picker.querySelector<HTMLInputElement>('input[aria-label="Color picker"]');
    expect(native, "the native's input should stand").not.toBeNull();
    // The live scrub updates the draft only (no write over the scrub).
    act(() => {
      fireEvent.input(native!, { target: { value: "#336699" } });
    });
    expect(calloutAttrsOf(doc, co)?.color ?? null).toBe(null);
    // The close without an explicit commit (the Esc) applies the scrubbed
    // value (the write, one undo step).
    act(() => {
      fireEvent.keyDown(picker, { key: "Escape" });
    });
    expect(calloutAttrsOf(doc, co)?.color).toBe("#336699");
    expect(document.querySelector('[data-slot="docblocks/callout-menu"]')).toBeNull();
  });

  it("writes nothing for the close over the untouched picker (no scrubbed draft)", () => {
    let co: BlockId = "";
    const doc = renderDoc((d) => {
      co = d.insertBlock("callout", {});
      d.insertText(co, 0, "note");
    });
    const picker = openPicker();
    const before = doc.encode();
    // The untouched close (the Esc, no scrub) commits nothing: the wire's
    // bytes are invariant (the draft's neutral default does not write).
    act(() => {
      fireEvent.keyDown(picker, { key: "Escape" });
    });
    expect(doc.encode()).toStrictEqual(before);
    expect(calloutAttrsOf(doc, co)?.color ?? null).toBe(null);
    expect(document.querySelector('[data-slot="docblocks/callout-menu"]')).toBeNull();
  });

  it("commits the scrubbed value over the section's toggle's close (the grid shows the new current)", () => {
    let co: BlockId = "";
    const doc = renderDoc((d) => {
      co = d.insertBlock("callout", {});
      d.insertText(co, 0, "note");
    });
    const picker = openPicker();
    const native = picker.querySelector<HTMLInputElement>('input[aria-label="Color picker"]');
    expect(native, "the native's input should stand").not.toBeNull();
    act(() => {
      fireEvent.input(native!, { target: { value: "#ff5500" } });
    });
    // The toggle's close (the custom swatch's second press): the section's
    // unmount commits the scrubbed value; the menu stays open and the
    // grid's custom swatch carries the non-preset value (the dot).
    const custom = menuOf().querySelector('[data-slot="docblocks/palette-custom"]');
    expect(custom, "the custom swatch should stand").not.toBeNull();
    act(() => {
      custom!.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });
    expect(calloutAttrsOf(doc, co)?.color).toBe("#ff5500");
    expect(document.querySelector('[data-slot="docblocks/callout-color-picker"]')).toBeNull();
    const dot = menuOf().querySelector<HTMLElement>('[data-slot="docblocks/palette-custom-current"]');
    expect(dot, "the custom swatch's dot should be over the non-preset value").not.toBeNull();
    expect(getComputedStyle(dot!).backgroundColor).toBe("rgb(255, 85, 0)");
  });
});

describe("the callout's read-only stand (the icon's button is absent)", () => {
  it("stands the icon without a button over the view's mode (no pointer events)", () => {
    let co: BlockId = "";
    renderDoc((d) => {
      co = d.insertBlock("callout", { variant: "warning", icon: "star" });
      d.insertText(co, 0, "note");
    }, "view");
    expect(document.querySelector('[data-slot="docblocks/callout-icon-button"]')).toBeNull();
    const icon = document.querySelector('[data-slot="docblocks/callout-icon"]');
    expect(icon, "the icon's zone should stand (the stand's render)").not.toBeNull();
    expect((icon as HTMLElement).className).toContain("pointer-events-none");
  });
});
