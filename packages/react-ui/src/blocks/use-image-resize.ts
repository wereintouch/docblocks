/**
 * The image figure's corner ports' resize session (the canvas session's
 * contract): the press's pointer capture over the port, the live's width's
 * preview (pure view state — the doc stands as it is), the release's commit
 * (one `updateBlock({ width })` — one undo step, one wire update; a no-op /
 * sub-threshold drag issues no command), and the keyboard's arrows' nudge
 * (the step's clamp over the figure's range, the image's current's width's
 * baseline).
 */
import { useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent, RefObject } from "react";

import type { BlockId, ImageBlock as ImageBlockType } from "docblocks-core";

import { useEditorContext } from "../editor-provider";
import { clamp } from "../shared/utils";

/** The figure's minimum display width (the port drag's floor; px). */
const MIN_IMAGE_WIDTH_PX = 20;

/** The drag's commit threshold (px): a sub-threshold drag issues no command. */
const COMMIT_THRESHOLD_PX = 2;
/** The port's keyboard resize's step (the arrows' width's nudge per press). */
const IMAGE_KEYBOARD_RESIZE_STEP_PX = 10;

/** The corner port's corner (the resize session's drag anchor). */
type ImagePortCorner = "nw" | "ne" | "sw" | "se";

/** The four corner ports (the cursor per the corner's diagonal). */
const IMAGE_PORT_CORNERS: { corner: ImagePortCorner; cursor: string }[] = [
  { corner: "nw", cursor: "cursor-nwse-resize" },
  { corner: "ne", cursor: "cursor-nesw-resize" },
  { corner: "sw", cursor: "cursor-nesw-resize" },
  { corner: "se", cursor: "cursor-nwse-resize" },
];

interface UseImageResizeArgs {
  id: BlockId;
  block: ImageBlockType;
  /** The figure's ref (the press's geometry + the upper width bound's measure). */
  figureRef: RefObject<HTMLDivElement | null>;
  /** The image's ref (the keyboard resize's baseline over the absent width). */
  imgRef: RefObject<HTMLImageElement | null>;
}

interface UseImageResizeResult {
  dragWidth: number | null;
  onPortPointerDown: (corner: ImagePortCorner) => (event: ReactPointerEvent<HTMLElement>) => void;
  onPortPointerMove: (event: ReactPointerEvent<HTMLElement>) => void;
  onPortPointerUp: () => void;
  onPortKeyDown: (corner: ImagePortCorner) => (event: ReactKeyboardEvent<HTMLElement>) => void;
}

function useImageResize({ id, block, figureRef, imgRef }: UseImageResizeArgs): UseImageResizeResult {
  const { doc } = useEditorContext();
  const [dragWidth, setDragWidth] = useState<number | null>(null);
  const dragWidthRef = useRef<number | null>(null);
  const dragRef = useRef<{ startX: number; startWidth: number; max: number; corner: ImagePortCorner } | null>(null);

  const setPreview = (value: number | null): void => {
    dragWidthRef.current = value;
    setDragWidth(value);
  };

  /** The figure's upper width bound (the editor's content width — the row's
   * content box over the indent, the editor root in the base view): the
   * resize's clamp, so the figure never stands past the editor. */
  const figureMaxWidth = (): number => {
    const figure = figureRef.current;
    if (figure === null) return MIN_IMAGE_WIDTH_PX;
    const rect = figure.getBoundingClientRect();
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
    return Math.max(max, rect.width, MIN_IMAGE_WIDTH_PX);
  };

  /** The port press starts the resize session (the pointer capture stays on the port). */
  const onPortPointerDown =
    (corner: ImagePortCorner) =>
    (event: ReactPointerEvent<HTMLElement>): void => {
      const figure = figureRef.current;
      if (figure === null) return;
      event.stopPropagation();
      event.preventDefault();
      const rect = figure.getBoundingClientRect();
      const row = figure.closest<HTMLElement>('[data-slot="docblocks/row"]');
      dragRef.current = {
        startX: event.clientX,
        startWidth: rect.width,
        max: figureMaxWidth(),
        corner,
      };
      setPreview(rect.width);
      event.currentTarget.setPointerCapture?.(event.pointerId);
      (row ?? figure).focus();
    };

  /** The session's live width (pure view state — the doc stands as it is). */
  const onPortPointerMove = (event: ReactPointerEvent<HTMLElement>): void => {
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

  /** The port's keyboard resize: the arrows stand the width by a step (one
   * `updateBlock` — one undo step per press), clamped to the image's range.
   * The left corners widen on the left's arrow, the right on the right's. */
  const onPortKeyDown =
    (corner: ImagePortCorner) =>
    (event: ReactKeyboardEvent<HTMLElement>): void => {
      const key = event.key;
      if (key !== "ArrowLeft" && key !== "ArrowRight") return;
      event.preventDefault();
      const widens = corner === "nw" || corner === "sw" ? key === "ArrowLeft" : key === "ArrowRight";
      // The current width's baseline (the committed's attr, the rendered's over
      // the absent's): the step's stands on the image's current's width, not the
      // figure's box (the column's — the constant's stand would step nowhere).
      const baseline = block.attrs?.width ?? imgRef.current?.clientWidth ?? MIN_IMAGE_WIDTH_PX;
      doc.updateBlock(id, {
        width: Math.round(
          clamp(
            baseline + (widens ? IMAGE_KEYBOARD_RESIZE_STEP_PX : -IMAGE_KEYBOARD_RESIZE_STEP_PX),
            MIN_IMAGE_WIDTH_PX,
            figureMaxWidth()
          )
        ),
      });
    };

  return { dragWidth, onPortPointerDown, onPortPointerMove, onPortPointerUp, onPortKeyDown };
}

export { IMAGE_PORT_CORNERS, useImageResize };
export type { ImagePortCorner };
