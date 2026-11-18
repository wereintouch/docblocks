/** The cover upload's modal (the portaled dialog over the row's upload
 *  entry): the placement mode's selector (the tile / the centering), the
 *  drop zone (the drag-and-drop's stand + the click's standard picker, the
 *  strict's png/jpeg/webp's accept), the mode's rule's info (the validation's
 *  gate over the upload), and the rejection's hint. The gate stands
 *  pre-upload: a rejected file's bytes never reach the consumer's store;
 *  the commit stands the id + the mode over the caller's write. */
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ChangeEvent, DragEvent, MouseEvent, RefObject } from "react";

import { useEditorContext } from "../editor-provider";
import { Button } from "../shared/ui/Button";
import { SegmentSelector } from "../shared/ui/SegmentSelector";
import { cn } from "../shared/ui/cn";
import { Image, X } from "../shared/ui/icons";
import { COVER_ACCEPTED_MIME_TYPES, COVER_MODE_ORDER, COVER_TILE_STRIP_HEIGHT_PX, validateCoverUpload } from "./cover";
import type { CoverMode } from "./cover";

/** The editor frame's selector (the editor width's source — the measured
 *  frame's box over the anchor's nearest editor root). */
const EDITOR_SELECTOR = '[data-slot="docblocks/editor"]';

/** The file picker's accept's list (the strict's gate's declarative's
 *  stand — the MIME's gate over the chosen file enforces the same
 *  vocabulary). */
const COVER_ACCEPTED_MIME_TYPES_LIST = COVER_ACCEPTED_MIME_TYPES.join(",");

/** The editor width's read over the anchor (the no-page / no-layout's
 *  stand keeps zero — the width gate's fail-open). */
function editorWidthOf(anchor: HTMLElement | null): number {
  const editor = anchor?.closest(EDITOR_SELECTOR) ?? null;
  if (editor === null) return 0;
  return Math.round(editor.getBoundingClientRect().width);
}

