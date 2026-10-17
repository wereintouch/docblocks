// @vitest-environment jsdom
// The cell-level editing (the table-cell context): the empty-cell
// activation layer (the view-local caret, the first input materializes the
// paragraph), the cell gestures (Enter = the soft break only, Backspace at
// the line start a no-op), the cell chrome suppression (no placeholder, no
// gutter), the plain-only paste, and the slash Table command (the insert
// after the caret block).
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { createDoc } from "docblocks-core";
import type { BlockId } from "docblocks-core";

import { Editor } from "../src/Editor";
import { EditorProvider, useEditorContext } from "../src/EditorProvider";
import type { EditorContextValue } from "../src/EditorProvider";
import { mapDomSelection } from "../src/editing/selection-mapping";

const CREATED_AT = "2026-10-10T00:00:00.000Z";

// Captures the provider context at render time (the selection handle is a
// stable ref object — `.view` read later is the live event-time value).
let editorContext: EditorContextValue | null = null;
function ContextCapture() {
  editorContext = useEditorContext();
  return null;
}

/**
 * A 2x2 table (the default width, no columnWidths yet) as the next block
 * after the seeded page paragraph; `fillFirst` adds a paragraph to the
 * first cell. Captures the table / row / cell ids.
 */
function renderTableDoc(fillFirst = false) {
  let firstCellId = "";
  const doc = createDoc({ id: "doc-tbl", createdAt: CREATED_AT });
  const pageId = doc.insertBlock("paragraph");
  doc.insertText(pageId, 0, "before");
  const tableId = doc.insertBlock("table", { cols: 2 });
  const rowIds: BlockId[] = [];
  for (let r = 0; r < 2; r++) {
    const rowId = doc.insertBlock("table-row", undefined, { parent: tableId });
    rowIds.push(rowId);
    for (let c = 0; c < 2; c++) {
      const cellId = doc.insertBlock("table-cell", undefined, { parent: rowId });
      if (r === 0 && c === 0) firstCellId = cellId;
    }
  }
  if (fillFirst) {
    const paragraphId = doc.insertBlock("paragraph", undefined, { parent: firstCellId });
    doc.insertText(paragraphId, 0, "cell text");
  }
  render(
    <EditorProvider doc={doc}>
      <Editor />
      <ContextCapture />
    </EditorProvider>
  );
  return { doc, tableId, pageId, firstCellId, rowIds };
}

/** The cell's activation layer (the empty cell's local editable). */
function activationOf(cellId: BlockId): HTMLElement {
  const el = document.querySelector<HTMLElement>(
    `[data-slot="docblocks/table-cell"][data-block-id="${cellId}"] [data-slot="docblocks/cell-activation"]`
  );
  expect(el, "the empty cell should render the activation layer").not.toBeNull();
  return el!;
}

/** The cell's first child paragraph wrapper (after the activation materialized). */
function cellParagraphOf(cellId: BlockId): HTMLElement {
  const el = document.querySelector<HTMLElement>(
    `[data-slot="docblocks/table-cell"][data-block-id="${cellId}"] [data-slot="docblocks/block"][data-block-type="paragraph"]`
  );
  expect(el, "the cell should render the materialized paragraph").not.toBeNull();
  return el!;
}

/** The inner editable of a block wrapper (the contenteditable element). */
function innerOf(wrapper: HTMLElement): HTMLElement {
  const inner = wrapper.querySelector<HTMLElement>('[data-slot="docblocks/block-content"]');
  expect(inner, "the wrapper should carry the inner editable").not.toBeNull();
  return inner!;
}

/** Place the DOM caret at `offset` of the inner editable's first text node. */
function caretAt(el: HTMLElement, offset: number): void {
  const textNode = Array.from(el.childNodes).find((node) => node.nodeType === Node.TEXT_NODE);
  expect(textNode, "the inner editable should have a text node").not.toBeNull();
  const range = document.createRange();
  range.setStart(textNode!, offset);
  range.collapse(true);
  const selection = window.getSelection();
  expect(selection).not.toBeNull();
  selection!.removeAllRanges();
  selection!.addRange(range);
}

