/** The PDF preview of one file block: fetch the resolved blob, render the
 * pages to a canvas via pdfjs-dist. The inline view stands the page over
 * the page row + the page controls' bar under the canvas; the fullscreen
 * mode opens the portal overlay (`PdfFullscreenOverlay` — the zoom bar,
 * the page navigation, the Escape / arrow keys / the close / the outside
 * click exit, the body's scroll lock). The page indicator's and the
 * scale's numbers stand a fixed width (the digit count's change must not
 * shift the buttons). The preview's chrome stands no text selection
 * (`select-none`): the page indicator's and the controls' text is not
 * document content, and a selection stood there would flag the block /
 * pull the format toolbar over a non-text range. A failure stands the
 * error note over the native iframe fallback (the document stays viewable).
 */
import { RenderingCancelledException } from "pdfjs-dist";
import type { PDFDocumentProxy, RenderTask } from "pdfjs-dist";
import { useTranslation } from "react-i18next";

import { useCallback, useEffect, useRef, useState } from "react";

import type { PdfPreviewProps } from "../editor-provider";
import { cn } from "../shared/ui/cn";
import { LoaderCircle, Maximize, TriangleAlert } from "../shared/ui/icons";
import { isSafeDownloadHref } from "../shared/utils";
import { PdfFullscreenOverlay } from "./PdfFullscreenOverlay";
import { PdfPageControls } from "./PdfPageControls";
import { PDF_VIEWER_SANDBOX, isEmbeddablePdfUrl } from "./constants";
import { usePdfDocument } from "./use-pdf-document";

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
  const { phase, error, currentPage, totalPages, prevPage, nextPage, pdfDocRef } = usePdfDocument(url);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const openFullscreen = useCallback((): void => setIsFullscreen(true), []);
  const closeFullscreen = useCallback((): void => setIsFullscreen(false), []);

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
      {phase === "ready" && (
        <PdfPageControls
          currentPage={currentPage}
          totalPages={totalPages}
          onPrevPage={prevPage}
          onNextPage={nextPage}
          actionSlot="docblocks/image-pdf-fullscreen"
          actionLabel={t("code.pdfFullscreen")}
          actionIcon={Maximize}
          onAction={openFullscreen}
        />
      )}
      {isFullscreen && (
        <PdfFullscreenOverlay
          pdfDocRef={pdfDocRef}
          phase={phase}
          currentPage={currentPage}
          totalPages={totalPages}
          prevPage={prevPage}
          nextPage={nextPage}
          onClose={closeFullscreen}
        />
      )}
    </div>
  );
}

export { PdfFirstPage };
