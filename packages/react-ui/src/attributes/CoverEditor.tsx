/** The cover's stand (the file id over the blob store: the thumbnail /
 *  the upload entry / the remove; the read-only stand stands the
 *  thumbnail display-only). */
import { useTranslation } from "react-i18next";

import { useRef } from "react";

import { useBlobFile } from "../blocks/use-blob-file";
import { useEditorContext } from "../editor-provider";
import { Button } from "../shared/ui/Button";
import { Image, X } from "../shared/ui/icons";

function CoverEditor({
  fileId,
  readOnly,
  onSet,
  onClear,
}: {
  fileId: string | undefined;
  readOnly: boolean;
  onSet: (id: string) => void;
  onClear: () => void;
}) {
  const { t } = useTranslation("editor");
  const { blobStore } = useEditorContext();
  const file = useBlobFile(fileId ?? "", (mimeType) => mimeType.startsWith("image/"));
  const inputRef = useRef<HTMLInputElement | null>(null);

  const onUpload = async (event: React.ChangeEvent<HTMLInputElement>): Promise<void> => {
    const fileInput = event.target.files?.[0];
    if (fileInput === undefined) return;
    try {
      const id = await blobStore.upload(fileInput);
      onSet(id);
    } finally {
      event.target.value = "";
    }
  };

  return (
    <div className="flex items-center gap-2">
      {fileId !== undefined && (file.status === "ready" || file.status === "ready-meta") ? (
        <span
          data-slot="docblocks/attributes-cover"
          className="block size-10 shrink-0 overflow-hidden rounded-md border bg-muted"
        >
          {file.status === "ready" ? <img src={file.url} alt="" className="size-full object-cover" /> : null}
        </span>
      ) : (
        <span data-slot="docblocks/attributes-cover" className="px-1.5 py-1 text-sm text-muted-foreground">
          {t("attributes.notSet")}
        </span>
      )}
      {readOnly ? null : (
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          className="hidden"
          aria-label={t("attributes.uploadCoverAria")}
          data-slot="docblocks/attributes-cover-upload"
          onChange={(event) => void onUpload(event)}
        />
      )}
      {readOnly ? null : (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={t("attributes.uploadCoverAria")}
          data-slot="docblocks/attributes-cover-upload-button"
          className="size-6 text-muted-foreground hover:text-foreground"
          onClick={() => inputRef.current?.click()}
        >
          <Image className="size-3.5" />
        </Button>
      )}
      {fileId !== undefined && !readOnly ? (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={t("attributes.removeCoverAria")}
          data-slot="docblocks/attributes-cover-remove"
          className="size-6 text-muted-foreground hover:text-foreground"
          onClick={onClear}
        >
          <X className="size-3.5" />
        </Button>
      ) : null}
    </div>
  );
}

export { CoverEditor };
