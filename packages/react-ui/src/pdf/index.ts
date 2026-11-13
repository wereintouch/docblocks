/**
 * docblocks-react-ui/pdf — the PDF first-page preview renderer.
 *
 * pdfjs-dist is imported only from this subpath: the base entry never imports
 * it, so consumers that do not enable the preview ship no pdfjs code.
 *
 * New PDFs are file blocks with a consumer-owned fileId; legacy image blocks
 * carrying PDF bytes remain supported. The preview is view-only: it writes no
 * document data, wire updates, or awareness. Wire it per instance through the
 * EditorProvider `pdfPreview` prop.
 *
 * On fetch, parse, or render failure the preview falls back to the native
 * iframe viewer, so the document stays viewable.
 */
import "./pdf-worker";

export { PdfFirstPage } from "./PdfFirstPage";
export type { PdfPreviewProps } from "../editor-provider";
