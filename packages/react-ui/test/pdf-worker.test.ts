import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PdfBinaryDataFactory } from "../src/pdf/pdf-worker";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the PDF worker's package assets", () => {
  it("keeps the worker and JBIG2 decoder statically analyzable by consumer bundlers", () => {
    const entry = readFileSync(new URL("../dist/pdf/index.mjs", import.meta.url), "utf8");

    expect(entry).toContain("pdfjs-dist/build/pdf.worker.min.mjs");
    expect(entry).toContain("pdfjs-dist/wasm/jbig2.wasm");
  });

  it("fetches the JBIG2 decoder by its emitted URL without appending a literal filename", async () => {
    const response = new Response(new Uint8Array([1, 2, 3]));
    const fetchMock = vi.fn().mockResolvedValue(response);
    vi.stubGlobal("fetch", fetchMock);
    const factory = new PdfBinaryDataFactory({});

    const bytes = await factory.fetch({ kind: "wasmUrl", filename: "jbig2.wasm" });

    expect(Array.from(bytes)).toEqual([1, 2, 3]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toMatch(/pdfjs-dist\/wasm\/jbig2\.wasm$/);
  });
});
