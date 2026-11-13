import { useTranslation } from "react-i18next";

import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";

import type { BlockId, ImageBlock } from "docblocks-core";

import { useEditorContext } from "../editor-provider";
import { Button } from "../shared/ui/Button";
import { Card, CardContent } from "../shared/ui/Card";
import { Input } from "../shared/ui/Input";
import { Download, File, Pen } from "../shared/ui/icons";
import { isSafeDownloadHref } from "../shared/utils";

interface FileCardProps {
  id: BlockId;
  block: ImageBlock;
  url: string;
  name?: string;
  subtype: "file" | "pdf";
}

/** A downloadable blob card with a document-backed display name. */
function FileCard({ id, block, url, name, subtype }: FileCardProps) {
  const { t } = useTranslation("blocks");
  const { blobStore, doc, viewMode } = useEditorContext();
  const displayName = name ?? block.attrs.src;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(displayName);
  const [renameFailed, setRenameFailed] = useState(false);
  const cancelledRef = useRef(false);
  const mountedRef = useRef(true);
  const operationRef = useRef(0);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const beginRename = (): void => {
    cancelledRef.current = false;
    setDraft(displayName);
    setRenameFailed(false);
    setEditing(true);
  };

  const commitRename = async (): Promise<void> => {
    if (cancelledRef.current) {
      cancelledRef.current = false;
      return;
    }
    const nextName = draft.trim();
    setEditing(false);
    if (nextName === "" || nextName === displayName) {
      setDraft(displayName);
      return;
    }

    const operation = ++operationRef.current;
    try {
      doc.updateBlock(id, { name: nextName });
      setRenameFailed(false);
      await blobStore.rename?.(block.attrs.src, nextName);
    } catch {
      if (mountedRef.current && operation === operationRef.current) setRenameFailed(true);
    }
  };

  const changeDraft = (event: React.ChangeEvent<HTMLInputElement>): void => {
    setDraft(event.target.value);
  };

  const selectDraft = (event: React.FocusEvent<HTMLInputElement>): void => {
    event.currentTarget.select();
  };

  const finishOnKey = (event: ReactKeyboardEvent<HTMLInputElement>): void => {
    if (event.key === "Enter") {
      event.preventDefault();
      event.currentTarget.blur();
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      cancelledRef.current = true;
      setDraft(displayName);
      setEditing(false);
    }
  };

  const blurRename = (): void => {
    void commitRename();
  };

  return (
    <Card
      data-slot="docblocks/image-file"
      data-block-type="image"
      data-block-id={id}
      data-subtype={subtype}
      contentEditable={false}
      className="
        mx-0 my-(--docblocks-block-spacing) gap-0 rounded-(--docblocks-radius)
        border-(length:--docblocks-table-border-width) border-(--docblocks-table-border-color) py-0 shadow-none
        outline-none
      "
    >
      <CardContent className="flex items-center gap-3 px-4 py-3">
        <File data-slot="docblocks/file-icon" className="size-5 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          {editing ? (
            <Input
              autoFocus
              size="sm"
              data-slot="docblocks/file-name-input"
              aria-label={t("file.name")}
              value={draft}
              onChange={changeDraft}
              onFocus={selectDraft}
              onKeyDown={finishOnKey}
              onBlur={blurRename}
            />
          ) : (
            <span data-slot="docblocks/file-name" title={displayName} className="block truncate text-sm font-medium">
              {displayName}
            </span>
          )}
          {renameFailed ? (
            <span role="alert" className="mt-1 block text-xs text-destructive">
              {t("file.renameFailed")}
            </span>
          ) : null}
        </div>
        {!viewMode && !editing ? (
          <Button
            variant="ghost"
            size="icon"
            data-slot="docblocks/file-rename"
            aria-label={t("file.rename")}
            title={t("file.rename")}
            className="size-8"
            onClick={beginRename}
          >
            <Pen className="size-4" />
          </Button>
        ) : null}
        <Button variant="ghost" size="icon" asChild className="size-8">
          {isSafeDownloadHref(url) ? (
            <a
              href={url}
              download={displayName}
              data-slot="docblocks/file-download"
              aria-label={t("file.download")}
              title={t("file.download")}
            >
              <Download className="size-4" />
            </a>
          ) : (
            <button
              type="button"
              disabled
              data-slot="docblocks/file-download"
              aria-label={t("file.download")}
              title={t("file.download")}
            >
              <Download className="size-4" />
            </button>
          )}
        </Button>
      </CardContent>
    </Card>
  );
}

export { FileCard };
