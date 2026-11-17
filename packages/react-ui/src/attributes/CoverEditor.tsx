/** The cover's stand (the file id over the blob store: the thumbnail /
 *  the upload entry / the remove; the read-only stand stands the
 *  thumbnail display-only). The upload's gate: the image's intrinsic
 *  height check (a cover shorter than the minimum stands rejected —
 *  the bytes never reach the consumer's store; the undecodable payload
 *  stands the fail-open). */
import { useTranslation } from "react-i18next";

import { useRef, useState } from "react";

import { useBlobFile } from "../blocks/use-blob-file";
import { useEditorContext } from "../editor-provider";
import { Button } from "../shared/ui/Button";
import { Image, X } from "../shared/ui/icons";

/** The cover's renderable-MIME's predicate. A module-level const keeps the
 *  predicate's identity stable (the resolution's effect's dep — an inline
 *  arrow re-runs the effect on every render). */
const COVER_RENDERS_BYTES = (mimeType: string): boolean => mimeType.startsWith("image/");

/** The cover upload's minimum intrinsic height (CSS px). */
const MIN_COVER_HEIGHT_PX = 150;

/** The image's intrinsic pixel dimensions. */
interface ImageDimensions {
  width: number;
  height: number;
}

/**
 * The intrinsic dimensions over a decodable image blob (the
 * `createImageBitmap` decode probe — the bytes are never rendered).
 * `null` over an undecodable payload (the fail-open: the consumer's
 * renderer may accept a format the browser cannot probe).
 */
async function readImageDimensions(file: Blob): Promise<ImageDimensions | null> {
  try {
    const bitmap = await createImageBitmap(file);
    try {
      return { width: bitmap.width, height: bitmap.height };
    } finally {
      bitmap.close();
    }
  } catch {
    return null;
  }
}

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
  const file = useBlobFile(fileId ?? "", COVER_RENDERS_BYTES);
  const inputRef = useRef<HTMLInputElement | null>(null);
  /** The rejected upload's hint (the short image's stand; the next
   *  attempt's start clears it). */
  const [error, setError] = useState<string | null>(null);

  const onUpload = async (event: React.ChangeEvent<HTMLInputElement>): Promise<void> => {
    const fileInput = event.target.files?.[0];
    if (fileInput === undefined) return;
    try {
      // The height gate stands pre-upload: the rejected image's bytes
      // never reach the consumer's store.
      const dimensions = await readImageDimensions(fileInput);
      if (dimensions !== null && dimensions.height < MIN_COVER_HEIGHT_PX) {
        setError(t("attributes.coverTooShort", { min: MIN_COVER_HEIGHT_PX }));
        return;
      }
      setError(null);
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
          className="size-6 text-muted-foreground hover:bg-muted/50 hover:text-foreground dark:hover:bg-muted/50"
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
          className="size-6 text-muted-foreground hover:bg-muted/50 hover:text-foreground dark:hover:bg-muted/50"
          onClick={onClear}
        >
          <X className="size-3.5" />
        </Button>
      ) : null}
      {error !== null ? (
        <span data-slot="docblocks/attributes-cover-error" role="alert" className="min-w-0 flex-1 text-xs text-destructive">
          {error}
        </span>
      ) : null}
    </div>
  );
}

export { CoverEditor };
