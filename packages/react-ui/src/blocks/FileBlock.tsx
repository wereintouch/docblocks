import { useTranslation } from "react-i18next";

import type { BlockId, FileBlock as FileBlockType } from "docblocks-core";

import { useEditorContext } from "../editor-provider";
import { PDF_VIEWER_SANDBOX, isEmbeddablePdfUrl } from "../pdf/constants";
import { Card, CardContent } from "../shared/ui/Card";
import { File as FileIcon, LoaderCircle } from "../shared/ui/icons";
import { FileCard } from "./FileCard";
import { BLOB_PLACEHOLDER_CLASS, BLOB_PLACEHOLDER_CONTENT_CLASS, BLOB_PLACEHOLDER_SPACING } from "./blob-styles";
import { useBlobFile } from "./use-blob-file";

/** The file block's renderable MIME (the bytes' stand): the PDF stands the
 *  preview / the iframe; any other MIME stands the download card (the
 *  meta's stand over the store's `getMeta` + `downloadUrl`). A module-level
 *  const keeps the predicate's identity stable (the resolution's effect's
 *  dep). */
const FILE_RENDERS_BYTES = (mimeType: string): boolean => mimeType === "application/pdf";

/** A consumer-owned file: the document carries only its file id. */
function FileBlock({ id, block }: { id: BlockId; block: FileBlockType }) {
  const { t } = useTranslation("blocks");
  const { pdfPreview, blobLoading } = useEditorContext();
  const fileId = block.attrs.fileId;
  // The lazy stand: the bytes resolve once the block enters the viewport's
  // preload band; the eager policy skips the gate.
  const { state: view, ref: placeholderRef } = useBlobFile(
    fileId,
    FILE_RENDERS_BYTES,
    blobLoading === "eager" ? { eager: true } : {}
  );

  if (view.status === "loading" || view.status === "missing") {
    // The loading's stand is the placeholder's spinner (the subtype is
    // unknown pre-resolution); the missing's stand keeps the static card
    // (the id stands no blob in this store).
    return (
      <Card
        ref={placeholderRef}
        data-slot="docblocks/file-placeholder"
        data-block-type="file"
        data-block-id={id}
        data-state={view.status}
        aria-busy={view.status === "loading"}
        className={`${BLOB_PLACEHOLDER_CLASS} ${BLOB_PLACEHOLDER_SPACING}`}
      >
        <CardContent className={BLOB_PLACEHOLDER_CONTENT_CLASS}>
          {view.status === "loading" ? (
            <LoaderCircle className="size-6 animate-spin" />
          ) : (
            <FileIcon className="size-6" />
          )}
          {t("file.placeholder")}
        </CardContent>
      </Card>
    );
  }

  if (view.status === "ready-meta") {
    // The meta-only stand (the store's `getMeta` + `downloadUrl`): the card
    // stands the store's download URL — the bytes were never fetched.
    return <FileCard id={id} fileId={fileId} blockType="file" url={view.url} name={view.meta.name} subtype="file" />;
  }

  const { url, meta } = view;
  if (meta.mimeType === "application/pdf") {
    if (pdfPreview !== null) {
      const Preview = pdfPreview;
      return <Preview id={id} blockType="file" url={url} name={meta.name} />;
    }
    if (isEmbeddablePdfUrl(url)) {
      return (
        <iframe
          data-slot="docblocks/file-pdf"
          data-block-type="file"
          data-block-id={id}
          data-mime-type="application/pdf"
          sandbox={PDF_VIEWER_SANDBOX}
          src={url}
          title={meta.name}
          className="
            my-(--docblocks-block-spacing) block aspect-video w-full rounded-(--docblocks-image-radius)
            border-(length:--docblocks-table-border-width) border-(--docblocks-table-border-color) outline-none
          "
        />
      );
    }
  }

  return (
    <FileCard
      id={id}
      fileId={fileId}
      blockType="file"
      url={url}
      name={meta.name}
      subtype={meta.mimeType === "application/pdf" ? "pdf" : "file"}
    />
  );
}

export { FileBlock };