function CoverUploadModal({
  anchorRef,
  initialMode,
  onCommit,
  onClose,
}: {
  /** The row's zone (the editor width's measurement's anchor + the
   *  focus's return target over the close). */
  anchorRef: RefObject<HTMLElement | null>;
  /** The selector's initial mode (the doc's stored mode's stand). */
  initialMode: CoverMode;
  /** The commit's delivery (the fileId over the upload + the mode). */
  onCommit: (fileId: string, mode: CoverMode) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation("editor");
  const { blobStore } = useEditorContext();
  const [mode, setMode] = useState<CoverMode>(initialMode);
  const [dragOver, setDragOver] = useState(false);
  const [busy, setBusy] = useState(false);
  /** The rejection's hint (the gate's / the upload's failure's stand; the
   *  next attempt's start clears it). */
  const [error, setError] = useState<string | null>(null);

  const inputRef = useRef<HTMLInputElement | null>(null);
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const busyRef = useRef(false);
  busyRef.current = busy;
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  // The editor width's read over the open (the mode's rule's info's input
  // — the per-attempt's re-read stands over the gate, so a resize's stand
  // over the open's stand keeps the gate's live stand).
  const [editorWidth, setEditorWidth] = useState(0);
  useLayoutEffect(() => {
    setEditorWidth(editorWidthOf(anchorRef.current));
  }, [anchorRef]);

  // The focus's stand: the dialog's seat over the open, the anchor's
  // return over the close (the focus never strands over the removed
  // dialog). The anchor's `tabIndex={-1}`'s stand makes the zone's
  // programmatic focus's stand.
  useLayoutEffect(() => {
    dialogRef.current?.focus();
  }, []);
  useEffect(
    () => () => {
      if (anchorRef.current !== null && anchorRef.current.isConnected) {
        anchorRef.current.focus();
      }
    },
    [anchorRef]
  );

  // The Escape's close (the capture's stand over the document — the
  // editor's hotkey's scope never sees it).
  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent): void => {
      if (event.key === "Escape" && !busyRef.current) {
        event.stopPropagation();
        closeRef.current();
      }
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, []);

  const onOverlayMouseDown = (event: MouseEvent<HTMLDivElement>): void => {
    // The dialog's stand keeps the pointer (the overlay's own press's
    // stand closes; the dialog's interior's stand stays open).
    if (event.target === overlayRef.current && !busyRef.current) {
      closeRef.current();
    }
  };

  // The non-zone's drop's stand: the overlay's press over the dimmed's
  // area suppresses the browser's default (the dropped file's open), so
  // only the drop zone's stand delivers a file.
  const onOverlayDragOver = (event: DragEvent<HTMLDivElement>): void => {
    event.preventDefault();
  };
  const onOverlayDrop = (event: DragEvent<HTMLDivElement>): void => {
    event.preventDefault();
  };

  const handleFile = useCallback(
    async (file: File): Promise<void> => {
      setError(null);
      const width = editorWidthOf(anchorRef.current);
      const verdict = await validateCoverUpload(file, mode, width);
      if (!verdict.ok) {
        const hint =
          verdict.reason === "unsupported"
            ? t("attributes.coverUnsupportedType")
            : verdict.reason === "tooShort"
              ? t("attributes.coverTooShort", { min: COVER_TILE_STRIP_HEIGHT_PX })
              : t("attributes.coverTooNarrow", { min: width });
        setError(hint);
        return;
      }
      setBusy(true);
      try {
        const id = await blobStore.upload(file);
        onCommit(id, mode);
        onClose();
      } catch {
        // The upload's failure stands the hint's stand (the file's no
        // commit — the doc's no write).
        setError(t("attributes.coverUploadFailed"));
      } finally {
        setBusy(false);
      }
    },
    [anchorRef, blobStore, mode, onClose, onCommit, t]
  );

  const onInputChange = (event: ChangeEvent<HTMLInputElement>): void => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file !== undefined) void handleFile(file);
  };

  const onDrop = (event: DragEvent<HTMLButtonElement>): void => {
    event.preventDefault();
    setDragOver(false);
    const file = event.dataTransfer.files?.[0];
    if (file !== undefined) void handleFile(file);
  };

  const modeOptions = COVER_MODE_ORDER.map((value) => ({
    value,
    label: t(value === "tile" ? "attributes.coverModeTile" : "attributes.coverModeCenter"),
  }));

  return createPortal(
    <div
      ref={overlayRef}
      data-slot="docblocks/cover-upload"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onMouseDown={onOverlayMouseDown}
      onDragOver={onOverlayDragOver}
      onDrop={onOverlayDrop}
    >
      {/* The portaled content stands the standard tokens (the
          --docblocks-*'s scope ends at the editor's root). */}
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal
        aria-label={t("attributes.coverUploadTitle")}
        data-slot="docblocks/cover-upload-dialog"
        tabIndex={-1}
        className="
          w-100 max-w-full rounded-lg border border-border bg-popover p-4 text-foreground shadow-lg outline-none
        "
      >
        <div className="mb-3 flex items-center justify-between gap-2">
          <span className="text-sm font-medium">{t("attributes.coverUploadTitle")}</span>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={t("attributes.closeCoverUploadAria")}
            data-slot="docblocks/cover-upload-close"
            className="size-6 text-muted-foreground hover:bg-muted/50 hover:text-foreground dark:hover:bg-muted/50"
            onClick={() => {
              if (!busyRef.current) closeRef.current();
            }}
          >
            <X className="size-3.5" />
          </Button>
        </div>
        <SegmentSelector
          size="text"
          ariaLabel={t("attributes.coverMode")}
          slot="docblocks/cover-upload-mode"
          pillSlot="docblocks/cover-upload-mode-pill"
          buttonAttrName="mode"
          options={modeOptions}
          value={mode}
          onChange={(next) => {
            setMode(next);
            setError(null);
          }}
        />
        <input
          ref={inputRef}
          type="file"
          accept={COVER_ACCEPTED_MIME_TYPES_LIST}
          className="hidden"
          aria-label={t("attributes.coverUploadHint")}
          data-slot="docblocks/cover-upload-input"
          onChange={onInputChange}
        />
        <button
          type="button"
          data-slot="docblocks/cover-upload-dropzone"
          aria-label={t("attributes.coverUploadHint")}
          disabled={busy}
          className={cn(
            `
              mt-3 flex h-28 w-full flex-col items-center justify-center gap-1.5 rounded-md border border-dashed
              text-muted-foreground
            `,
            "hover:bg-muted/50",
            dragOver && "border-primary bg-accent/50 text-foreground",
            busy && "opacity-60"
          )}
          onClick={() => {
            if (!busyRef.current) inputRef.current?.click();
          }}
          onDragOver={(event) => {
            event.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
        >
          <Image className="size-5" />
          <span className="px-3 text-center text-xs">{t("attributes.coverUploadHint")}</span>
        </button>
        <p data-slot="docblocks/cover-upload-info" className="mt-2 text-xs text-muted-foreground">
          {mode === "tile"
            ? t("attributes.coverInfoMinHeight", { min: COVER_TILE_STRIP_HEIGHT_PX })
            : t("attributes.coverInfoMinWidth", { min: editorWidth })}
        </p>
        {error !== null ? (
          <p data-slot="docblocks/cover-upload-error" role="alert" className="mt-2 text-xs text-destructive">
            {error}
          </p>
        ) : null}
      </div>
    </div>,
    document.body
  );
}

export { CoverUploadModal };