/** Dispatch a paste event whose clipboard holds the given plain text (and optionally the html). */
function dispatchPaste(el: HTMLElement, plainText: string, htmlText = ""): boolean {
  const event = new Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clipboardData", {
    value: { getData: (format: string) => (format === "text/plain" ? plainText : htmlText) },
  });
  return el.dispatchEvent(event);
}

afterEach(() => {
  cleanup();
  window.getSelection()?.removeAllRanges();
});

describe("the empty-cell activation layer", () => {
  it("stands in every empty cell and only there", () => {
    const { tableId, firstCellId } = renderTableDoc(true);
    const table = document.querySelector<HTMLElement>(`[data-block-id="${tableId}"]`);
    expect(table).not.toBeNull();
    expect(table!.querySelectorAll("tr").length).toBe(2);
    expect(table!.querySelectorAll("td").length).toBe(4);
    // The first cell holds a paragraph (no activation); the other three
    // stand the activation layer (no block-content yet).
    expect(
      table!.querySelector(
        `[data-slot="docblocks/table-cell"][data-block-id="${firstCellId}"] [data-slot="docblocks/cell-activation"]`
      )
    ).toBeNull();
    expect(table!.querySelectorAll("[data-slot='docblocks/cell-activation']").length).toBe(3);
    expect(table!.querySelectorAll("[data-slot='docblocks/block-content']").length).toBe(1);
  });

  it("the first input materializes the paragraph with the typed text (one undo step)", () => {
    const { doc, firstCellId } = renderTableDoc(false);
    expect(doc.getChildren(firstCellId)).toEqual([]);
    const activation = activationOf(firstCellId);

    act(() => {
      activation.focus();
      activation.textContent = "typed";
      fireEvent.input(activation);
    });

    // One paragraph child with the typed text.
    const children = doc.getChildren(firstCellId);
    expect(children).toHaveLength(1);
    expect(doc.getTextLength(children[0]!)).toBe(5);
    expect(doc.getText(children[0]!)).toBe("typed");
    // The real paragraph replaces the layer in the DOM.
    expect(activation.isConnected).toBe(false);
    const paragraph = cellParagraphOf(firstCellId);
    expect(innerOf(paragraph).textContent).toBe("typed");
    // One undo step: the whole materialize (the block + the text) rolls
    // back to the empty cell.
    doc.undo();
    expect(doc.getChildren(firstCellId)).toEqual([]);
  });

  it("keeps no data while it stands: focusing and moving the caret writes nothing", () => {
    const { doc, firstCellId } = renderTableDoc(false);
    const before = Object.keys(doc.toJSON().blocks).length;
    const activation = activationOf(firstCellId);
    act(() => {
      activation.focus();
    });
    // The doc is untouched: the cell holds no blocks, no new block stands.
    expect(doc.getChildren(firstCellId)).toEqual([]);
    expect(Object.keys(doc.toJSON().blocks).length).toBe(before);
  });

  it("Enter on the empty layer is a no-op (the cell stays empty)", () => {
    const { doc, firstCellId } = renderTableDoc(false);
    const activation = activationOf(firstCellId);
    act(() => {
      activation.focus();
    });
    act(() => {
      activation.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    });
    // The cell holds no blocks and the layer stands without a line break.
    expect(doc.getChildren(firstCellId)).toEqual([]);
    expect(activation.querySelectorAll("br, div").length).toBe(0);
  });

  it("merges into a concurrently arrived paragraph (the empty paragraphs do not multiply)", () => {
    const { doc, firstCellId } = renderTableDoc(false);
    const activation = activationOf(firstCellId);
    act(() => {
      activation.focus();
      // A peer activates the same cell before this client's input commits:
      // the paragraph stands in the doc while the layer is still mounted.
      const peerId = doc.insertBlock("paragraph", undefined, { parent: firstCellId });
      doc.insertText(peerId, 0, "peer");
      activation.textContent = "after";
      fireEvent.input(activation);
    });
    // The input landed in the arrived paragraph (no second one).
    const children = doc.getChildren(firstCellId);
    expect(children).toHaveLength(1);
    expect(doc.getText(children[0]!)).toBe("peerafter");
  });

  it("the layer's caret maps to no doc selection: Backspace and Delete write nothing", () => {
    const { doc, tableId, firstCellId } = renderTableDoc(false);
    const before = Object.keys(doc.toJSON().blocks).length;
    const activation = activationOf(firstCellId);
    act(() => {
      activation.focus();
    });
    // The DOM caret stands in the layer (the browser seats it there on the
    // focus of an empty editable).
    const range = document.createRange();
    range.selectNodeContents(activation);
    range.collapse(true);
    const domSelection = window.getSelection();
    expect(domSelection).not.toBeNull();
    domSelection!.removeAllRanges();
    domSelection!.addRange(range);
    // The mapping yields `none` (a `blocks` selection would flag the table
    // row as selected and hand it to the delete gesture).
    const root = document.querySelector<HTMLElement>('[data-slot="docblocks/editor"]');
    expect(root).not.toBeNull();
    expect(mapDomSelection(root!, window.getSelection()!, doc)).toEqual({ kind: "none" });
    const selectionView = editorContext?.selection.view;
    expect(selectionView?.get().kind).toBe("none");
    // Backspace and Delete in the layer are no-ops (the doc is untouched).
    act(() => {
      activation.dispatchEvent(new KeyboardEvent("keydown", { key: "Backspace", bubbles: true, cancelable: true }));
    });
    act(() => {
      activation.dispatchEvent(new KeyboardEvent("keydown", { key: "Delete", bubbles: true, cancelable: true }));
    });
    expect(Object.keys(doc.toJSON().blocks).length).toBe(before);
    expect(doc.getBlock(tableId)?.type).toBe("table");
    expect(doc.getChildren(firstCellId)).toEqual([]);
  });
});

