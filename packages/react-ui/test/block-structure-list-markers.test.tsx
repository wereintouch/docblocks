// @vitest-environment jsdom
// The per-level's list's marker (the rendered's row's marker's cycle):
// the nested's level's index's cycle, the number's kind's stand, the
// table's cell's fresh depth-1's context, and the task's checkbox's
// marker slot's ownership.
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { createDoc } from "docblocks-core";

import { Editor } from "../src/Editor";
import { EditorProvider } from "../src/editor-provider";
import { CREATED_AT, renderDoc } from "./block-structure.helpers";
import type { TestDoc } from "./block-structure.helpers";

describe("per-level list markers (the rendered row marker's cycle)", () => {
  /** The cycle index of every flat list row's marker, in DOM order. */
  function listDepths(): string[] {
    return Array.from(document.querySelectorAll<HTMLElement>("[data-slot='docblocks/row-marker']")).map(
      (el) => el.getAttribute("data-cycle") ?? ""
    );
  }

  /** A chain of `levels` nested list items of one kind (deepest last; the flat model: the level IS the indent). */
  function seedChain(d: TestDoc, list: "bullet" | "number", levels: number): void {
    for (let level = 0; level < levels; level++) {
      const id = d.insertBlock("list-item", { list, indent: level });
      d.insertText(id, 0, `level ${level + 1}`);
    }
  }

  it("a 3-level nested bullet carries the cycle indices 1, 2, 3", () => {
    renderDoc((d) => seedChain(d, "bullet", 3));
    expect(listDepths()).toEqual(["1", "2", "3"]);
  });

  it("a 4-level nested bullet cycles back to 1", () => {
    renderDoc((d) => seedChain(d, "bullet", 4));
    expect(listDepths()).toEqual(["1", "2", "3", "1"]);
  });

  it("a 2-level nested number list carries the cycle indices 1, 2", () => {
    renderDoc((d) => seedChain(d, "number", 2));
    expect(listDepths()).toEqual(["1", "2"]);
    // The flat stand: the number's markers stand the kind (no list
    // element — the row's marker label renders the number).
    const kinds = Array.from(document.querySelectorAll<HTMLElement>("[data-slot='docblocks/row-marker']")).map((el) =>
      el.getAttribute("data-kind")
    );
    expect(kinds).toEqual(["number", "number"]);
  });

  it("a top-level list inside a table cell starts a fresh depth-1 context", () => {
    // A list item is not cell-eligible (the cell holds the leaf set), so the
    // list arrives as the embedded doc's top level inside the cell.
    const master = createDoc({ id: "master-1", createdAt: CREATED_AT });
    const item = master.insertBlock("list-item", { list: "bullet" });
    master.insertText(item, 0, "in the cell");
    const doc = createDoc({ id: "doc-1", createdAt: CREATED_AT });
    const table = doc.insertBlock("table", { cols: 1 });
    const row = doc.insertBlock("table-row", undefined, { parent: table });
    const cell = doc.insertBlock("table-cell", undefined, { parent: row });
    doc.insertBlock("sync-embed", { ref: { docId: "master-1" } }, { parent: cell });
    render(
      <EditorProvider doc={doc} syncEmbedResolver={(ref) => (ref.docId === "master-1" ? master : null)}>
        <Editor />
      </EditorProvider>
    );
    const cellEl = document.querySelector<HTMLElement>("[data-slot='docblocks/table-cell']");
    expect(cellEl, "the cell should be rendered").not.toBeNull();
    // The embedded editor's flat stand: the list item's row marker stands
    // inside the cell (the fresh depth-1 context).
    const marker = cellEl!.querySelector("[data-slot='docblocks/row-marker']");
    expect(marker, "the embedded list's marker should stand inside the cell").not.toBeNull();
    expect(marker!.getAttribute("data-cycle")).toBe("1");
  });

  it("the task list is untouched (the checkbox owns the marker slot)", () => {
    renderDoc((d) => {
      const id = d.insertBlock("list-item", { list: "task" });
      d.insertText(id, 0, "a task");
    });
    const wrapper = document.querySelector<HTMLElement>("[data-slot='docblocks/list-item']");
    expect(wrapper).not.toBeNull();
    expect(wrapper!.getAttribute("data-list")).toBe("task");
    expect(wrapper!.querySelector('[data-slot="docblocks/checkbox"]')).not.toBeNull();
    // The checkbox owns the marker slot: no rendered marker over a task
    // row.
    expect(wrapper!.querySelector('[data-slot="docblocks/row-marker"]')).toBeNull();
  });
});
