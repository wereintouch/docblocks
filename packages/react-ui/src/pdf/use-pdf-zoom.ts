/** The PDF fullscreen zoom's state: the explicit scale (the css px per pdf
 * point; null stands the contain's fit — the page fills the container's
 * width or height) + the zoom step / fit-width / fit-height computations.
 * The page's size is read from the document (the async read settles before
 * the state's write), so the step stands the same scale the render's
 * effect computes. */
import type { PDFDocumentProxy } from "pdfjs-dist";

import type { RefObject } from "react";
import { useCallback, useState } from "react";

import { clamp } from "../shared/utils";
import { ZOOM_MAX, ZOOM_MIN } from "./constants";

function usePdfZoom(
  pdfDocRef: RefObject<PDFDocumentProxy | null>,
  containerRef: RefObject<HTMLDivElement | null>,
  currentPage: number
): {
  zoom: number | null;
  scale: number;
  setScale: (scale: number) => void;
  zoomBy: (factor: number) => void;
  fitWidth: () => void;
  fitHeight: () => void;
} {
  const [zoom, setZoom] = useState<number | null>(null);
  // The last effective scale (the zoom indicator's + the buttons' disabled
  // state).
  const [scale, setScale] = useState(1);

  const zoomBy = useCallback(
    (factor: number): void => {
      const pdf = pdfDocRef.current;
      const container = containerRef.current;
      if (pdf === null || container === null) return;
      const width = container.clientWidth;
      const height = container.clientHeight;
      if (width === 0 || height === 0) return;
      void pdf.getPage(currentPage).then((page) => {
        const pageViewport = page.getViewport({ scale: 1 });
        const fit = Math.min(width / pageViewport.width, height / pageViewport.height);
        setZoom(clamp((zoom ?? fit) * factor, ZOOM_MIN, ZOOM_MAX));
      });
    },
    [pdfDocRef, containerRef, currentPage, zoom]
  );
  // The fit-width's stand: the page's width fills the container's width
  // (the vertical overflow scrolls over the container's scroller).
  const fitWidth = useCallback((): void => {
    const pdf = pdfDocRef.current;
    const container = containerRef.current;
    if (pdf === null || container === null) return;
    const width = container.clientWidth;
    if (width === 0) return;
    void pdf.getPage(currentPage).then((page) => {
      const pageViewport = page.getViewport({ scale: 1 });
      setZoom(clamp(width / pageViewport.width, ZOOM_MIN, ZOOM_MAX));
    });
  }, [pdfDocRef, containerRef, currentPage]);
  // The fit-height's stand: the page's height fills the container's height
  // (the horizontal overflow scrolls over the container's scroller).
  const fitHeight = useCallback((): void => {
    const pdf = pdfDocRef.current;
    const container = containerRef.current;
    if (pdf === null || container === null) return;
    const height = container.clientHeight;
    if (height === 0) return;
    void pdf.getPage(currentPage).then((page) => {
      const pageViewport = page.getViewport({ scale: 1 });
      setZoom(clamp(height / pageViewport.height, ZOOM_MIN, ZOOM_MAX));
    });
  }, [pdfDocRef, containerRef, currentPage]);

  return { zoom, scale, setScale, zoomBy, fitWidth, fitHeight };
}

export { usePdfZoom };
