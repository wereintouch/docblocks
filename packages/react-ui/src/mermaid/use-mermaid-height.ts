/** The mermaid viewport's stretched height: the live drag over the
 *  bottom edge, the keyboard's step, the doc's write over the rest (the
 *  `height` attr; the under-minimum's rest stands the natural's auto's
 *  restore), and the remote's adopt (the panes' shared stand over the
 *  wire). */
import { useEffect, useRef, useState } from "react";
import type { RefObject } from "react";

import type { BlockId, CodeBlock, Doc } from "docblocks-core";

/** The height's minimum (px): the toolbar's usable area's stand (the non-CSS environment's parity). */
const VIEWPORT_MIN_HEIGHT = 160;
/** The resize handle's key step (px per arrow press). */
const VIEWPORT_RESIZE_KEY_STEP = 16;

function useMermaidHeight({
  id,
  block,
  doc,
  wrapperRef,
}: {
  id: BlockId;
  block: CodeBlock;
  doc: Doc;
  wrapperRef: RefObject<HTMLDivElement | null>;
}): {
  height: number | null;
  onResizePointerDown: (event: React.PointerEvent) => void;
  onResizePointerMove: (event: React.PointerEvent) => void;
  endResize: (event: React.PointerEvent) => void;
  onResizeKeyDown: (event: React.KeyboardEvent) => void;
} {
  // The stretched height's stand (the null idiom: null = the natural's
  // auto). The drag updates the state live, the rest's commit stands the
  // doc's write; the peer's write stands the adopt.
  const [height, setHeight] = useState<number | null>(block.attrs?.height ?? null);
  const heightRef = useRef(height);
  heightRef.current = height;
  // The resize's session (the drag's start: the pointer's Y, the wrapper's
  // rect's height; the live's last height — the commit's stand). The
  // delta stands from the drag's START (the linear's stand — the
  // embed's parity: a moving session's height re-adds the accumulated
  // delta and super-linearizes the drag).
  const resizeSession = useRef<{ pointerId: number; startY: number; startHeight: number; lastHeight: number } | null>(
    null
  );

  /** The remote's stand over the height (the panes' shared stand over the
   *  wire — the adopt's parity over the embed's idiom). */
  useEffect(() => {
    const attrHeight = block.attrs?.height ?? null;
    if (attrHeight === heightRef.current) return;
    setHeight(attrHeight);
  }, [block.attrs]);

  // The bottom-edge's resize (the stretch's stand): the drag's live's
  // height + the doc's write over the rest (the `height`'s attr; the
  // under-minimum's rest stands the natural's auto's restore).
  const onResizePointerDown = (event: React.PointerEvent) => {
    if (event.button !== 0) return;
    event.stopPropagation();
    const wrapper = wrapperRef.current;
    if (wrapper === null) return;
    (event.target as HTMLElement).setPointerCapture?.(event.pointerId);
    const startHeight = wrapper.getBoundingClientRect().height;
    resizeSession.current = {
      pointerId: event.pointerId,
      startY: event.clientY,
      startHeight,
      lastHeight: startHeight,
    };
  };

  const onResizePointerMove = (event: React.PointerEvent) => {
    const session = resizeSession.current;
    if (session === null || event.pointerId !== session.pointerId) return;
    const next = Math.max(session.startHeight + (event.clientY - session.startY), VIEWPORT_MIN_HEIGHT);
    session.lastHeight = next;
    setHeight(next);
  };

  const endResize = (event: React.PointerEvent) => {
    const session = resizeSession.current;
    if (session === null || event.pointerId !== session.pointerId) return;
    (event.target as HTMLElement).releasePointerCapture?.(event.pointerId);
    resizeSession.current = null;
    const committed = Math.round(session.lastHeight);
    const current = block.attrs?.height ?? null;
    if (committed <= VIEWPORT_MIN_HEIGHT) {
      if (current !== null) doc.updateBlock(id, { height: null });
    } else if (committed !== current) {
      doc.updateBlock(id, { height: committed });
    }
  };

  // The keyboard's stand (the slider's idiom): the arrows stretch /
  // shrink over the step (the under-minimum's stand the auto's restore),
  // the commit's rest stands one key press.
  const onResizeKeyDown = (event: React.KeyboardEvent) => {
    const wrapper = wrapperRef.current;
    if (wrapper === null) return;
    const delta =
      event.key === "ArrowDown" ? VIEWPORT_RESIZE_KEY_STEP : event.key === "ArrowUp" ? -VIEWPORT_RESIZE_KEY_STEP : null;
    if (delta === null) return;
    event.preventDefault();
    const current = Math.max(heightRef.current ?? wrapper.clientHeight, 0);
    const next = Math.max(current + delta, VIEWPORT_MIN_HEIGHT);
    setHeight(next <= VIEWPORT_MIN_HEIGHT ? null : next);
    const value = next <= VIEWPORT_MIN_HEIGHT ? null : next;
    const persisted = block.attrs?.height ?? null;
    if (value === persisted) return;
    doc.updateBlock(id, { height: value });
  };

  return { height, onResizePointerDown, onResizePointerMove, endResize, onResizeKeyDown };
}

export { VIEWPORT_MIN_HEIGHT, useMermaidHeight };
