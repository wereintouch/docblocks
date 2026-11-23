/** The PDF document's load lifecycle: the resolved url's fetch + parse
 * (pdfjs-dist), the page navigation's state, and the in-flight cleanup —
 * the fetch is aborted on unmount / url change and the render task +
 * document are released, so a torn-down preview leaves no network request
 * or pdf.js worker behind. */
import { RenderingCancelledException, getDocument } from "pdfjs-dist";
import type { PDFDocumentLoadingTask, PDFDocumentProxy } from "pdfjs-dist";

import type { RefObject } from "react";
import { useCallback, useEffect, useRef, useState } from "react";

import { PdfFetchError } from "../shared/errors";
import { PdfBinaryDataFactory, WASM_URL } from "./pdf-worker";

/** The preview's render phase. */
type PdfPhase = "loading" | "ready" | "error";

function usePdfDocument(url: string): {
  phase: PdfPhase;
  error: string | null;
  currentPage: number;
  totalPages: number;
  prevPage: () => void;
  nextPage: () => void;
  pdfDocRef: RefObject<PDFDocumentProxy | null>;
} {
  const loadingTaskRef = useRef<PDFDocumentLoadingTask | null>(null);
  const pdfDocRef = useRef<PDFDocumentProxy | null>(null);
  const [phase, setPhase] = useState<PdfPhase>("loading");
  const [error, setError] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);

  // Load the PDF document (once per url).
  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;
    setPhase("loading");
    setError(null);
    setCurrentPage(1);
    setTotalPages(0);

    const run = async (): Promise<void> => {
      try {
        const response = await fetch(url, { signal: controller.signal });
        if (cancelled) return;
        if (!response.ok) throw new PdfFetchError(`Failed to fetch the PDF (HTTP ${response.status}).`);
        const data = new Uint8Array(await response.arrayBuffer());
        if (cancelled) return;
        const task = getDocument({
          data,
          wasmUrl: WASM_URL,
          useWorkerFetch: false,
          BinaryDataFactory: PdfBinaryDataFactory,
        });
        loadingTaskRef.current = task;
        const pdf = await task.promise;
        if (cancelled) {
          loadingTaskRef.current = null;
          void task.destroy().catch(() => undefined);
          return;
        }
        pdfDocRef.current = pdf;
        setTotalPages(pdf.numPages);
        setPhase("ready");
      } catch (cause) {
        if (
          cancelled ||
          cause instanceof RenderingCancelledException ||
          (cause instanceof DOMException && cause.name === "AbortError")
        ) {
          return;
        }
        const message = cause instanceof Error ? cause.message : String(cause);
        setError(message);
        setPhase("error");
      }
    };

    void run();
    return () => {
      cancelled = true;
      controller.abort();
      pdfDocRef.current = null;
      const task = loadingTaskRef.current;
      loadingTaskRef.current = null;
      if (task !== null) void task.destroy().catch(() => undefined);
    };
  }, [url]);

  const prevPage = useCallback((): void => {
    setCurrentPage((page) => Math.max(1, page - 1));
  }, []);
  const nextPage = useCallback((): void => {
    setCurrentPage((page) => Math.min(totalPages, page + 1));
  }, [totalPages]);

  return { phase, error, currentPage, totalPages, prevPage, nextPage, pdfDocRef };
}

export { usePdfDocument };
export type { PdfPhase };
