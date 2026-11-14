/** The PDF preview of one file block: fetch the resolved
 * blob, render the pages to a canvas via pdfjs-dist. The inline view stands
 * the first page over the page row; the controls (the previous/next page
 * buttons + the page indicator + the fullscreen toggle) stand a bar under
 * the canvas. The fullscreen mode opens a portal overlay over the viewport
 * (the page scaled to fill the viewport, the same page navigation, the zoom
 * bar — the zoom in/out buttons over the scale + the fit-width / the
 * fit-height — a separate
 * pill to the left of the page controls, the Escape key / the arrow keys /
 * the close button / the outside click exit). The overlay's open locks the
 * body's scroll (a wheel over the fixed portal chains to the document's
 * scroll container — the page behind must not scroll). The page indicator's
 * and the scale's numbers stand a fixed width (the digit count's change
 * must not shift the buttons). The preview's chrome stands no text
 * selection (`select-none`): the page indicator's and the controls' text
 * is not document content, and a selection stood there would flag the
 * block / pull the format toolbar over a non-text range. A failure stands
 * the error note over the native iframe fallback (the document stays
 * viewable). The in-flight fetch is aborted on unmount / url change and
 * the render task + document are released, so a torn-down preview leaves
 * no network request or pdf.js worker behind. */
import { RenderingCancelledException, getDocument } from "pdfjs-dist";
import type { PDFDocumentLoadingTask, PDFDocumentProxy, RenderTask } from "pdfjs-dist";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";

import { useCallback, useEffect, useRef, useState } from "react";

import type { PdfPreviewProps } from "../editor-provider";
import { cn } from "../shared/ui/cn";
import {
  ChevronLeft,
  ChevronRight,
  LoaderCircle,
  Maximize,
  Minimize,
  Minus,
  Plus,
  StretchHorizontal,
  StretchVertical,
  TriangleAlert,
  X,
} from "../shared/ui/icons";
import { clamp, isSafeDownloadHref } from "../shared/utils";
import { PDF_VIEWER_SANDBOX, isEmbeddablePdfUrl } from "./constants";
import { PdfBinaryDataFactory, WASM_URL } from "./pdf-worker";

/** The preview's render phase. */
type PdfPhase = "loading" | "ready" | "error";

/** The fullscreen zoom's bounds + the per-click step: the scale's units
 * are the css px per pdf point (the device pixel ratio stands the backing
 * store's scale, not this factor). */
