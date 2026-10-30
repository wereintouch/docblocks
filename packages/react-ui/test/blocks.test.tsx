// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { act } from "react";

import { createDoc } from "docblocks-core";
import type { BlockId } from "docblocks-core";

import { Editor } from "../src/Editor";
import type { BlobStore } from "../src/blob-store";
import { applyMdPaste } from "../src/editing/clipboard";
import { EditorProvider } from "../src/editor-provider";

const CREATED_AT = "2026-10-10T00:00:00.000Z";
type TestDoc = ReturnType<typeof createDoc>;

/** Seed the doc (optionally with a blob resolver/store), then render provider + editor. */
function renderDoc(
  prepare: (doc: TestDoc) => void,
  options?: { blobResolver?: (key: string) => string; blobStore?: BlobStore }
) {
  const doc = createDoc({ id: "doc-1", createdAt: CREATED_AT });
  prepare(doc);
  render(
    <EditorProvider doc={doc} blobResolver={options?.blobResolver} blobStore={options?.blobStore}>
      <Editor />
    </EditorProvider>
  );
  return doc;
}

/** Flush the async blob resolve (the promise settles on a microtask). */
async function flushResolve(): Promise<void> {
  await act(async () => {});
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
    // Every cell paragraph is editable (the inner editable of the TextBlock
    // path).
    expect(table!.querySelectorAll("td [data-slot='docblocks/block-content']").length).toBe(4);

    // Editing a cell paragraph commits to that cell's paragraph.
    const cellIds = doc.getChildren(doc.getChildren(tableId)[0]!);
    const paragraphIds = doc.getChildren(cellIds[0]!);
    act(() => {
      doc.insertText(paragraphIds[0]!, 0, "x");
    });
    expect(screen.getByText("xcell 0-0")).toBeDefined();
  });

  it("a pasted markdown table renders the cell texts in editable paragraphs", () => {
    renderDoc((d) => {
      const seat = d.insertBlock("paragraph");
      act(() => {
        applyMdPaste(d, seat, 0, 0, "| a | b |\n| --- | --- |\n| 1 | 2 |");
      });
    });

    const table = document.querySelector<HTMLElement>("table[data-block-type='table']");
    expect(table).not.toBeNull();
    expect(table!.querySelectorAll("tr").length).toBe(2);
    // The cell texts stand in the rendered cells (not in the cell's own
    // content field — the renderer draws the children sequence).
    expect(table!.querySelectorAll("td").length).toBe(4);
    expect(screen.getByText("a").closest("td")).not.toBeNull();
    expect(screen.getByText("2").closest("td")).not.toBeNull();
    // Every cell is editable (the child paragraph's inner stands).
    expect(table!.querySelectorAll("td [data-slot='docblocks/block-content'").length).toBe(4);
  });
});

describe("built-in renderers: image", () => {
  it("resolves the src through the blob resolver (the legacy prop)", async () => {
    renderDoc((doc) => doc.insertBlock("image", { src: "key-1" }), {
      blobResolver: (key) => `data:image/svg+xml;utf8,${key}`,
    });
    await flushResolve();

    const img = document.querySelector<HTMLImageElement>("img[data-slot='docblocks/image']");
    expect(img).not.toBeNull();
    expect(img!.getAttribute("src")).toBe("data:image/svg+xml;utf8,key-1");
    expect(img!.getAttribute("data-subtype")).toBe("image");
  });

  it("renders the placeholder box without a resolver (no <img> at all)", async () => {
    renderDoc((doc) => doc.insertBlock("image", { src: "key-1" }));
    await flushResolve();

    expect(document.querySelector("img")).toBeNull();
    const placeholder = document.querySelector('[data-slot="docblocks/image-placeholder"]');
    expect(placeholder).not.toBeNull();
    expect(placeholder!.getAttribute("data-block-type")).toBe("image");
  });

  it("renders the placeholder box when the resolver returns an empty src", async () => {
    renderDoc((doc) => doc.insertBlock("image", { src: "unknown-key" }), { blobResolver: () => "" });
    await flushResolve();

    expect(document.querySelector("img")).toBeNull();
    expect(document.querySelector('[data-slot="docblocks/image-placeholder"]')).not.toBeNull();
  });

  it("renders the <img> for the image subtype from the blob store", async () => {
    const store: BlobStore = {
      resolve: async () => ({ url: "https://cdn.test/pic.png", meta: { subtype: "image", name: "pic.png" } }),
      upload: async () => "up-1",
    };
    renderDoc((doc) => doc.insertBlock("image", { src: "key-1" }), { blobStore: store });
    await flushResolve();

    const img = document.querySelector<HTMLImageElement>("img[data-slot='docblocks/image']");
    expect(img).not.toBeNull();
    expect(img!.getAttribute("src")).toBe("https://cdn.test/pic.png");
  });

  it("renders the pdf subtype as the iframe viewer", async () => {
    const store: BlobStore = {
      resolve: async () => ({ url: "https://cdn.test/doc.pdf", meta: { subtype: "pdf", name: "doc.pdf" } }),
      upload: async () => "up-1",
    };
    renderDoc((doc) => doc.insertBlock("image", { src: "key-1" }), { blobStore: store });
    await flushResolve();

    const frame = document.querySelector<HTMLIFrameElement>("iframe[data-slot='docblocks/image-pdf']");
    expect(frame).not.toBeNull();
    expect(frame!.getAttribute("src")).toBe("https://cdn.test/doc.pdf");
    expect(frame!.getAttribute("data-subtype")).toBe("pdf");
  });

  it("renders the file subtype as the download card", async () => {
    const store: BlobStore = {
      resolve: async () => ({ url: "https://cdn.test/a.xlsx", meta: { subtype: "file", name: "a.xlsx" } }),
      upload: async () => "up-1",
    };
    renderDoc((doc) => doc.insertBlock("image", { src: "key-1" }), { blobStore: store });
    await flushResolve();

    const card = document.querySelector('[data-slot="docblocks/image-file"]');
    expect(card).not.toBeNull();
    const link = card!.querySelector("a");
    expect(link).not.toBeNull();
    expect(link!.getAttribute("href")).toBe("https://cdn.test/a.xlsx");
    expect(link!.textContent).toBe("a.xlsx");
  });

  it("renders the placeholder when the store rejects the key", async () => {
    const store: BlobStore = {
      resolve: async () => {
        throw new Error("Blob not found: key-1");
      },
      upload: async () => "up-1",
    };
    renderDoc((doc) => doc.insertBlock("image", { src: "key-1" }), { blobStore: store });
    await flushResolve();

    expect(document.querySelector("img")).toBeNull();
    expect(document.querySelector('[data-slot="docblocks/image-placeholder"]')).not.toBeNull();
  });
});

