/** The PDF preview of one file block: fetch the resolved
 * blob, render the pages to a canvas via pdfjs-dist. The inline view stands
 * the first page over the page row; the controls (the previous/next page
 * buttons + the page indicator + the fullscreen toggle) stand a bar under
 * the canvas. The fullscreen mode opens a portal overlay over the viewport
 * (the page scaled to fill the viewport, the same page navigation, the
 * Escape key / the close button / the outside click exit). A failure stands
 * the error note over the native iframe fallback (the document stays
 * viewable). The in-flight fetch is aborted on unmount / url change and the
 * render task + document are released, so a torn-down preview leaves no
 * network request or pdf.js worker behind. */
import { RenderingCancelledException, getDocument } from "pdfjs-dist";
import type { PDFDocumentLoadingTask, PDFDocumentProxy, RenderTask } from "pdfjs-dist";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";

import { useCallback, useEffect, useRef, useState } from "react";

import type { PdfPreviewProps } from "../editor-provider";
import { cn } from "../shared/ui/cn";
import { ChevronLeft, ChevronRight, LoaderCircle, Maximize, Minimize, TriangleAlert, X } from "../shared/ui/icons";
import { isSafeDownloadHref } from "../shared/utils";
import { PDF_VIEWER_SANDBOX, isEmbeddablePdfUrl } from "./constants";
import { WASM_URL } from "./pdf-worker";

/** The preview's render phase. */
type PdfPhase = "loading" | "ready" | "error";

/** Render one page to a canvas (the natural page size, the backing store
 * scaled by the device pixel ratio for a crisp retina display). Returns the
 * render task (the caller awaits its promise + cancels it on teardown).
 * Does NOT await the promise itself, so the caller can cancel the in-flight
 * render before it completes. */
function renderPageToCanvas(pdf: PDFDocumentProxy, pageNumber: number, canvas: HTMLCanvasElement): Promise<RenderTask> {
  return pdf.getPage(pageNumber).then((page) => {
    const ratio = window.devicePixelRatio || 1;
    const viewport = page.getViewport({ scale: ratio });
    canvas.width = Math.max(1, Math.floor(viewport.width));
    canvas.height = Math.max(1, Math.floor(viewport.height));
    canvas.style.width = `${Math.max(1, Math.floor(viewport.width / ratio))}px`;
    canvas.style.height = `${Math.max(1, Math.floor(viewport.height / ratio))}px`;
    return page.render({ canvas, viewport });
  });
}

/** Render one page to a canvas, scaled to fill the container (the
 * object-fit: contain behavior — the page's aspect ratio is preserved, the
 * page fills the container's width or height). Returns the render task. */
function renderPageToCanvasScaled(
  pdf: PDFDocumentProxy,
  pageNumber: number,
  canvas: HTMLCanvasElement,
  containerWidth: number,
  containerHeight: number
): Promise<RenderTask> {
  return pdf.getPage(pageNumber).then((page) => {
    const pageViewport = page.getViewport({ scale: 1 });
    const scale = Math.min(containerWidth / pageViewport.width, containerHeight / pageViewport.height);
    const ratio = window.devicePixelRatio || 1;
    const viewport = page.getViewport({ scale: scale * ratio });
    canvas.width = Math.max(1, Math.floor(viewport.width));
    canvas.height = Math.max(1, Math.floor(viewport.height));
    canvas.style.width = `${Math.max(1, Math.floor(viewport.width / ratio))}px`;
    canvas.style.height = `${Math.max(1, Math.floor(viewport.height / ratio))}px`;
    return page.render({ canvas, viewport });
  });
}