const ZOOM_MIN = 0.25;
const ZOOM_MAX = 4;
const ZOOM_STEP = 1.25;

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
  // The fullscreen zoom: the explicit scale (the css px per pdf point);
  // null stands the contain's fit (the page fills the container's width or
  // height, the object-fit's stand). `fullscreenScale` stands the last
  // effective scale (the zoom indicator's + the buttons' disabled state).
  const [fullscreenZoom, setFullscreenZoom] = useState<number | null>(null);
  const [fullscreenScale, setFullscreenScale] = useState(1);

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
  // effective scale stands the explicit zoom when set, otherwise the
  // contain's fit (the page's aspect ratio is preserved — the page fills
  // the container's width or height). A zoomed page that overflows the
  // container scrolls (the `m-auto` over the scroller centers the page
  // when it fits and keeps the overflow scrollable when it does not). The
  // re-render skips the render when the backing store already stands the
  // computed scale (the container's resize over a fixed zoom).
  useEffect(() => {
    if (!isFullscreen || phase !== "ready") return;
    const pdf = pdfDocRef.current;
    const canvas = fullscreenCanvasRef.current;
    const container = fullscreenContainerRef.current;
    if (pdf === null || canvas === null || container === null) return;
    let cancelled = false;
    let renderToken = 0;
    let renderTask: RenderTask | null = null;
    let renderedOnce = false;

    const render = async (): Promise<void> => {
      const token = ++renderToken;
      const width = container.clientWidth;
      const height = container.clientHeight;
      if (width === 0 || height === 0) return;
      const page = await pdf.getPage(currentPage);
      if (cancelled || token !== renderToken) return;
      const pageViewport = page.getViewport({ scale: 1 });
      const fit = Math.min(width / pageViewport.width, height / pageViewport.height);
      const scale = fullscreenZoom ?? fit;
      setFullscreenScale(scale);
      const ratio = window.devicePixelRatio || 1;
      const viewport = page.getViewport({ scale: scale * ratio });
      const storeWidth = Math.max(1, Math.floor(viewport.width));
      const storeHeight = Math.max(1, Math.floor(viewport.height));
      if (renderedOnce && canvas.width === storeWidth && canvas.height === storeHeight) return;
      renderedOnce = true;
      if (renderTask !== null) {
        renderTask.cancel();
        renderTask = null;
      }
      canvas.width = storeWidth;
      canvas.height = storeHeight;
      canvas.style.width = `${Math.max(1, Math.floor(viewport.width / ratio))}px`;
      canvas.style.height = `${Math.max(1, Math.floor(viewport.height / ratio))}px`;
      try {
        renderTask = page.render({ canvas, viewport });
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

    void render();
    const observer = new ResizeObserver(() => {
      void render();
    });
    observer.observe(container);
    return () => {
      cancelled = true;
      renderToken += 1;
      observer.disconnect();
      if (renderTask !== null) renderTask.cancel();
    };
  }, [isFullscreen, currentPage, phase, fullscreenZoom]);

  const prevPage = useCallback((): void => {
    setCurrentPage((page) => Math.max(1, page - 1));
  }, []);
  const nextPage = useCallback((): void => {
    setCurrentPage((page) => Math.min(totalPages, page + 1));
  }, [totalPages]);
  // The fullscreen zoom's step: the effective scale (the explicit zoom, or
  // the contain's fit the current page + container stand) is multiplied by
  // the factor over the bounds. The page's size is read from the document
  // (the async read settles before the state's write), so the step stands
  // the same scale the render's effect computes.
  const zoomBy = useCallback(
    (factor: number): void => {
      const pdf = pdfDocRef.current;
      const container = fullscreenContainerRef.current;
      if (pdf === null || container === null) return;
      const width = container.clientWidth;
      const height = container.clientHeight;
      if (width === 0 || height === 0) return;
      void pdf.getPage(currentPage).then((page) => {
        const pageViewport = page.getViewport({ scale: 1 });
        const fit = Math.min(width / pageViewport.width, height / pageViewport.height);
        setFullscreenZoom(clamp((fullscreenZoom ?? fit) * factor, ZOOM_MIN, ZOOM_MAX));
      });
    },
    [currentPage, fullscreenZoom]
  );
  // The fit-width's stand: the page's width fills the container's width
  // (the vertical overflow scrolls over the container's scroller).
  const fitWidth = useCallback((): void => {
    const pdf = pdfDocRef.current;
    const container = fullscreenContainerRef.current;
    if (pdf === null || container === null) return;
    const width = container.clientWidth;
    if (width === 0) return;
    void pdf.getPage(currentPage).then((page) => {
      const pageViewport = page.getViewport({ scale: 1 });
      setFullscreenZoom(clamp(width / pageViewport.width, ZOOM_MIN, ZOOM_MAX));
    });
  }, [currentPage]);
  // The fit-height's stand: the page's height fills the container's height
  // (the horizontal overflow scrolls over the container's scroller).
  const fitHeight = useCallback((): void => {
    const pdf = pdfDocRef.current;
    const container = fullscreenContainerRef.current;
    if (pdf === null || container === null) return;
    const height = container.clientHeight;
    if (height === 0) return;
    void pdf.getPage(currentPage).then((page) => {
      const pageViewport = page.getViewport({ scale: 1 });
      setFullscreenZoom(clamp(height / pageViewport.height, ZOOM_MIN, ZOOM_MAX));
    });
  }, [currentPage]);
  const openFullscreen = useCallback((): void => {
    // A fresh open stands the contain's fit (the last session's zoom is
    // not carried over).
    setFullscreenZoom(null);
    setFullscreenScale(1);
    setIsFullscreen(true);
  }, []);

  // The Escape key closes the fullscreen overlay; the arrow keys stand the
  // page's navigation (left = the previous, right = the next). A caret in
  // a form field keeps the arrow's own stand: the overlay's modal cover
  // stands no live focus in the document's editables (its focus is the
  // parked page's container or an overlay's control — no editing stand
  // there). The parked page's container is contenteditable, so the
  // guard is the field's only, not the editable's.
  useEffect(() => {
    if (!isFullscreen) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        setIsFullscreen(false);
        return;
      }
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      const target = event.target instanceof HTMLElement ? event.target : null;
      if (target !== null && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      event.preventDefault();
      if (event.key === "ArrowLeft") prevPage();
      else nextPage();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isFullscreen, prevPage, nextPage]);

  // The body's scroll lock over the open overlay: the overlay is a fixed
  // portal, so a wheel over its surface (outside the scroller, or over the
  // scroller's limit) chains to the document's scroll container — the page
  // behind would scroll. The body's overflow stands restored on the close.
  useEffect(() => {
    if (!isFullscreen) return;
    const body = document.body;
    const previous = body.style.overflow;
    body.style.overflow = "hidden";
    return () => {
      body.style.overflow = previous;
    };
  }, [isFullscreen]);

  if (phase === "error") {
    return (
      <div
        data-slot="docblocks/image-pdf-preview"
        data-block-id={id}
        data-block-type={blockType}
        data-phase="error"
        className="mx-0 my-(--docblocks-block-spacing) select-none"
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
        {/* The page number stands a fixed width (the total's digit
            count): the digit count's change (1 → 2) must not shift the
            buttons. */}
        <span className="inline-block text-right" style={{ minWidth: `${Math.max(1, String(totalPages).length)}ch` }}>
          {currentPage}
        </span>
        {" / "}
        {totalPages}
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
        onClick={openFullscreen}
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
        select-none
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
        {/* The page number stands a fixed width (the total's digit
            count): the digit count's change (1 → 2) must not shift the
            buttons. */}
        <span className="inline-block text-right" style={{ minWidth: `${Math.max(1, String(totalPages).length)}ch` }}>
          {currentPage}
        </span>
        {" / "}
        {totalPages}
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

  // The fullscreen zoom's bar: the zoom out/in buttons over the scale's
  // indicator + the fit-width's button. It stands a separate pill to the
  // left of the page's controls, the same style (the thin border + the
  // rounded corners; the border + the radius read the standard tokens —
  // the overlay is portaled over the document body, outside the editor's
  // root, where the --docblocks-* tokens are undefined).
  const fullscreenZoomControls = (
    <div
      data-slot="docblocks/image-pdf-zoom"
      className="
        flex items-center justify-center gap-1 rounded-(--radius) border border-(--border) bg-(--muted) px-2 py-1
        select-none
      "
    >
      <button
        type="button"
        data-slot="docblocks/image-pdf-zoom-out"
        onClick={() => zoomBy(1 / ZOOM_STEP)}
        disabled={fullscreenScale <= ZOOM_MIN + 1e-9}
        aria-label={t("code.pdfZoomOut")}
        className="
          flex size-6 items-center justify-center rounded-sm text-(--muted-foreground) transition-colors
          hover:bg-(--accent) hover:text-(--accent-foreground)
          disabled:pointer-events-none disabled:opacity-40
        "
      >
        <Minus className="size-4" />
      </button>
      <span
        data-slot="docblocks/image-pdf-zoom-indicator"
        className="inline-block min-w-[4ch] px-1 text-right text-xs text-(--muted-foreground) tabular-nums"
      >
        {Math.round(fullscreenScale * 100)}%
      </span>
      <button
        type="button"
        data-slot="docblocks/image-pdf-zoom-in"
        onClick={() => zoomBy(ZOOM_STEP)}
        disabled={fullscreenScale >= ZOOM_MAX - 1e-9}
        aria-label={t("code.pdfZoomIn")}
        className="
          flex size-6 items-center justify-center rounded-sm text-(--muted-foreground) transition-colors
          hover:bg-(--accent) hover:text-(--accent-foreground)
          disabled:pointer-events-none disabled:opacity-40
        "
      >
        <Plus className="size-4" />
      </button>
      <button
        type="button"
        data-slot="docblocks/image-pdf-fit-width"
        onClick={fitWidth}
        aria-label={t("code.pdfFitWidth")}
        className="
          flex size-6 items-center justify-center rounded-sm text-(--muted-foreground) transition-colors
          hover:bg-(--accent) hover:text-(--accent-foreground)
        "
      >
        <StretchHorizontal className="size-4" />
      </button>
      <button
        type="button"
        data-slot="docblocks/image-pdf-fit-height"
        onClick={fitHeight}
        aria-label={t("code.pdfFitHeight")}
        className="
          flex size-6 items-center justify-center rounded-sm text-(--muted-foreground) transition-colors
          hover:bg-(--accent) hover:text-(--accent-foreground)
        "
      >
        <StretchVertical className="size-4" />
      </button>
    </div>
  );

  return (
    <div
      data-slot="docblocks/image-pdf-preview"
      data-block-id={id}
      data-block-type={blockType}
      data-phase={phase}
      className="relative mx-0 my-(--docblocks-block-spacing) flex flex-col items-center gap-2 select-none"
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
              if (target.closest('[data-slot="docblocks/image-pdf-zoom"]') !== null) return;
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
              data-slot="docblocks/image-pdf-fullscreen-container"
              className="flex h-[calc(100vh-6rem)] w-[calc(100vw-4rem)] overflow-auto"
            >
              <canvas
                ref={fullscreenCanvasRef}
                data-slot="docblocks/image-pdf-fullscreen-canvas"
                className="m-auto border border-(--border) bg-(--background) shadow-lg"
              />
            </div>
            <div className="flex items-center gap-2">
              {fullscreenZoomControls}
              {fullscreenControls}
            </div>
          </div>,
          document.body
        )}
    </div>
  );
}

export { PdfFirstPage };
