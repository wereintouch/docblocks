/** The PDF first-page preview contract (`pdfPreview`). */
import type { ComponentType } from "react";

import type { BlockId } from "docblocks-core";

/** The props a PDF first-page preview renderer receives (the `pdfPreview` provider prop). */
interface PdfPreviewProps {
  /** The block's id — the renderer stamps it on its root, like the other block renderers. */
  id: BlockId;
  /** The owning block type (file for new PDFs, image for legacy PDF blocks). */
  blockType: "file" | "image";
  /** The library-owned object URL for the PDF bytes. */
  url: string;
  /** The store's authoritative display name. */
  name: string;
}

/** A PDF first-page preview renderer: a component over a resolved `pdf` blob. */
type PdfPreview = ComponentType<PdfPreviewProps>;

export type { PdfPreview, PdfPreviewProps };