describe("the cell chrome", () => {
  it("the cell paragraph stands without the slash hint and the row grip", () => {
    const { doc, pageId, firstCellId } = renderTableDoc(true);
    const cellParagraphId = doc.getChildren(firstCellId)[0]!;
    const cellInner = document.querySelector<HTMLElement>(
      `[data-block-id="${cellParagraphId}"][data-slot="docblocks/block-content"]`
    );
    expect(cellInner, "the cell paragraph inner should be rendered").not.toBeNull();
    expect(cellInner!.dataset.placeholder, "no slash hint in a cell").toBeUndefined();
    expect(
      cellInner!.closest("[data-slot='docblocks/block']")!.querySelector("[data-slot='docblocks/gutter']"),
      "no grip in a cell"
    ).toBeNull();
    // The page paragraph keeps both (the context is cell-only).
    const pageInner = document.querySelector<HTMLElement>(
      `[data-block-id="${pageId}"][data-slot="docblocks/block-content"]`
    );
    expect(pageInner!.dataset.placeholder).toBe("Type '/' for commands");
    expect(
      pageInner!.closest("[data-slot='docblocks/block']")!.querySelector("[data-slot='docblocks/gutter']")
    ).not.toBeNull();
  });
});

describe("the cell keyboard gestures", () => {
  it("Enter is a soft line break at every position (no split, no exit)", () => {
    const { doc, firstCellId } = renderTableDoc(true);
    const paragraphId = doc.getChildren(firstCellId)[0]!;
    const wrapper = cellParagraphOf(firstCellId);
    const inner = innerOf(wrapper);
    caretAt(inner, 5);

    act(() => {
      wrapper.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    });

    // One `\n` at the caret; the cell still holds a single paragraph.
    expect(doc.getChildren(firstCellId)).toHaveLength(1);
    expect(doc.getText(paragraphId)).toBe("cell \ntext");
    expect(inner.querySelectorAll("br, div").length).toBe(0);
  });

  it("Backspace at the line start is a no-op (no merge with the previous paragraph)", () => {
    const { doc, firstCellId } = renderTableDoc(true);
    let secondParagraph = "";
    act(() => {
      secondParagraph = doc.insertBlock("paragraph", undefined, { parent: firstCellId });
      doc.insertText(secondParagraph, 0, "second line");
    });
    // The store projects the new child (the provider's doc subscription),
    // so the second paragraph stands in the DOM after the act flush.
    const cell = document.querySelector<HTMLElement>(
      `[data-slot="docblocks/table-cell"][data-block-id="${firstCellId}"]`
    );
    const inner = cell!.querySelector<HTMLElement>(
      `[data-block-id="${secondParagraph}"] [data-slot="docblocks/block-content"]`
    );
    expect(inner, "the second paragraph should render").not.toBeNull();
    const secondInner = inner!;
    caretAt(secondInner, 0);

    act(() => {
      secondInner.dispatchEvent(new KeyboardEvent("keydown", { key: "Backspace", bubbles: true, cancelable: true }));
    });

    // Nothing was removed: both paragraphs stand, the caret's text intact.
    expect(doc.getChildren(firstCellId)).toHaveLength(2);
    expect(doc.getText(secondParagraph)).toBe("second line");
  });
});

