/**
 * The image figure (the image subtype): the <img> over the resolved blob's
 * url (the `width` attr's stand — the aspect ratio's follow, the editor's
 * width's upper bound), the blocks' selection over the click / the focus
 * (the gutter's idiom — the Shift's extension), the four corner ports (the
 * resize session — `use-image-resize`), the hover's menu (the download / the
 * caption / the align's controls — `ImageMenu`), and the caption's line (the
 * `caption` attr).
 */
import { useTranslation } from "react-i18next";
import { useStore } from "zustand";

import { useContext, useRef } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";

import type { BlockId, ImageBlock as ImageBlockType } from "docblocks-core";

import { CANVAS_SELECTION_OUTLINE } from "../canvas/canvas-view/constants";
import { useEditorContext } from "../editor-provider";
import { BlockContext } from "../shared/providers/block-context";
import { cn } from "../shared/ui/cn";
import { preventDefault } from "../shared/utils";
import { BlockCaption } from "./BlockCaption";
import { ImageMenu } from "./ImageMenu";
import { IMAGE_PORT_CORNERS, useImageResize } from "./use-image-resize";

/**
 * The image figure's width: the `width` attr is the display width in px (the
 * aspect ratio stands — the height follows); the absent / `null` width is
 * the editor's full width, and the figure never stands wider than the editor
 * (the `max-width` clamp).
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
 */
function ImageFigure({
  id,
  block,
  url,
  name,
  width,
  height,
}: {
  id: BlockId;
  block: ImageBlockType;
  url: string;
  name?: string;
  /** The store's intrinsic width/height (the image's box reservation — no
   *  layout shift over the decode). */
  width?: number;
  height?: number;
}) {
  const { t } = useTranslation("blocks");
  const { doc, store, selection: selectionRef } = useEditorContext();
  const blockContext = useContext(BlockContext);
  const selected = useStore(store, (state) => state.selection.kind === "blocks" && state.selection.ids.includes(id));
  const figureRef = useRef<HTMLDivElement | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  // The corner ports' resize session (the canvas session's contract — the
  // live's width's preview over the release's commit's stand, the no-op /
  // sub-threshold drag's no-command).
  const { dragWidth, onPortPointerDown, onPortPointerMove, onPortPointerUp, onPortKeyDown } = useImageResize({
    id,
    block,
    figureRef,
    imgRef,
  });

  const widthValue =
    dragWidth !== null ? `${dragWidth}px` : block.attrs.width != null ? `${block.attrs.width}px` : "100%";
  const align = block.attrs.align ?? "left";
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

  /** The figure's keyboard focus seats the selection (the ports' + the menu's
   * stand — the keyboard's resize + the menu's reveal stand on the selected
   * figure). */
  const onFigureFocus = (): void => {
    const view = selectionRef.view;
    if (view === null) return;
    view.set({ kind: "blocks", ids: [id], anchorId: id });
  };

  return (
    <>
      <div
        ref={figureRef}
        data-slot="docblocks/image-figure"
        data-align={align}
        data-selected={selected ? "true" : undefined}
        tabIndex={0}
        // The island's boundary: the figure is chrome, never text (the
        // caret and the selection never stand in it).
        contentEditable={false}
        className={cn(
          "group relative",
          alignClass,
          "outline-none",
          // The canvas selection's token (the shared selection outline).
          selected && CANVAS_SELECTION_OUTLINE,
          // The keyboard focus's stand (the dashed outline — distinct from
          // the selection's solid stand, the canvas items' idiom).
          `
            focus-visible:outline-(length:--docblocks-canvas-selection-border-width) focus-visible:outline-offset-1
            focus-visible:outline-(--docblocks-canvas-selection-border-color) focus-visible:outline-dashed
          `
        )}
        // Keep the caret: a default mousedown would move the focus out of the
        // editable (the figure is chrome, never text).
        onMouseDown={preventDefault}
        onClick={onFigureClick}
        onFocus={onFigureFocus}
      >
        <img
          ref={imgRef}
          data-slot="docblocks/image"
          data-block-type="image"
          data-block-id={id}
          data-subtype="image"
          src={url}
          alt=""
          // The intrinsic dimensions reserve the box before the decode (the
          // CSS width's 100% and the height's auto keep the rendered scale).
          width={width}
          height={height}
          // The bytes are library-resolved (the object URL exists before the
          // element mounts), so the native lazy loading defers the decode,
          // not the fetch; the async decode keeps it off the main thread.
          loading="lazy"
          decoding="async"
          draggable={false}
          className="block h-auto max-w-full rounded-(--docblocks-image-radius)"
          style={{ width: widthValue }}
        />
        {selected &&
          IMAGE_PORT_CORNERS.map(({ corner, cursor }) => (
            <button
              key={corner}
              type="button"
              data-slot="docblocks/image-port"
              data-corner={corner}
              aria-label={t("image.resize")}
              className={cn(
                "pointer-events-auto absolute z-10 size-2.5 rounded-full",
                "border border-(--docblocks-formatbar-border-color) bg-(--docblocks-canvas-selection-border-color)",
                // The keyboard focus's stand (the dashed outline — the port's
                // a resize control, not a click).
                `
                  outline-none
                  focus-visible:outline-2 focus-visible:outline-offset-1
                  focus-visible:outline-(--docblocks-canvas-selection-border-color) focus-visible:outline-dashed
                `,
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
              onKeyDown={onPortKeyDown(corner)}
            />
          ))}
        <ImageMenu id={id} block={block} url={url} name={name} />
      </div>
      <BlockCaption
        id={id}
        caption={block.attrs.caption ?? ""}
        slot="docblocks/image-caption"
        ariaLabel={t("caption.imageAria")}
        placeholder={t("caption.placeholder")}
      />
    </>
  );
}

export { ImageFigure };
