// @vitest-environment jsdom
// The cell's paste (the plain-only payload's degrade) + the slash Table
// command (the insert after the caret block).
import { act, fireEvent, render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { createDoc } from "docblocks-core";

import { Editor } from "../src/Editor";
import { EditorProvider } from "../src/editor-provider";
import {
  CREATED_AT,
  activationOf,
  caretAt,
  cellParagraphOf,
  dispatchPaste,
  innerOf,
  renderTableDoc,
} from "./table-cell.helpers";

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
    const tableTable = tableBlock as { columnOrder?: string[]; attrs?: { columnWidths?: number[] } };
    expect(tableTable.columnOrder).toHaveLength(2);
    expect(tableTable.attrs?.columnWidths).toEqual([100, 100]);
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
