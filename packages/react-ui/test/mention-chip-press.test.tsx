// @vitest-environment jsdom
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { act } from "react";

import { createDoc } from "docblocks-core";

import { Editor } from "../src/Editor";
import { EditorProvider } from "../src/editor-provider";
import { CHIP_SELECTOR, EDITOR_ROOT, renderMentionChip } from "./mention-harness";

const CREATED_AT = "2026-10-10T00:00:00.000Z";

describe("the chip's press (the cross drag's island guard)", () => {
  afterEach(cleanup);

  it("starts no caret session over the chip (no seat, no focus)", () => {
    // The chip is a non-editable island inside the text inner: the press
    // belongs to the chip's own interactions, so the editor's cross-drag
    // session must not start (its release seats the caret on the chip's
    // line and pulls the scroll port there).
    const { blockId } = renderMentionChip();
    const chip = document.querySelector<HTMLElement>(CHIP_SELECTOR)!;
    const inner = document.querySelector<HTMLElement>(
      `[data-block-id="${blockId}"][data-slot="docblocks/block-content"]`
    )!;
    const pointer = { bubbles: true, cancelable: true, pointerType: "mouse", button: 0, pointerId: 7 };
    fireEvent.pointerDown(chip, { ...pointer, clientX: 10, clientY: 10 });
    fireEvent.pointerUp(window, { ...pointer, clientX: 12, clientY: 11 });
    // The session would have seated a DOM selection and focused the inner
    // over its release; neither stands.
    expect(window.getSelection()?.rangeCount ?? 0).toBe(0);
    expect(document.activeElement).not.toBe(inner);
  });

  it("suppresses the island press's mousedown default and plants no focus", () => {
    // The chip's own surface: the mousedown's default (the browser's
    // focus's move over the shared page editable + the scroll's pull to
    // the press's point) stands suppressed, and no focus stands planted
    // over the press — the island owns it (its own click's handlers run
    // over the press's point; a planted focus would scroll the port over
    // the press and steal the click from the island's handlers).
    renderMentionChip();
    const chip = document.querySelector<HTMLElement>(CHIP_SELECTOR)!;
    const root = document.querySelector<HTMLElement>(EDITOR_ROOT)!;
    const page = document.querySelector<HTMLElement>('[data-slot="docblocks/page"]')!;

    const event = new MouseEvent("mousedown", { button: 0, bubbles: true, cancelable: true });
    act(() => {
      chip.dispatchEvent(event);
    });

    expect(event.defaultPrevented).toBe(true);
    expect(document.activeElement).not.toBe(root);
    expect(document.activeElement).not.toBe(page);
    expect(document.activeElement).toBe(document.body);
  });

  it("keeps the default over the island's own editable (the cell's inner)", () => {
    // The self-contained editable inside the island (the table's cell's
    // inner): the native editing's default stands (the caret's seat, the
    // word/line's select over it) — the guard's suppression stands no
    // stand over it.
    const doc = createDoc({ id: "doc-3", createdAt: CREATED_AT });
    const tableId = doc.insertBlock("table", { cols: 2 });
    const rowId = doc.insertBlock("table-row", undefined, { parent: tableId });
    const cellId = doc.insertBlock("table-cell", undefined, { parent: rowId });
    doc.insertBlock("table-cell", undefined, { parent: rowId });
    doc.insertText(cellId, 0, "cell");
    render(
      <EditorProvider doc={doc}>
        <Editor />
      </EditorProvider>
    );
    const inner = document.querySelector<HTMLElement>(
      `td[data-block-id="${cellId}"] [data-slot="docblocks/block-content"]`
    );
    expect(inner, "the cell's own content layer should render").not.toBeNull();
    // The island's boundary stands over the cell (the scroll's chrome).
    expect(inner!.closest('[contenteditable="false"]')).not.toBeNull();

    const event = new MouseEvent("mousedown", { button: 0, bubbles: true, cancelable: true });
    act(() => {
      inner!.dispatchEvent(event);
    });
    expect(event.defaultPrevented).toBe(false);
  });
});
