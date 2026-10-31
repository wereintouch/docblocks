/** The first-page preview of one `pdf`-subtype image block: fetch the
 * resolved blob, render page 1 to a canvas via pdfjs-dist. The previous
 * phase stands until the (re-)render settles (no flicker while the url
 * changes). A failure stands the error note over the native iframe
 * fallback (the document stays viewable). */
import { RenderingCancelledException, getDocument } from "pdfjs-dist";
import type { PDFDocumentLoadingTask } from "pdfjs-dist";

import { useEffect, useRef, useState } from "react";

import type { PdfPreviewProps } from "../editor-provider";
import { cn } from "../shared/ui/cn";
import { LoaderCircle, TriangleAlert } from "../shared/ui/icons";
import { PDF_VIEWER_SANDBOX, isEmbeddablePdfUrl } from "./constants";
import { WASM_URL } from "./pdf-worker";

/** The preview's render phase. */
type PdfPhase = "loading" | "ready" | "error";

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
        {/* The built-in viewer stands only over the embeddable scheme (the
          hostile-store gate): the data / blob / javascript urls stand the
          download link instead (their bytes are never executed over the
          frame's context). */}
        {isEmbeddablePdfUrl(url) ? (
          <iframe
            data-slot="docblocks/image-pdf"
            data-subtype="pdf"
            sandbox={PDF_VIEWER_SANDBOX}
            src={url}
            title={name ?? "document"}
            className="
              block aspect-video w-full rounded-(--docblocks-image-radius)
              border-(length:--docblocks-table-border-width) border-(--docblocks-table-border-color) outline-none
            "
          />
        ) : (
          <a
            data-slot="docblocks/image-pdf-download"
            href={url}
            download={name ?? undefined}
            className="inline-block text-sm underline underline-offset-2"
          >
            {name ?? "document"}
          </a>
        )}
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
        className={cn(
          `
            block max-w-full rounded-(--docblocks-image-radius) border-(length:--docblocks-table-border-width)
            border-(--docblocks-table-border-color) bg-(--background)
          `,
          phase === "ready" ? "h-auto" : "hidden"
        )}
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
