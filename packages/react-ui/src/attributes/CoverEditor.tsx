/** The cover's row's control (the file id's thumbnail / the upload's
 *  entry / the remove; the read-only stand stands the thumbnail
 *  display-only). The upload's entry opens the modal (the mode's
 *  selector + the drop zone + the gate's stands live over it). */
import { useTranslation } from "react-i18next";

import { useRef, useState } from "react";

import { useBlobFile } from "../blocks/use-blob-file";
import { Button } from "../shared/ui/Button";
import { Image, X } from "../shared/ui/icons";
import { CoverUploadModal } from "./CoverUploadModal";
import { COVER_RENDERS_BYTES } from "./cover";
import type { CoverMode } from "./cover";

function CoverEditor({
  fileId,
  mode,
  readOnly,
  onCommit,
  onClear,
}: {
  fileId: string | undefined;
  /** The doc's stored mode (the modal's selector's initial's stand). */
  mode: CoverMode;
  readOnly: boolean;
  onCommit: (fileId: string, mode: CoverMode) => void;
  onClear: () => void;
}) {
  const { t } = useTranslation("editor");
  const file = useBlobFile(fileId ?? "", COVER_RENDERS_BYTES);
  const [open, setOpen] = useState(false);
  // The modal's anchor zone (the editor width's measurement's source + the
  // focus's return's stand) and the modal's open's stand.
  const anchorRef = useRef<HTMLDivElement | null>(null);

  return (
    <div ref={anchorRef} tabIndex={-1} className="flex min-w-0 items-center gap-2 outline-none">
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
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={t("attributes.uploadCoverAria")}
          data-slot="docblocks/attributes-cover-upload-button"
          className="size-6 text-muted-foreground hover:bg-muted/50 hover:text-foreground dark:hover:bg-muted/50"
          onClick={() => setOpen(true)}
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
      {open && !readOnly ? (
        <CoverUploadModal anchorRef={anchorRef} initialMode={mode} onCommit={onCommit} onClose={() => setOpen(false)} />
      ) : null}
    </div>
  );
}

export { CoverEditor };
