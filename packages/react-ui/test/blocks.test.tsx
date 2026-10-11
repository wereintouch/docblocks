// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { act } from "react";

import { createDoc } from "docblocks-core";
import type { BlockId } from "docblocks-core";

import { Editor } from "../src/Editor";
import { EditorProvider } from "../src/EditorProvider";

const CREATED_AT = "2026-10-10T00:00:00.000Z";
type TestDoc = ReturnType<typeof createDoc>;

/** Seed the doc (optionally with a blob resolver), then render provider + editor. */
function renderDoc(prepare: (doc: TestDoc) => void, options?: { blobResolver?: (key: string) => string }) {
  const doc = createDoc({ id: "doc-1", createdAt: CREATED_AT });
  prepare(doc);
  render(
    <EditorProvider doc={doc} blobResolver={options?.blobResolver}>
      <Editor />
    </EditorProvider>
  );
  return doc;
}

/** Build a 2x2 table with a paragraph in every cell; returns the table id. */
function buildTable(doc: TestDoc): BlockId {
  const tableId = doc.insertBlock("table", { cols: 2 });
  for (let row = 0; row < 2; row++) {
    const rowId = doc.insertBlock("table-row", undefined, { parent: tableId });
    for (let cell = 0; cell < 2; cell++) {
      const cellId = doc.insertBlock("table-cell", undefined, { parent: rowId });
      const p = doc.insertBlock("paragraph", undefined, { parent: cellId });
      doc.insertText(p, 0, `cell ${row}-${cell}`);
    }
  }
  return tableId;
}

afterEach(cleanup);

describe("built-in renderers: table", () => {
  it("renders a 2x2 table with the cell texts in editable paragraphs", () => {
    let tableId = "";
    const doc = renderDoc((d) => {
      tableId = buildTable(d);
    });

    const table = document.querySelector<HTMLElement>("table[data-block-type='table']");
    expect(table).not.toBeNull();
    expect(table!.querySelectorAll("tr").length).toBe(2);
    expect(table!.querySelectorAll("td").length).toBe(4);
    expect(screen.getByText("cell 0-1").closest("td")).not.toBeNull();
    // Every cell paragraph is a contenteditable paragraph (the TextBlock path).
    expect(table!.querySelectorAll("td [contenteditable='true'][data-block-type='paragraph']").length).toBe(4);

    // Editing a cell paragraph commits to that cell's paragraph.
    const cellIds = doc.getChildren(doc.getChildren(tableId)[0]!);
    const paragraphIds = doc.getChildren(cellIds[0]!);
    act(() => {
      doc.insertText(paragraphIds[0]!, 0, "x");
    });
    expect(screen.getByText("xcell 0-0")).toBeDefined();
  });
});

describe("built-in renderers: image", () => {
  it("resolves the src through the blob resolver", () => {
    renderDoc((doc) => doc.insertBlock("image", { src: "key-1" }), {
      blobResolver: (key) => `data:image/svg+xml;utf8,${key}`,
    });

    const img = document.querySelector<HTMLImageElement>("img[data-slot='docblocks/image']");
    expect(img).not.toBeNull();
    expect(img!.getAttribute("src")).toBe("data:image/svg+xml;utf8,key-1");
  });

  it("renders the placeholder box without a resolver (no <img> at all)", () => {
    renderDoc((doc) => doc.insertBlock("image", { src: "key-1" }));

    expect(document.querySelector("img")).toBeNull();
    const placeholder = document.querySelector('[data-slot="docblocks/image-placeholder"]');
    expect(placeholder).not.toBeNull();
    expect(placeholder!.getAttribute("data-block-type")).toBe("image");
  });

  it("renders the placeholder box when the resolver returns an empty src", () => {
    renderDoc((doc) => doc.insertBlock("image", { src: "unknown-key" }), { blobResolver: () => "" });

    expect(document.querySelector("img")).toBeNull();
    expect(document.querySelector('[data-slot="docblocks/image-placeholder"]')).not.toBeNull();
  });
});

describe("built-in renderers: code and latex", () => {
  it("renders a code block as a mono <pre> and stays editable", () => {
    let codeId = "";
    const doc = renderDoc((d) => {
      codeId = d.insertBlock("code", { language: "ts" });
      d.insertText(codeId, 0, "const x = 1;");
    });

    const pre = document.querySelector<HTMLElement>("pre[data-block-type='code']");
    expect(pre).not.toBeNull();
    expect(pre!.getAttribute("data-language")).toBe("ts");
    expect(pre!.getAttribute("contenteditable")).toBe("true");
    expect(pre!.textContent).toBe("const x = 1;");

    // Typing commits through the existing input path (DOM text node edited
    // in place, then the input event commits the diff to the doc).
    const textNode = pre!.firstChild!;
    act(() => {
      textNode.nodeValue = "const x = 2;";
      pre!.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(doc.getText(codeId)).toBe("const x = 2;");
  });

  it("renders a latex block as a contenteditable <code> with the tex source", () => {
    renderDoc((d) => {
      const l = d.insertBlock("latex", { display: true });
      d.insertText(l, 0, "e^{i\\pi} + 1");
    });

    const el = document.querySelector<HTMLElement>("code[data-block-type='latex']");
    expect(el).not.toBeNull();
    expect(el!.getAttribute("data-display")).toBe("true");
    expect(el!.getAttribute("contenteditable")).toBe("true");
    expect(el!.textContent).toBe("e^{i\\pi} + 1");
  });

  it("renders a divider as a styled <hr>", () => {
    renderDoc((doc) => doc.insertBlock("divider"));
    const hr = document.querySelector('hr[data-slot="docblocks/divider"]');
    expect(hr).not.toBeNull();
    expect(hr!.getAttribute("data-block-type")).toBe("divider");
  });
});
