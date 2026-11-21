/** The PDF preview's fullscreen overlay: the page scaled to fill the
 * viewport over a portal (the same page navigation, the zoom bar — the
 * zoom in / out buttons over the scale + the fit-width / the fit-height —
 * a separate pill to the left of the page controls, the Escape key / the
 * arrow keys / the close button / the outside click exit). A fresh open
 * stands the contain's fit (the mount's fresh zoom state — the last
 * session's zoom is not carried over). The page stands the explicit zoom
 * when set, otherwise the contain's fit (the page's aspect ratio is
 * preserved — the page fills the container's width or height). A zoomed
 * page that overflows the container scrolls (the `m-auto` over the
 * scroller centers the page when it fits and keeps the overflow scrollable
 * when it does not). The overlay's open locks the body's scroll (a wheel
 * over the fixed portal chains to the document's scroll container — the
 * page behind must not scroll). */
import { RenderingCancelledException } from "pdfjs-dist";
import type { PDFDocumentProxy, RenderTask } from "pdfjs-dist";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";

import type { RefObject } from "react";
import { useEffect, useRef } from "react";

import { Minimize, X } from "../shared/ui/icons";
import { PdfPageControls } from "./PdfPageControls";
import { PdfZoomControls } from "./PdfZoomControls";
import { ZOOM_STEP } from "./constants";
import type { PdfPhase } from "./use-pdf-document";
import { usePdfZoom } from "./use-pdf-zoom";

type PdfFullscreenOverlayProps = {
  pdfDocRef: RefObject<PDFDocumentProxy | null>;
  phase: PdfPhase;
  currentPage: number;
  totalPages: number;
  prevPage: () => void;
  nextPage: () => void;
  onClose: () => void;
};

function PdfFullscreenOverlay({
  pdfDocRef,
  phase,
  currentPage,
  totalPages,
  prevPage,
  nextPage,
  onClose,
}: PdfFullscreenOverlayProps) {
  const { t } = useTranslation("blocks");
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const { zoom, scale, setScale, zoomBy, fitWidth, fitHeight } = usePdfZoom(pdfDocRef, containerRef, currentPage);
  const zoomOut = (): void => zoomBy(1 / ZOOM_STEP);
  const zoomIn = (): void => zoomBy(ZOOM_STEP);

  // Render the current page to the canvas (on page / phase change). The
  // effective scale stands the explicit zoom when set, otherwise the
  // contain's fit. The re-render skips the render when the backing store
  // already stands the computed scale (the container's resize over a fixed
  // zoom).
  useEffect(() => {
    if (phase !== "ready") return;
    const pdf = pdfDocRef.current;
    const canvas = canvasRef.current;
    const container = containerRef.current;
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
      const effectiveScale = zoom ?? fit;
      setScale(effectiveScale);
      const ratio = window.devicePixelRatio || 1;
      const viewport = page.getViewport({ scale: effectiveScale * ratio });
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
  }, [pdfDocRef, currentPage, phase, zoom]);

  // The Escape key closes the overlay; the arrow keys stand the page's
  // navigation (left = the previous, right = the next). A caret in a form
  // field keeps the arrow's own stand: the overlay's modal cover stands no
  // live focus in the document's editables (its focus is the parked page's
  // container or an overlay's control — no editing stand there). The
  // parked page's container is contenteditable, so the guard is the
  // field's only, not the editable's.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        onClose();
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
  }, [onClose, prevPage, nextPage]);

  // The body's scroll lock over the open overlay: the overlay is a fixed
  // portal, so a wheel over its surface (outside the scroller, or over the
  // scroller's limit) chains to the document's scroll container — the page
  // behind would scroll. The body's overflow stands restored on the close.
  useEffect(() => {
    const body = document.body;
    const previous = body.style.overflow;
    body.style.overflow = "hidden";
    return () => {
      body.style.overflow = previous;
    };
  }, []);

  return createPortal(
    <div
      data-slot="docblocks/image-pdf-fullscreen-overlay"
      className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-3 bg-(--background)"
      role="dialog"
      aria-modal="true"
      aria-label={t("code.pdfFullscreen")}
      onClick={(event) => {
        // A click over the overlay's own surface (the background around
        // the page) closes the fullscreen mode; the canvas, the controls,
        // and the close button stand the content's zone. The container div
        // covers the overlay's inner area, so its clicks stand as the
        // overlay's (the closest-match over the content's slots only keeps
        // the page's zone).
        const target = event.target as HTMLElement | null;
        if (target === null) return;
        if (target.closest('[data-slot="docblocks/image-pdf-fullscreen-canvas"]') !== null) return;
        if (target.closest('[data-slot="docblocks/image-pdf-controls"]') !== null) return;
        if (target.closest('[data-slot="docblocks/image-pdf-zoom"]') !== null) return;
        onClose();
      }}
    >
      <button
        type="button"
        data-slot="docblocks/image-pdf-fullscreen-close"
        onClick={onClose}
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
        ref={containerRef}
        data-slot="docblocks/image-pdf-fullscreen-container"
        className="flex h-[calc(100vh-6rem)] w-[calc(100vw-4rem)] overflow-auto"
      >
        <canvas
          ref={canvasRef}
          data-slot="docblocks/image-pdf-fullscreen-canvas"
          className="m-auto border border-(--border) bg-(--background) shadow-lg"
        />
      </div>
      <div className="flex items-center gap-2">
        <PdfZoomControls
          scale={scale}
          onZoomOut={zoomOut}
          onZoomIn={zoomIn}
          onFitWidth={fitWidth}
          onFitHeight={fitHeight}
        />
        <PdfPageControls
          portaled
          currentPage={currentPage}
          totalPages={totalPages}
          onPrevPage={prevPage}
          onNextPage={nextPage}
          actionSlot="docblocks/image-pdf-minimize"
          actionLabel={t("code.pdfCloseFullscreen")}
          actionIcon={Minimize}
          onAction={onClose}
        />
      </div>
    </div>,
    document.body
  );
}

export { PdfFullscreenOverlay };
export type { PdfFullscreenOverlayProps };
