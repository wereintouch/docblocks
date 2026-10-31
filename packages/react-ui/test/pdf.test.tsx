// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { act } from "react";

import { createDoc } from "docblocks-core";
import type { BlockId } from "docblocks-core";

import { Editor } from "../src/Editor";
import type { BlobStore } from "../src/blob-store";
import { EditorProvider } from "../src/editor-provider";
import type { PdfPreviewProps } from "../src/editor-provider";
import { PdfFirstPage } from "../src/pdf/index";

const CREATED_AT = "2026-10-10T00:00:00.000Z";
type TestDoc = ReturnType<typeof createDoc>;

/** A pdf store that resolves one `pdf`-subtype blob (a data url). */
function pdfStore(url: string): BlobStore {
  return {
    resolve: async () => ({ url, meta: { subtype: "pdf", name: "doc.pdf" } }),
    upload: async () => "up-1",
  };
}

/** A stand-in preview renderer: renders a marker carrying the props it received. */
function FakePreview({ id, url, name }: PdfPreviewProps) {
  return <div data-slot="test-pdf-preview" data-block-id={id} data-url={url} data-name={name} />;
}

/** Seed the doc and render provider + editor, forwarding the `pdfPreview` prop. */
function renderDoc(
  prepare: (doc: TestDoc) => void,
  options: { blobStore: BlobStore; pdfPreview?: React.ComponentType<PdfPreviewProps> }
): TestDoc {
  const doc = createDoc({ id: "doc-1", createdAt: CREATED_AT });
  prepare(doc);
  render(
    <EditorProvider doc={doc} blobStore={options.blobStore} pdfPreview={options.pdfPreview}>
      <Editor />
    </EditorProvider>
  );
  return doc;
}

/** Flush the async blob resolve (the promise settles on a microtask). */
async function flushResolve(): Promise<void> {
  await act(async () => {});
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("the pdf subtype's preview renderer seam", () => {
  it("stands the native iframe viewer without a pdfPreview prop (the strict sandbox stands)", async () => {
    renderDoc((doc) => doc.insertBlock("image", { src: "key-1" }), { blobStore: pdfStore("https://cdn.test/doc.pdf") });
    await flushResolve();

    const frame = document.querySelector<HTMLIFrameElement>("iframe[data-slot='docblocks/image-pdf']");
    expect(frame).not.toBeNull();
    expect(frame!.getAttribute("src")).toBe("https://cdn.test/doc.pdf");
    // The hostile-store gate: the frame stands the strict sandbox (no
    // allow-same-origin, no allow-scripts) — a hostile document standing in
    // place of the PDF cannot read the parent or execute.
    expect(frame!.hasAttribute("sandbox")).toBe(true);
    const sandbox = frame!.getAttribute("sandbox") ?? "";
    expect(sandbox).not.toContain("allow-same-origin");
    expect(sandbox).not.toContain("allow-scripts");
    expect(document.querySelector("[data-slot='test-pdf-preview']")).toBeNull();
  });

  it("stands the download card (not the iframe) over a non-embeddable scheme (the hostile-store gate)", async () => {
    renderDoc((doc) => doc.insertBlock("image", { src: "key-1" }), {
      blobStore: pdfStore("data:text/html;base64,PGIgc2NyaXB0PmFsZXJ0KDE8L2I+"),
    });
    await flushResolve();

    // The hostile same-origin HTML url stands no iframe at all — only the
    // download card (its bytes are never executed over the frame's context).
    expect(document.querySelector("iframe[data-slot='docblocks/image-pdf']")).toBeNull();
    const card = document.querySelector('[data-slot="docblocks/image-file"][data-subtype="pdf"]');
    expect(card).not.toBeNull();
    const link = card!.querySelector<HTMLAnchorElement>("a");
    expect(link).not.toBeNull();
    expect(link!.getAttribute("href")).toBe("data:text/html;base64,PGIgc2NyaXB0PmFsZXJ0KDE8L2I+");
    expect(link!.hasAttribute("download")).toBe(true);
  });

  it("renders the consumer's pdfPreview renderer instead of the iframe when supplied", async () => {
    let blockId: BlockId | undefined;
    renderDoc(
      (doc) => {
        blockId = doc.insertBlock("image", { src: "key-1" });
      },
      {
        blobStore: pdfStore("https://cdn.test/doc.pdf"),
        pdfPreview: FakePreview,
      }
    );
    await flushResolve();

    const preview = document.querySelector("[data-slot='test-pdf-preview']");
    expect(preview).not.toBeNull();
    expect(preview!.getAttribute("data-url")).toBe("https://cdn.test/doc.pdf");
    expect(preview!.getAttribute("data-name")).toBe("doc.pdf");
    // The block id is forwarded to the renderer (it stamps it, like the other renderers).
    expect(preview!.getAttribute("data-block-id")).toBe(blockId);
    // The native iframe is replaced by the custom renderer.
    expect(document.querySelector("iframe[data-slot='docblocks/image-pdf']")).toBeNull();
  });
});

describe("PdfFirstPage (the ./pdf subpath)", () => {
  it("falls back to the download link on a render failure over a non-embeddable url (the hostile-store gate)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));

    let blockId: BlockId | undefined;
    renderDoc(
      (doc) => {
        blockId = doc.insertBlock("image", { src: "key-1" });
      },
      {
        blobStore: pdfStore("data:application/pdf;base64,AAAA"),
        pdfPreview: PdfFirstPage,
      }
    );

    // The fetch rejects on a microtask: the preview settles into the error
    // phase. The data url stands no iframe (the hostile-store gate) — the
    // error note + the download link stand.
    await screen.findByText(/PDF preview unavailable/);

    const shell = document.querySelector('[data-slot="docblocks/image-pdf-preview"][data-phase="error"]');
    expect(shell).not.toBeNull();
    // The preview shell stamps the block id + type (the repo-wide block DOM contract).
    expect(shell!.getAttribute("data-block-id")).toBe(blockId);
    expect(shell!.getAttribute("data-block-type")).toBe("image");
    const note = document.querySelector('[data-slot="docblocks/image-pdf-error"]');
    expect(note).not.toBeNull();
    expect(note!.textContent).toContain("network down");
    expect(document.querySelector("iframe[data-slot='docblocks/image-pdf']")).toBeNull();
    const link = document.querySelector<HTMLAnchorElement>("[data-slot='docblocks/image-pdf-download']");
    expect(link).not.toBeNull();
    expect(link!.getAttribute("href")).toBe("data:application/pdf;base64,AAAA");
    expect(link!.hasAttribute("download")).toBe(true);
  });

  it("falls back to the strict-sandboxed native iframe on a render failure over an embeddable url", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));

    renderDoc(
      (doc) => {
        doc.insertBlock("image", { src: "key-1" });
      },
      {
        blobStore: pdfStore("https://cdn.test/doc.pdf"),
        pdfPreview: PdfFirstPage,
      }
    );

    await screen.findByText(/PDF preview unavailable/);

    const frame = document.querySelector<HTMLIFrameElement>("iframe[data-slot='docblocks/image-pdf']");
    expect(frame).not.toBeNull();
    expect(frame!.getAttribute("src")).toBe("https://cdn.test/doc.pdf");
    // The same strict sandbox stands the error-fallback frame (both the
    // hostile same-origin HTML and the hostile blob url are neutralized).
    expect(frame!.hasAttribute("sandbox")).toBe(true);
    const sandbox = frame!.getAttribute("sandbox") ?? "";
    expect(sandbox).not.toContain("allow-same-origin");
    expect(sandbox).not.toContain("allow-scripts");
  });
});
