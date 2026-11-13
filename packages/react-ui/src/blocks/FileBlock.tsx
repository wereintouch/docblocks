import { useTranslation } from "react-i18next";

import type { BlockId, FileBlock as FileBlockType } from "docblocks-core";

import { useEditorContext } from "../editor-provider";
import { PDF_VIEWER_SANDBOX, isEmbeddablePdfUrl } from "../pdf/constants";
import { Card, CardContent } from "../shared/ui/Card";
import { File as FileIcon } from "../shared/ui/icons";
import { FileCard } from "./FileCard";
import { BLOB_PLACEHOLDER_CLASS } from "./blob-styles";
import { useBlobFile } from "./use-blob-file";

/** A consumer-owned file: the document carries only its file id. */
function FileBlock({ id, block }: { id: BlockId; block: FileBlockType }) {
  const { t } = useTranslation("blocks");
  const { pdfPreview } = useEditorContext();
  const fileId = block.attrs.fileId;
  const view = useBlobFile(fileId);

  if (view === null) {
    return (
      <Card
        data-slot="docblocks/file-placeholder"
        data-block-type="file"
        data-block-id={id}
        className={BLOB_PLACEHOLDER_CLASS}
      >
        <CardContent className="flex flex-col items-center gap-2 text-center">
          <FileIcon className="size-6" />
          {t("file.placeholder")}
        </CardContent>
      </Card>
    );
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
