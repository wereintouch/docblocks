/**
 * docblocks-react-ui/pdf — the PDF first-page preview renderer.
 *
 * pdfjs-dist is an optional peer dependency and is imported only from this
 * subpath: the base entry (`docblocks-react-ui`) never imports it, so a
 * consumer without the package ships zero extra weight.
 *
 * A PDF is not a block type — it is the existing `image` block whose blob
 * resolves to the `pdf` subtype (zero schema change). The document holds
 * only the blob key; the preview is view-only (no data / wire / awareness).
 * Wire the renderer per instance (the `pdfPreview` provider prop): a
 * `pdf`-subtype image block then stands a client-side first-page canvas
 * instead of the built-in native iframe viewer.
 *
 * The render is best-effort: on a fetch / parse / render failure the
 * preview falls back to the native iframe viewer, so the document always
 * stays viewable.
 */
import { GlobalWorkerOptions, RenderingCancelledException, getDocument } from "pdfjs-dist";
import type { PDFDocumentLoadingTask } from "pdfjs-dist";

import { useEffect, useRef, useState } from "react";

import type { PdfPreviewProps } from "../editor-provider";
import { LoaderCircle, TriangleAlert } from "../shared/ui/icons";

// The worker file is copied next to this entry at build time (dist/pdf/),
// so the relative reference resolves in the consumer's browser with no
// bundler asset handling (the dist is served as static ESM). The path is
// composed at runtime so the bundler leaves the new URL untouched.
const WORKER_FILE = "pdf.worker.min.mjs";
const WORKER_URL = new URL(`./${WORKER_FILE}`, import.meta.url);
GlobalWorkerOptions.workerSrc = WORKER_URL.toString();

// The JBIG2 decoder (the wasm module + the no-wasm js fallback) is copied next
// to the worker at build time and loaded by the worker from this base url —
// pdfjs resolves `${wasmUrl}jbig2.wasm`, so the worker's directory is the base.
// Derived from the worker URL object (not import.meta.url) so a bundler's
// `new URL(_, import.meta.url)` asset rewrite cannot mangle the directory form.
// Scanned PDFs encode their text layers as JBIG2; without a resolvable wasmUrl
// the worker fails to initialize those layers and the page renders as a bare
// background image (the text is dropped).
const WASM_URL = new URL("./", WORKER_URL).toString();

/** The preview's render phase. */
type PdfPhase = "loading" | "ready" | "error";

/**
 * The first-page preview of one `pdf`-subtype image block: fetch the
 * resolved blob, render page 1 to a canvas via pdfjs-dist. The previous
 * phase stands until the (re-)render settles (no flicker while the url
 * changes). A failure stands the error note over the native iframe
 * fallback (the document stays viewable).
 */
function PdfFirstPage({ id, url, name }: PdfPreviewProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const loadingTaskRef = useRef<PDFDocumentLoadingTask | null>(null);
  const [phase, setPhase] = useState<PdfPhase>("loading");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setPhase("loading");
    setError(null);

    const run = async (): Promise<void> => {
      try {
        const response = await fetch(url);
        if (cancelled) return;
        if (!response.ok) throw new Error(`Failed to fetch the PDF (HTTP ${response.status}).`);
        const data = new Uint8Array(await response.arrayBuffer());
        const task = getDocument({ data, wasmUrl: WASM_URL });
        loadingTaskRef.current = task;
        // Unmounted while the fetch was in flight: drop the worker just
        // created (the effect cleanup already ran, so it cannot).
        if (cancelled) {
          loadingTaskRef.current = null;
          void task.destroy().catch(() => undefined);
          return;
        }
        const pdf = await task.promise;
        const page = await pdf.getPage(1);
        if (cancelled) return;
        const canvas = canvasRef.current;
        if (canvas === null) return;
        // Render at the natural page size (scale 1), the backing store
        // scaled by the device pixel ratio for a crisp retina display.
        const ratio = window.devicePixelRatio || 1;
        const viewport = page.getViewport({ scale: ratio });
        canvas.width = Math.max(1, Math.floor(viewport.width));
        canvas.height = Math.max(1, Math.floor(viewport.height));
        canvas.style.width = `${Math.max(1, Math.floor(viewport.width / ratio))}px`;
        canvas.style.height = `${Math.max(1, Math.floor(viewport.height / ratio))}px`;
        const renderTask = page.render({ canvas, viewport });
        await renderTask.promise;
        if (!cancelled) setPhase("ready");
      } catch (cause) {
        if (cancelled || cause instanceof RenderingCancelledException) return;
        const message = cause instanceof Error ? cause.message : String(cause);
        setError(message);
        setPhase("error");
      }
    };

    void run();
    return () => {
      cancelled = true;
      // The worker is per getDocument (workerSrc, not a shared port), so
      // destroying the task frees it without affecting other previews.
      const task = loadingTaskRef.current;
      loadingTaskRef.current = null;
      if (task !== null) void task.destroy().catch(() => undefined);
    };
  }, [url]);

  if (phase === "error") {
    return (
      <div
        data-slot="docblocks/image-pdf-preview"
        data-block-id={id}
        data-block-type="image"
        data-phase="error"
        className="mx-0 my-(--docblocks-block-spacing)"
      >
        <div
          data-slot="docblocks/image-pdf-error"
          className="
            mb-2 flex items-center gap-2 rounded-(--docblocks-radius) border-(length:--docblocks-table-border-width)
            border-(--docblocks-table-border-color) bg-(--muted) px-3 py-2 text-sm text-(--muted-foreground)
          "
        >
          <TriangleAlert className="size-4 shrink-0" />
          <span className="min-w-0 flex-1 truncate">
            PDF preview unavailable ({error}). Showing the built-in viewer.
          </span>
        </div>
        <iframe
          data-slot="docblocks/image-pdf"
          data-subtype="pdf"
          src={url}
          title={name ?? "document"}
          className="
            block aspect-video w-full rounded-(--docblocks-image-radius) border-(length:--docblocks-table-border-width)
            border-(--docblocks-table-border-color) outline-none
          "
        />
      </div>
    );
  }

  return (
    <div
      data-slot="docblocks/image-pdf-preview"
      data-block-id={id}
      data-block-type="image"
      data-phase={phase}
      className="relative mx-0 my-(--docblocks-block-spacing) flex justify-center"
    >
      <canvas
        ref={canvasRef}
        data-slot="docblocks/image-pdf-canvas"
        className={`
          block max-w-full rounded-(--docblocks-image-radius) border-(length:--docblocks-table-border-width)
          border-(--docblocks-table-border-color) bg-(--background)
          ${phase === "ready" ? "h-auto" : "hidden"}`}
      />
      {phase === "loading" && (
        <div className="flex h-48 w-full items-center justify-center gap-2 text-sm text-(--muted-foreground)">
          <LoaderCircle className="size-4 animate-spin" />
          <span data-slot="docblocks/image-pdf-loading">loading preview…</span>
        </div>
      )}
    </div>
  );
}

export { PdfFirstPage };
export type { PdfPreviewProps };
