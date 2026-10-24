import { useStore } from "zustand";

import { useContext, useEffect, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from "react";

import type { BlockId, ImageBlock as ImageBlockType, TextAlign } from "docblocks-core";

import { useEditorContext } from "../EditorProvider";
import type { BlobRef } from "../blob-store";
import { Button } from "../shared/ui/Button";
import { Card, CardContent } from "../shared/ui/Card";
import { cn } from "../shared/ui/cn";
import {
  Captions,
  Download,
  Image as ImageIcon,
  TextAlignCenter,
  TextAlignEnd,
  TextAlignStart,
} from "../shared/ui/icons";
import { BlockCaption, requestBlockCaption } from "./BlockCaption";
import { BlockContext } from "./block-context";

/** The placeholder card's shared classes (the unknown-key and loading states). */
const PLACEHOLDER_CLASS = `
  mx-0 my-(--docblocks-block-spacing) rounded-(--docblocks-radius)
  border-(length:--docblocks-table-border-width) border-dashed border-(--docblocks-table-border-color)
  outline-none
`;

/** The figure's minimum display width (the port drag's floor; px). */
const MIN_IMAGE_WIDTH_PX = 20;

/** The drag's commit threshold (px): a sub-threshold drag issues no command. */
const COMMIT_THRESHOLD_PX = 2;

/** The image's align controls, in display order (the format toolbar's set). */
const IMAGE_ALIGNS: { align: TextAlign; title: string; icon: typeof TextAlignStart }[] = [
  { align: "left", title: "Align left", icon: TextAlignStart },
  { align: "center", title: "Align center", icon: TextAlignCenter },
  { align: "right", title: "Align right", icon: TextAlignEnd },
];

/** The corner port's corner (the resize session's drag anchor). */
type ImagePortCorner = "nw" | "ne" | "sw" | "se";

/** The four corner ports (the cursor per the corner's diagonal). */
const IMAGE_PORT_CORNERS: { corner: ImagePortCorner; cursor: string }[] = [
  { corner: "nw", cursor: "cursor-nwse-resize" },
  { corner: "ne", cursor: "cursor-nesw-resize" },
  { corner: "sw", cursor: "cursor-nesw-resize" },
  { corner: "se", cursor: "cursor-nwse-resize" },
];

/**
 * An image: the <img> src comes from the consumer's blob store (the key is
 * opaque; resolution is a consumer-side concern). The store's metadata
 * decides the rendering — the block never guesses: an image subtype
 * stands the <img>, a pdf an iframe viewer, a file the download card.
 * While the key is unknown (or the resolve is in flight) the block renders
 * a structural placeholder card instead of a broken <img>.
 */
function ImageBlock({ id, block }: { id: BlockId; block: ImageBlockType }) {
  const { blobStore, pdfPreview } = useEditorContext();
  const src = block.attrs.src;
  const [ref, setRef] = useState<BlobRef | null>(null);

  // The async resolve (store-driven): a stale result never lands — the
  // effect re-runs on the src or store change and drops the pending one.
  useEffect(() => {
    let alive = true;
    setRef(null);
    blobStore
      .resolve(src)
      .then((resolved) => {
        if (alive) setRef(resolved);
      })
      .catch(() => {
        if (alive) setRef(null);
      });
    return () => {
      alive = false;
    };
  }, [blobStore, src]);

  if (ref === null) {
    return (
      <Card
        data-slot="docblocks/image-placeholder"
        data-block-type="image"
        data-block-id={id}
        className={PLACEHOLDER_CLASS}
      >
        <CardContent className="flex flex-col items-center gap-2 text-center">
          <ImageIcon className="size-6" />
          image
        </CardContent>
      </Card>
    );
  }

  const { url, meta } = ref;
  if (meta.subtype === "pdf") {
    // The consumer's PDF preview renderer (the `pdfPreview` provider prop)
    // takes over the whole figure; without it the native iframe stands.
    if (pdfPreview !== null) {
      const Preview = pdfPreview;
      return <Preview id={id} url={url} name={meta.name} />;
    }
    return (
      <iframe
        data-slot="docblocks/image-pdf"
        data-block-type="image"
        data-block-id={id}
        data-subtype="pdf"
        src={url}
        title={meta.name ?? "document"}
        className="
          my-(--docblocks-block-spacing) block aspect-video w-full rounded-(--docblocks-image-radius)
          border-(length:--docblocks-table-border-width) border-(--docblocks-table-border-color) outline-none
        "
      />
    );
  }
  if (meta.subtype === "file") {
    return (
      <Card
        data-slot="docblocks/image-file"
        data-block-type="image"
        data-block-id={id}
        data-subtype="file"
        className={PLACEHOLDER_CLASS}
      >
        <CardContent className="flex items-center justify-center gap-2">
          <ImageIcon className="size-4 shrink-0" />
          <a href={url} download={meta.name ?? src} className="max-w-60 truncate text-sm underline underline-offset-2">
            {meta.name ?? src}
          </a>
        </CardContent>
      </Card>
    );
  }
  return <ImageFigure id={id} block={block} url={url} name={meta.name} />;
}

/**
 * The image figure (the image subtype). The width: the `width` attr is the
 * display width in px (the aspect ratio stands — the height follows); the
 * absent / `null` width is the editor's full width, and the figure never
 * stands wider than the editor (the `max-width` clamp).
 *
 * The selection: a click on the figure is the blocks selection (the
 * gutter's idiom — the plain click seats one block, the Shift-click
 * extends from the anchor over the siblings). The selected figure stands
 * the canvas selection token's outline (the shared token) and the four
 * corner ports.
 *
 * The corner ports are the resize session (the canvas session's contract):
 * the in-flight width is pure view state (the doc stands as it is), and
 * one `updateBlock({ width })` commits on the release — one undo step, one
 * wire update. A no-op / sub-threshold drag issues no command. The drag
 * keeps the aspect ratio (the width only) and the editor's content width
 * is the upper bound (the figure never stretches past the editor).
 *
 * The hover menu (top-right over the figure; the code header's controls
 * idiom — the hover reveal): the download (the resolved url, the
 * `download` attribute), the caption (the code block's caption mechanism —
 * the `caption` attr), and the three align controls
 * (`updateBlock({ align })` — "left" restores the absent attr).
 */
function ImageFigure({ id, block, url, name }: { id: BlockId; block: ImageBlockType; url: string; name?: string }) {
  const { doc, store, selection: selectionRef } = useEditorContext();
  const blockContext = useContext(BlockContext);
  const selected = useStore(store, (state) => state.selection.kind === "blocks" && state.selection.ids.includes(id));
  const align = block.attrs.align ?? "left";
  const [dragWidth, setDragWidth] = useState<number | null>(null);
  const dragWidthRef = useRef<number | null>(null);
  const dragRef = useRef<{ startX: number; startWidth: number; max: number; corner: ImagePortCorner } | null>(null);
  const figureRef = useRef<HTMLDivElement | null>(null);

  const setPreview = (value: number | null): void => {
    dragWidthRef.current = value;
    setDragWidth(value);
  };

  const widthValue =
    dragWidth !== null ? `${dragWidth}px` : block.attrs.width != null ? `${block.attrs.width}px` : "100%";
  // The figure's horizontal placement (the align attr at a reduced width;
  // the full width ignores it — there is nothing to place).
  const alignClass = align === "center" ? "mx-auto" : align === "right" ? "ml-auto" : "mr-auto";

  /** The click's blocks selection (the gutter's idiom: the plain click seats
   *  one block, the Shift-click extends from the anchor over the siblings). */
  const onFigureClick = (event: ReactMouseEvent<HTMLDivElement>): void => {
    const view = selectionRef.view;
    if (view === null) return;
    const current = view.get();
    if (event.shiftKey && current.kind === "blocks" && blockContext !== null) {
      const siblings = doc.getChildren(blockContext.parentId);
      const anchorIndex = siblings.indexOf(current.anchorId);
      const hereIndex = siblings.indexOf(id);
      if (anchorIndex !== -1 && hereIndex !== -1) {
        const [low, high] = anchorIndex <= hereIndex ? [anchorIndex, hereIndex] : [hereIndex, anchorIndex];
        view.set({ kind: "blocks", ids: siblings.slice(low, high + 1), anchorId: current.anchorId });
      } else {
        view.set({ kind: "blocks", ids: [id], anchorId: id });
      }
    } else {
      view.set({ kind: "blocks", ids: [id], anchorId: id });
    }
    // The figure takes the focus: the selection's keys (Delete/Backspace/
    // Escape) bubble to the editor root's handler.
    figureRef.current?.focus();
  };

  /** The port press starts the resize session (the pointer capture stays on the port). */
  const onPortPointerDown =
    (corner: ImagePortCorner) =>
    (event: ReactPointerEvent<HTMLDivElement>): void => {
      const figure = figureRef.current;
      if (figure === null) return;
      event.stopPropagation();
      event.preventDefault();
      const rect = figure.getBoundingClientRect();
      // The editor's content width (the row's content box — the row carries
      // the indent padding; the editor root in the base view): the figure's
      // upper bound, so the drag never stretches the figure past the editor.
      const row = figure.closest<HTMLElement>('[data-slot="docblocks/row"]');
      const scope = row ?? figure.closest('[data-slot="docblocks/editor"]');
      let max = rect.width;
      if (scope !== null) {
        const scopeStyle = window.getComputedStyle(scope);
        const content =
          scope.getBoundingClientRect().width -
          (parseFloat(scopeStyle.paddingLeft) || 0) -
          (parseFloat(scopeStyle.paddingRight) || 0);
        if (content > 0) max = content;
      }
      dragRef.current = {
        startX: event.clientX,
        startWidth: rect.width,
        max: Math.max(max, rect.width, MIN_IMAGE_WIDTH_PX),
        corner,
      };
      setPreview(rect.width);
      event.currentTarget.setPointerCapture?.(event.pointerId);
      (row ?? figure).focus();
    };

  /** The session's live width (pure view state — the doc stands as it is). */
  const onPortPointerMove = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const drag = dragRef.current;
    if (drag === null) return;
    const dx = event.clientX - drag.startX;
    const next = drag.corner === "ne" || drag.corner === "se" ? drag.startWidth + dx : drag.startWidth - dx;
    setPreview(Math.min(drag.max, Math.max(MIN_IMAGE_WIDTH_PX, next)));
  };

  /** The release commits one `updateBlock` (a no-op / sub-threshold drag issues nothing). */
  const onPortPointerUp = (): void => {
    const drag = dragRef.current;
    if (drag === null) return;
    dragRef.current = null;
    const width = dragWidthRef.current;
    setPreview(null);
    if (width === null || Math.abs(width - drag.startWidth) < COMMIT_THRESHOLD_PX) return;
    doc.updateBlock(id, { width: Math.round(width) });
  };

  return (
    <>
      <div
        ref={figureRef}
        data-slot="docblocks/image-figure"
        data-align={align}
        data-selected={selected ? "true" : undefined}
        tabIndex={0}
        className={cn(
          "group relative",
          alignClass,
          "outline-none",
          // The canvas selection's token (the shared selection outline).
          selected &&
            `
              outline-(length:--docblocks-canvas-selection-border-width) outline-offset-1
              outline-(--docblocks-canvas-selection-border-color) outline-solid
            `
        )}
        // Keep the caret: a default mousedown would move the focus out of the
        // editable (the figure is chrome, never text).
        onMouseDown={(event) => event.preventDefault()}
        onClick={onFigureClick}
      >
        <img
          data-slot="docblocks/image"
          data-block-type="image"
          data-block-id={id}
          data-subtype="image"
          src={url}
          alt=""
          draggable={false}
          className="block h-auto max-w-full rounded-(--docblocks-image-radius)"
          style={{ width: widthValue }}
        />
        {selected &&
          IMAGE_PORT_CORNERS.map(({ corner, cursor }) => (
            <div
              key={corner}
              data-slot="docblocks/image-port"
              data-corner={corner}
              className={cn(
                "pointer-events-auto absolute z-10 size-2.5 rounded-full",
                "border border-(--docblocks-formatbar-border-color) bg-(--docblocks-canvas-selection-border-color)",
                cursor
              )}
              style={{
                left: corner.endsWith("w") ? "0" : "100%",
                top: corner.startsWith("n") ? "0" : "100%",
                // The left / top property stands the port's left edge at the
                // corner: the -50% translate centers the port on the corner.
                transform: "translate(-50%, -50%)",
              }}
              onPointerDown={onPortPointerDown(corner)}
              onPointerMove={onPortPointerMove}
              onPointerUp={onPortPointerUp}
              onPointerCancel={onPortPointerUp}
            />
          ))}
        <div
          data-slot="docblocks/image-menu"
          className={cn(
            "pointer-events-none absolute -top-9 right-0 z-20 flex items-center gap-0.5 rounded-(--docblocks-radius)",
            "p-0.5",
            "border-(length:--docblocks-table-border-width) border-(--docblocks-table-border-color)",
            "bg-(--docblocks-page-card-background) shadow-(--docblocks-formatbar-shadow)",
            // The hover reveal (the code header's controls idiom): invisible
            // and unclickable unless the figure is hovered.
            "opacity-0 transition-opacity group-hover:pointer-events-auto group-hover:opacity-100"
          )}
          // Keep the caret: the menu is chrome (a default mousedown would
          // move the focus out of the editable).
          onMouseDown={(event) => event.preventDefault()}
        >
          <Button variant="ghost" size="icon" asChild className="size-7">
            <a
              href={url}
              download={name ?? block.attrs.src}
              data-slot="docblocks/image-download"
              aria-label="Download the image"
              title="Download"
            >
              <Download className="size-4" />
            </a>
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            data-slot="docblocks/image-caption-toggle"
            aria-label={block.attrs.caption ? "Edit the caption" : "Add a caption"}
            title="Caption"
            className="size-7"
            onClick={() => requestBlockCaption(store, id)}
          >
            <Captions className="size-4" />
          </Button>
          <span aria-hidden className="mx-0.5 h-4 w-px bg-(--docblocks-table-border-color)" />
          {IMAGE_ALIGNS.map(({ align: value, title, icon: Icon }) => (
            <Button
              key={value}
              type="button"
              variant="ghost"
              size="icon"
              data-slot="docblocks/image-align"
              data-align={value}
              data-active={align === value ? "true" : undefined}
              aria-label={title}
              title={title}
              aria-pressed={align === value}
              className={cn("size-7", align === value && "bg-accent text-accent-foreground")}
              onClick={() => {
                if (align === value) return;
                doc.updateBlock(id, { align: value });
              }}
            >
              <Icon className="size-4" />
            </Button>
          ))}
        </div>
      </div>
      <BlockCaption
        id={id}
        caption={block.attrs.caption ?? ""}
        slot="docblocks/image-caption"
        ariaLabel="Image caption"
        placeholder="Write a caption…"
      />
    </>
  );
}

export { ImageBlock };