describe("built-in renderers: code", () => {
  it("renders a code block as a mono <pre> wrapper with an editable inner", () => {
    let codeId = "";
    const doc = renderDoc((d) => {
      codeId = d.insertBlock("code", { language: "ts" });
      d.insertText(codeId, 0, "const x = 1;");
    });

    const pre = document.querySelector<HTMLElement>("pre[data-block-type='code']");
    expect(pre).not.toBeNull();
    expect(pre!.getAttribute("data-language")).toBe("ts");
    const inner = pre!.querySelector<HTMLElement>('[data-slot="docblocks/block-content"]');
    expect(inner).not.toBeNull();
    expect(inner!.getAttribute("contenteditable")).toBe("true");
    expect(inner!.textContent).toBe("const x = 1;");

    // Typing commits through the existing input path (DOM text node edited
    // in place, then the input event commits the diff to the doc).
    const textNode = inner!.firstChild!;
    act(() => {
      textNode.nodeValue = "const x = 2;";
      inner!.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(doc.getText(codeId)).toBe("const x = 2;");
  });

  it("renders a divider as a styled <hr>", () => {
    renderDoc((doc) => doc.insertBlock("divider"));
    const hr = document.querySelector('hr[data-slot="docblocks/divider"]');
    expect(hr).not.toBeNull();
    expect(hr!.getAttribute("data-block-type")).toBe("divider");
  });
});

describe("built-in renderers: quote", () => {
  it("renders the editable text with the left rule element", () => {
    let q: BlockId = "";
    renderDoc((d) => {
      q = d.insertBlock("quote");
      d.insertText(q, 0, "first line\nsecond line");
    });

    const wrapper = document.querySelector<HTMLElement>(`[data-block-id="${q}"][data-block-type="quote"]`);
    expect(wrapper).not.toBeNull();
    // The editable inner carries the text (the breaks stand in the run text).
    const inner = wrapper!.querySelector<HTMLElement>('[data-slot="docblocks/block-content"]');
    expect(inner).not.toBeNull();
    expect(inner!.textContent).toBe("first line\nsecond line");
    // The left rule: the dedicated element stands in the marker zone.
    const rule = wrapper!.querySelector<HTMLElement>('[data-slot="docblocks/quote-rule"]');
    expect(rule).not.toBeNull();
    expect(rule!.getAttribute("aria-hidden")).toBe("true");
    // The wrapper carries the marker zone's padding (the rule stands left of the text).
    expect(wrapper!.className).toContain("pl-(--docblocks-marker-width)");
  });

  it("renders without the rule for non-quote text blocks", () => {
    renderDoc((d) => {
      const p = d.insertBlock("paragraph");
      d.insertText(p, 0, "plain");
      const c = d.insertBlock("callout");
      d.insertText(c, 0, "note");
    });

    expect(document.querySelector('[data-slot="docblocks/quote-rule"]')).toBeNull();
    expect(document.querySelector('[data-block-type="paragraph"]')).not.toBeNull();
    expect(document.querySelector('[data-block-type="callout"]')).not.toBeNull();
  });
});
