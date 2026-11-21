import { useTranslation } from "react-i18next";

import type { BlockId, ImageBlock as ImageBlockType } from "docblocks-core";

import { useEditorContext } from "../editor-provider";
import { PDF_VIEWER_SANDBOX, isEmbeddablePdfUrl } from "../pdf/constants";
import { Card, CardContent } from "../shared/ui/Card";
import { Image as ImageIcon, LoaderCircle } from "../shared/ui/icons";
import { FileCard } from "./FileCard";
import { ImageFigure } from "./ImageFigure";
import { BLOB_PLACEHOLDER_CLASS } from "./blob-styles";
import { useBlobFile } from "./use-blob-file";

/** The image block's renderable MIME (the bytes' stand): the image stands
 *  the `<img>`, the PDF the preview / the iframe; any other MIME stands the
 *  download card (the meta's stand over the store's `getMeta` +
 *  `downloadUrl`). A module-level const keeps the predicate's identity
 *  stable (the resolution's effect's dep). */
const IMAGE_RENDERS_BYTES = (mimeType: string): boolean =>
  mimeType.startsWith("image/") || mimeType === "application/pdf";

/**
 * An image: the <img> src comes from the consumer's blob store (the key is
 * opaque; resolution is a consumer-side concern). The store's MIME metadata
 * decides the rendering: images stand the <img>, PDF an iframe viewer, and
 * legacy non-image payloads the download card. While the id is unknown or
 * the get is in flight the block renders
 * a structural placeholder card instead of a broken <img>.
 */
function ImageBlock({ id, block }: { id: BlockId; block: ImageBlockType }) {
  const { t } = useTranslation("blocks");
  const { pdfPreview } = useEditorContext();
  const src = block.attrs.src;
  const file = useBlobFile(src, IMAGE_RENDERS_BYTES);

  if (file.status === "loading" || file.status === "missing") {
    // The loading's stand is the placeholder's spinner (the subtype is
    // unknown pre-resolution — the pdf / file's payloads stand their own
    // renderers over the ready state); the missing's stand keeps the
    // static card (the id stands no blob in this store).
    return (
      <Card
        data-slot="docblocks/image-placeholder"
        data-block-type="image"
        data-block-id={id}
        data-state={file.status}
        aria-busy={file.status === "loading"}
        className={BLOB_PLACEHOLDER_CLASS}
      >
        <CardContent className="flex flex-col items-center gap-2 text-center">
          {file.status === "loading" ? (
            <LoaderCircle className="size-6 animate-spin" />
          ) : (
            <ImageIcon className="size-6" />
          )}
          {t("image.placeholder")}
        </CardContent>
      </Card>
    );
  }

  if (file.status === "ready-meta") {
    // The meta-only stand (the store's `getMeta` + `downloadUrl`): the card
    // stands the store's download URL — the bytes were never fetched.
    return <FileCard id={id} fileId={src} blockType="image" url={file.url} name={file.meta.name} subtype="file" />;
  }

  const { url, meta } = file;
  const name = meta.name;
  if (meta.mimeType === "application/pdf") {
    // The consumer's PDF preview renderer (the `pdfPreview` provider prop)
    // takes over the whole figure; without it the native iframe stands.
    if (pdfPreview !== null) {
      const Preview = pdfPreview;
      return <Preview id={id} blockType="image" url={url} name={name} />;
    }
    // The native iframe stands over http(s) or the library-owned object URL;
    // other schemes stand the download card.
    if (!isEmbeddablePdfUrl(url)) {
      return <FileCard id={id} fileId={src} blockType="image" url={url} name={name} subtype="pdf" />;
    }
    return (
      <iframe
        data-slot="docblocks/image-pdf"
        data-block-type="image"
        data-block-id={id}
        data-subtype="pdf"
        sandbox={PDF_VIEWER_SANDBOX}
        src={url}
        title={name ?? t("image.document")}
        className="
          my-(--docblocks-block-spacing) block aspect-video w-full rounded-(--docblocks-image-radius)
          border-(length:--docblocks-table-border-width) border-(--docblocks-table-border-color) outline-none
        "
      />
    );
  }
  if (!meta.mimeType.startsWith("image/")) {
    return <FileCard id={id} fileId={src} blockType="image" url={url} name={name} subtype="file" />;
  }
  return <ImageFigure id={id} block={block} url={url} name={name} />;
}

export { ImageBlock };