describe("the cell paste (plain only)", () => {
  it("a markdown payload degrades to one plain paragraph with soft breaks", () => {
    const { doc, firstCellId } = renderTableDoc(true);
    const paragraphId = doc.getChildren(firstCellId)[0]!;
    const wrapper = cellParagraphOf(firstCellId);
    const inner = innerOf(wrapper);
    caretAt(inner, 9);

    const markdown = "| a | b |\n| --- | --- |\n| 1 | 2 |\n\n# heading\n- item";
    act(() => {
      dispatchPaste(inner, markdown);
    });

    // One paragraph (no table, no heading, no list-item): the whole
    // payload as plain text with the line breaks.
    const children = doc.getChildren(firstCellId);
    expect(children).toHaveLength(1);
    expect(doc.getText(paragraphId)).toBe("cell text| a | b |\n| --- | --- |\n| 1 | 2 |\n\n# heading\n- item");
  });

  it("an html-only payload degrades to its text (the marks are dropped)", () => {
    const { doc, firstCellId } = renderTableDoc(false);
    const activation = activationOf(firstCellId);
    act(() => {
      activation.focus();
      dispatchPaste(activation, "", "<p>hello <b>bold</b></p>");
    });
    const children = doc.getChildren(firstCellId);
    expect(children).toHaveLength(1);
    expect(doc.getText(children[0]!)).toBe("hello bold");
  });

  it("a cell paragraph keeps the plain payload over the rich one (the marks are dropped)", () => {
    const { doc, firstCellId } = renderTableDoc(true);
    const paragraphId = doc.getChildren(firstCellId)[0]!;
    const wrapper = cellParagraphOf(firstCellId);
    const inner = innerOf(wrapper);
    caretAt(inner, 9);

    // Both payloads present: the plain stands, the html's marks are dropped.
    act(() => {
      dispatchPaste(inner, "plain text", "<p>rich <b>bold</b></p>");
    });
    expect(doc.getChildren(firstCellId)).toHaveLength(1);
    expect(doc.getText(paragraphId)).toBe("cell textplain text");

    // An html-only payload degrades to its text (no rich runs, no marks).
    act(() => {
      dispatchPaste(inner, "", "<b>bold again</b>");
    });
    expect(doc.getText(paragraphId)).toBe("cell textplain textbold again");
    // No mark was applied by either paste.
    const block = doc.getBlock(paragraphId);
    expect(block !== null && "content" in block).toBe(true);
    if (block !== null && "content" in block) {
      expect(block.content?.every((run) => Object.keys(run.marks).length === 0)).toBe(true);
    }
  });

  it("a plain multi-line paste stands as soft breaks in the empty cell", () => {
    const { doc, firstCellId } = renderTableDoc(false);
    const activation = activationOf(firstCellId);
    act(() => {
      activation.focus();
      dispatchPaste(activation, "line one\nline two");
    });
    const children = doc.getChildren(firstCellId);
    expect(children).toHaveLength(1);
    expect(doc.getText(children[0]!)).toBe("line one\nline two");
  });
});

