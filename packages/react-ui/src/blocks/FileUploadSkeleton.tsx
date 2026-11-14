/** The slash File command's upload stand: while the popover stands closed
 * over the pending file (the OS dialog's open, the in-flight upload), the
 * phrase block's row stands the skeleton (the spinner's rotation) instead
 * of its content. The refused upload's failed stand stands the error line
 * (the stand's click dismisses it — the phrase's row returns). View stand
 * only: the doc stands untouched until the upload's commit. */
import { useTranslation } from "react-i18next";

import type { BlockId } from "docblocks-core";

import { useEditorContext } from "../editor-provider";
import { Skeleton } from "../shared/ui/Skeleton";
import { cn } from "../shared/ui/cn";
import { LoaderCircle } from "../shared/ui/icons";
import type { FileUploadStand } from "../state";

function FileUploadSkeleton({ id, stand }: { id: BlockId; stand: FileUploadStand }) {
  const { t } = useTranslation("slash");
  const { store } = useEditorContext();
  const failed = stand.phase === "failed";
  return (
    <div
      data-slot="docblocks/file-upload-skeleton"
      data-block-id={id}
      data-state={stand.phase}
      aria-busy={!failed || undefined}
      className={cn("relative mx-0 my-(--docblocks-block-spacing) h-8 w-full", failed && "cursor-pointer")}
      onClick={failed ? () => store.getState().setFileUpload(null) : undefined}
    >
      <Skeleton className="absolute inset-0 rounded-(--docblocks-radius)" />
      <div className="absolute inset-0 flex items-center justify-center">
        {failed ? (
          <span data-slot="docblocks/slash-file-error" role="alert" className="text-xs text-destructive">
            {t("file.uploadFailed")}
          </span>
        ) : (
          <LoaderCircle className="size-4 animate-spin" />
        )}
      </div>
    </div>
  );
}

export { FileUploadSkeleton };