function PdfFirstPage({ id, blockType, url, name }: PdfPreviewProps) {
  const { t } = useTranslation("blocks");
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const fullscreenCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const fullscreenContainerRef = useRef<HTMLDivElement | null>(null);
  const loadingTaskRef = useRef<PDFDocumentLoadingTask | null>(null);
  const pdfDocRef = useRef<PDFDocumentProxy | null>(null);
  const [phase, setPhase] = useState<PdfPhase>("loading");
  const [error, setError] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);

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
        if (!response.ok) throw new Error(`Failed to fetch the PDF (HTTP ${response.status}).`);
        const data = new Uint8Array(await response.arrayBuffer());
        if (cancelled) return;
        const task = getDocument({ data, wasmUrl: WASM_URL });
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

  // Render the current page to the inline canvas (on page / phase change).
  useEffect(() => {
    if (phase !== "ready") return;
    const pdf = pdfDocRef.current;
    const canvas = canvasRef.current;
    if (pdf === null || canvas === null) return;
    let cancelled = false;
    let renderTask: RenderTask | null = null;

    const run = async (): Promise<void> => {
      try {
        renderTask = await renderPageToCanvas(pdf, currentPage, canvas);
        await renderTask.promise;
      } catch (cause) {
        if (
          cancelled ||
          cause instanceof RenderingCancelledException ||
          (cause instanceof DOMException && cause.name === "AbortError")
        ) {
          return;
        }
        // A render failure (a corrupt page) leaves the canvas at the
        // previous page; the document stays viewable.
      }
    };

    void run();
    return () => {
      cancelled = true;
      if (renderTask !== null) renderTask.cancel();
    };
  }, [url, currentPage, phase]);

  // Render the current page to the fullscreen canvas (while the overlay is
  // open; the page change re-renders the overlay's canvas in place). The
  // page is scaled to fill the container (the object-fit: contain
  // behavior — the page's aspect ratio is preserved, the page fills the
  // container's width or height).
  useEffect(() => {
    if (!isFullscreen || phase !== "ready") return;
    const pdf = pdfDocRef.current;
    const canvas = fullscreenCanvasRef.current;
    const container = fullscreenContainerRef.current;
    if (pdf === null || canvas === null || container === null) return;
    let cancelled = false;
    let renderTask: RenderTask | null = null;

    const render = (): void => {
      const width = container.clientWidth;
      const height = container.clientHeight;
      if (width === 0 || height === 0) return;
      void (async (): Promise<void> => {
        try {
          renderTask = await renderPageToCanvasScaled(pdf, currentPage, canvas, width, height);
          await renderTask.promise;
        } catch (cause) {
          if (
            cancelled ||
            cause instanceof RenderingCancelledException ||
            (cause instanceof DOMException && cause.name === "AbortError")
          ) {
            return;
          }
        }
      })();
    };

    render();
    const observer = new ResizeObserver(() => render());
    observer.observe(container);
    return () => {
      cancelled = true;
      observer.disconnect();
      if (renderTask !== null) renderTask.cancel();
    };
  }, [isFullscreen, currentPage, phase]);

  // The Escape key closes the fullscreen overlay.
  useEffect(() => {
    if (!isFullscreen) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") setIsFullscreen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isFullscreen]);

  const prevPage = useCallback((): void => {
    setCurrentPage((page) => Math.max(1, page - 1));
  }, []);
  const nextPage = useCallback((): void => {
    setCurrentPage((page) => Math.min(totalPages, page + 1));
  }, [totalPages]);

  if (phase === "error") {
    return (
      <div
        data-slot="docblocks/image-pdf-preview"
        data-block-id={id}
        data-block-type={blockType}
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
          <span className="min-w-0 flex-1 truncate">{t("code.pdfPreviewUnavailable", { error })}</span>
        </div>
        {isEmbeddablePdfUrl(url) ? (
          <iframe
            data-slot="docblocks/image-pdf"
            data-subtype="pdf"
            sandbox={PDF_VIEWER_SANDBOX}
            src={url}
            title={name}
            className="
              block aspect-video w-full rounded-(--docblocks-image-radius)
              border-(length:--docblocks-table-border-width) border-(--docblocks-table-border-color) outline-none
            "
          />
        ) : isSafeDownloadHref(url) ? (
          <a
            data-slot="docblocks/image-pdf-download"
            href={url}
            download={name}
            className="inline-block text-sm underline underline-offset-2"
          >
            {name}
          </a>
        ) : (
          <span data-slot="docblocks/image-pdf-download" className="inline-block text-sm">
            {name}
          </span>
        )}
      </div>
    );
  }

  const inlineControls = (
    <div
      data-slot="docblocks/image-pdf-controls"
      className="
        flex items-center justify-center gap-1 rounded-(--docblocks-radius)
        border-(length:--docblocks-table-border-width) border-(--docblocks-table-border-color) bg-(--muted) px-2 py-1
      "
    >
      <button
        type="button"
        data-slot="docblocks/image-pdf-prev"
        onClick={prevPage}
        disabled={currentPage <= 1}
        aria-label={t("code.pdfPrevPage")}
        className="
          flex size-6 items-center justify-center rounded-sm text-(--muted-foreground) transition-colors
          hover:bg-(--accent) hover:text-(--accent-foreground)
          disabled:pointer-events-none disabled:opacity-40
        "
      >
        <ChevronLeft className="size-4" />
      </button>
      <span
        data-slot="docblocks/image-pdf-page-indicator"
        className="px-1 text-xs text-(--muted-foreground) tabular-nums"
      >
        {/* eslint-disable-next-line i18next/no-literal-string -- the page
            separator is a technical glyph (the same over every locale). */}
        {currentPage} / {totalPages}
      </span>
      <button
        type="button"
        data-slot="docblocks/image-pdf-next"
        onClick={nextPage}
        disabled={currentPage >= totalPages}
        aria-label={t("code.pdfNextPage")}
        className="
          flex size-6 items-center justify-center rounded-sm text-(--muted-foreground) transition-colors
          hover:bg-(--accent) hover:text-(--accent-foreground)
          disabled:pointer-events-none disabled:opacity-40
        "
      >
        <ChevronRight className="size-4" />
      </button>
      <button
        type="button"
        data-slot="docblocks/image-pdf-fullscreen"
        onClick={() => setIsFullscreen(true)}
        aria-label={t("code.pdfFullscreen")}
        className="
          ml-1 flex size-6 items-center justify-center rounded-sm text-(--muted-foreground) transition-colors
          hover:bg-(--accent) hover:text-(--accent-foreground)
        "
      >
        <Maximize className="size-4" />
      </button>
    </div>
  );

  // The fullscreen controls: the prev/next buttons + the page indicator +
  // the minimize button (no fullscreen toggle — it's already fullscreen).
  // The bar stands the inline's (the thin border + the rounded corners),
  // the minimize icon the only difference. The border + the radius read
  // the standard tokens: the overlay is portaled over the document body,
  // outside the editor's root, where the --docblocks-* tokens are
  // undefined (an undefined var() falls back to the border's initial
  // 3px/currentColor + the radius's 0).
  const fullscreenControls = (
    <div
      data-slot="docblocks/image-pdf-controls"
      className="
        flex items-center justify-center gap-1 rounded-(--radius) border border-(--border) bg-(--muted) px-2 py-1
      "
    >
      <button
        type="button"
        data-slot="docblocks/image-pdf-prev"
        onClick={prevPage}
        disabled={currentPage <= 1}
        aria-label={t("code.pdfPrevPage")}
        className="
          flex size-6 items-center justify-center rounded-sm text-(--muted-foreground) transition-colors
          hover:bg-(--accent) hover:text-(--accent-foreground)
          disabled:pointer-events-none disabled:opacity-40
        "
      >
        <ChevronLeft className="size-4" />
      </button>
      <span
        data-slot="docblocks/image-pdf-page-indicator"
        className="px-1 text-xs text-(--muted-foreground) tabular-nums"
      >
        {/* eslint-disable-next-line i18next/no-literal-string -- the page
            separator is a technical glyph (the same over every locale). */}
        {currentPage} / {totalPages}
      </span>
      <button
        type="button"
        data-slot="docblocks/image-pdf-next"
        onClick={nextPage}
        disabled={currentPage >= totalPages}
        aria-label={t("code.pdfNextPage")}
        className="
          flex size-6 items-center justify-center rounded-sm text-(--muted-foreground) transition-colors
          hover:bg-(--accent) hover:text-(--accent-foreground)
          disabled:pointer-events-none disabled:opacity-40
        "
      >
        <ChevronRight className="size-4" />
      </button>
      <button
        type="button"
        data-slot="docblocks/image-pdf-minimize"
        onClick={() => setIsFullscreen(false)}
        aria-label={t("code.pdfCloseFullscreen")}
        className="
          ml-1 flex size-6 items-center justify-center rounded-sm text-(--muted-foreground) transition-colors
          hover:bg-(--accent) hover:text-(--accent-foreground)
        "
      >
        <Minimize className="size-4" />
      </button>
    </div>
  );

  return (
    <div
      data-slot="docblocks/image-pdf-preview"
      data-block-id={id}
      data-block-type={blockType}
      data-phase={phase}
      className="relative mx-0 my-(--docblocks-block-spacing) flex flex-col items-center gap-2"
    >
      <div className="relative flex w-full justify-center">
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
            <span data-slot="docblocks/image-pdf-loading">{t("code.pdfLoading")}</span>
          </div>
        )}
      </div>
      {phase === "ready" && inlineControls}

      {isFullscreen &&
        createPortal(
          <div
            data-slot="docblocks/image-pdf-fullscreen-overlay"
            className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-3 bg-(--background)"
            role="dialog"
            aria-modal="true"
            aria-label={t("code.pdfFullscreen")}
            onClick={(event) => {
              // A click over the overlay's own surface (the background
              // around the page) closes the fullscreen mode; the canvas,
              // the controls, and the close button stand the content's
              // zone. The container div covers the overlay's inner area,
              // so its clicks stand as the overlay's (the closest-match
              // over the content's slots only keeps the page's zone).
              const target = event.target as HTMLElement | null;
              if (target === null) return;
              if (target.closest('[data-slot="docblocks/image-pdf-fullscreen-canvas"]') !== null) return;
              if (target.closest('[data-slot="docblocks/image-pdf-controls"]') !== null) return;
              setIsFullscreen(false);
            }}
          >
            <button
              type="button"
              data-slot="docblocks/image-pdf-fullscreen-close"
              onClick={() => setIsFullscreen(false)}
              aria-label={t("code.pdfCloseFullscreen")}
              className="
                absolute top-4 right-4 flex size-8 items-center justify-center rounded-md text-(--foreground)
                transition-colors
                hover:bg-(--accent)
              "
            >
              <X className="size-5" />
            </button>
            <div
              ref={fullscreenContainerRef}
              className="flex h-[calc(100vh-6rem)] w-[calc(100vw-4rem)] items-center justify-center overflow-hidden"
            >
              <canvas
                ref={fullscreenCanvasRef}
                data-slot="docblocks/image-pdf-fullscreen-canvas"
                className="max-h-full max-w-full border border-(--border) bg-(--background) shadow-lg"
              />
            </div>
            {fullscreenControls}
          </div>,
          document.body
        )}
    </div>
  );
}

export { PdfFirstPage };