describe("the slash Table command", () => {
  it("inserts a 2x2 table after the caret block and strips the trigger phrase", () => {
    const doc = createDoc({ id: "doc-slash-tbl", createdAt: CREATED_AT });
    const pageId = doc.insertBlock("paragraph");
    doc.insertText(pageId, 0, "keep");
    render(
      <EditorProvider doc={doc}>
        <Editor />
      </EditorProvider>
    );

    const wrapper = document.querySelector<HTMLElement>(`[data-block-id="${pageId}"]`)!;
    const inner = wrapper.querySelector<HTMLElement>('[data-slot="docblocks/block-content"]')!;
    // The caret at the block's end ("keep|" — the "/" lands at the end).
    caretAt(inner, 4);

    // The "/" keypress opens the menu (the trigger is committed in the
    // text; the menu stands with the empty query's full list).
    act(() => {
      wrapper.dispatchEvent(new KeyboardEvent("keydown", { key: "/", bubbles: true, cancelable: true }));
    });
    const menu = document.querySelector<HTMLElement>('[data-slot="docblocks/slash-menu"]');
    expect(menu, "the slash menu should stand open").not.toBeNull();

    // The "Table" item stands in the list.
    const items = Array.from(document.querySelectorAll<HTMLElement>('[data-slot="docblocks/slash-item"]'));
    const tableItem = items.find((item) => item.textContent === "Table");
    expect(tableItem, "the Table item should be offered").toBeDefined();

    act(() => {
      fireEvent.click(tableItem!);
    });

    // The caret block stands (not converted): the trigger phrase is
    // stripped, the prefix survives.
    expect(doc.getBlock(pageId)?.type).toBe("paragraph");
    expect(doc.getText(pageId)).toBe("keep");
    // The table landed after the caret block with the default shape.
    const tableBlockId = Object.keys(doc.toJSON().blocks).find((key) => doc.getBlock(key)?.type === "table");
    expect(tableBlockId, "the table should be inserted").toBeDefined();
    const tableBlock = doc.getBlock(tableBlockId!);
    const tableAttrs = (tableBlock as { attrs?: { cols?: number; columnWidths?: number[] } }).attrs;
    expect(tableAttrs?.cols).toBe(2);
    expect(tableAttrs?.columnWidths).toEqual([100, 100]);
    const rows = doc.getChildren(tableBlockId!);
    expect(rows).toHaveLength(2);
    for (const rowId of rows) {
      const cells = doc.getChildren(rowId);
      expect(cells).toHaveLength(2);
      for (const cellId of cells) {
        expect(doc.getChildren(cellId), "every cell stands empty (the activation layer)").toEqual([]);
      }
    }
    // The table renders with the activation layers in every cell.
    expect(document.querySelectorAll("[data-slot='docblocks/cell-activation']").length).toBe(4);
    // One undo step: the whole apply (the phrase deletion + the table with
    // its rows and cells) rolls back — the trigger phrase stands, the
    // table is gone.
    doc.undo();
    expect(doc.getText(pageId)).toBe("keep/");
    expect(Object.keys(doc.toJSON().blocks).filter((key) => doc.getBlock(key)?.type === "table")).toHaveLength(0);
  });
});
