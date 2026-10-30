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
import "./pdf-worker";

export { PdfFirstPage } from "./PdfFirstPage";
export type { PdfPreviewProps } from "../editor-provider";
