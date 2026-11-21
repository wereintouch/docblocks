/**
 * The embed's stretched height's state (the bottom-edge's resize's stand):
 * the token's minimum's measure over the wrapper (the themed's stand, the
 * fallback's default over the non-CSS's environment), the `height` attr's
 * live's state (the drag's live's update, the rest's commit — one doc write,
 * the panes' shared stand over the wire, the peer's adopt), and the handle's
 * handlers (the drag's pointer's session, the keyboard's arrows' nudge).
 */
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent, RefObject } from "react";

import type { BlockId, EmbedBlock as EmbedBlockType } from "docblocks-core";

import { useEditorContext } from "../editor-provider";

/** The height's fallback minimum (px): the `--docblocks-embed-height` token's default (the non-CSS environment's stand — jsdom). */
const EMBED_MIN_HEIGHT = 300;
/** The resize handle's key step (px per arrow press). */
const EMBED_RESIZE_KEY_STEP = 16;

/**
 * The height's wire stand: the token's minimum over the wrapper (the
 * themed token's stand), the fallback's default over the non-CSS's stand
 * (jsdom's empty computed value).
 */
function readEmbedMinHeight(wrapper: HTMLElement): number {
  const raw = getComputedStyle(wrapper).getPropertyValue("--docblocks-embed-height");
  const value = Number.parseFloat(raw);
  return Number.isFinite(value) && value > 0 ? value : EMBED_MIN_HEIGHT;
}

interface UseEmbedHeightArgs {
  id: BlockId;
  block: EmbedBlockType;
  /** The wrapper's ref (the drag's geometry + the token's minimum's measure). */
  wrapperRef: RefObject<HTMLDivElement | null>;
}

interface UseEmbedHeightResult {
  height: number | null;
  tokenMin: number;
  onPointerDown: (event: ReactPointerEvent) => void;
  onPointerMove: (event: ReactPointerEvent) => void;
  onPointerUp: (event: ReactPointerEvent) => void;
  onKeyDown: (event: ReactKeyboardEvent) => void;
}

function useEmbedHeight({ id, block, wrapperRef }: UseEmbedHeightArgs): UseEmbedHeightResult {
  const { doc } = useEditorContext();
  // The stretched height's stand (the null idiom: null = the token's
  // default — the minimum). The drag updates the state live, the rest's
  // commit stands the doc's write; the peer's write stands the adopt.
  const [height, setHeight] = useState<number | null>(block.attrs.height ?? null);
  const heightRef = useRef(height);
  heightRef.current = height;
  // The token's minimum (the themed's stand): the wrapper's computed value
  // over the mount, the fallback's default over the non-CSS's environment.
  const [tokenMin, setTokenMin] = useState(EMBED_MIN_HEIGHT);
  // The resize's session (the drag's start: the pointer's Y, the wrapper's
  // rect's height, the token's minimum's snapshot; the live's last height —
  // the commit's stand, the render's no-wait).
  const resizeSession = useRef<{
    pointerId: number;
    startY: number;
    startHeight: number;
    min: number;
    lastHeight: number;
  } | null>(null);

  /** The token's minimum's measure (the themed's stand) over the mount. */
  useLayoutEffect(() => {
    const wrapper = wrapperRef.current;
    if (wrapper === null) return;
    setTokenMin(readEmbedMinHeight(wrapper));
  }, []);

  /**
   * The remote's stand over the height: the panes share the stretched stand
   * over the wire — a pane's peer lands a height different from the local's
   * (the block's `height` attr's stand the peer's write), so the local's
   * state adopts it. Own commits land equal to the local's state and stand
   * no adopt.
   */
  useEffect(() => {
    const attrHeight = block.attrs.height ?? null;
    if (attrHeight === heightRef.current) return;
    setHeight(attrHeight);
  }, [block.attrs]);

  // The bottom-edge's resize: the drag's stand (the wrapper's height's live
  // update, the doc's write over the rest). The pointerdown stands only the
  // left button; the stopPropagation's guard stands the wrapper's pan
  // session's no-start (the modifier's drag over the handle).
  const onResizePointerDown = (event: ReactPointerEvent) => {
    if (event.button !== 0) return;
    event.stopPropagation();
    const wrapper = wrapperRef.current;
    if (wrapper === null) return;
    const min = readEmbedMinHeight(wrapper);
    const rect = wrapper.getBoundingClientRect();
    (event.target as HTMLElement).setPointerCapture?.(event.pointerId);
    resizeSession.current = {
      pointerId: event.pointerId,
      startY: event.clientY,
      startHeight: rect.height,
      min,
      lastHeight: rect.height,
    };
  };

  const onResizePointerMove = (event: ReactPointerEvent) => {
    const session = resizeSession.current;
    if (session === null || event.pointerId !== session.pointerId) return;
    const next = Math.max(session.startHeight + (event.clientY - session.startY), session.min);
    session.lastHeight = next;
    setHeight(next);
  };

  const endResize = (event: ReactPointerEvent) => {
    const session = resizeSession.current;
    if (session === null || event.pointerId !== session.pointerId) return;
    (event.target as HTMLElement).releasePointerCapture?.(event.pointerId);
    resizeSession.current = null;
    const committed = Math.round(session.lastHeight);
    if (committed <= session.min) {
      if ((block.attrs.height ?? null) !== null) doc.updateBlock(id, { height: null });
    } else if (committed !== (block.attrs.height ?? null)) {
      doc.updateBlock(id, { height: committed });
    }
  };

  // The keyboard's stand (the slider's idiom): the arrows stretch / shrink
  // over the step (the clamp's stand over the token's minimum), the commit's
  // rest stands one key press. The preventDefault's guard stands the
  // page's no-scroll over the arrows.
  const onResizeKeyDown = (event: ReactKeyboardEvent) => {
    const wrapper = wrapperRef.current;
    if (wrapper === null) return;
    const min = readEmbedMinHeight(wrapper);
    const delta =
      event.key === "ArrowDown" ? EMBED_RESIZE_KEY_STEP : event.key === "ArrowUp" ? -EMBED_RESIZE_KEY_STEP : null;
    if (delta === null) return;
    event.preventDefault();
    const current = Math.max(heightRef.current ?? min, min);
    const next = Math.max(current + delta, min);
    setHeight(next <= min ? null : next);
    if (next <= min) {
      if ((block.attrs.height ?? null) !== null) doc.updateBlock(id, { height: null });
    } else if (next !== (block.attrs.height ?? null)) {
      doc.updateBlock(id, { height: next });
    }
  };

  return {
    height,
    tokenMin,
    onPointerDown: onResizePointerDown,
    onPointerMove: onResizePointerMove,
    onPointerUp: endResize,
    onKeyDown: onResizeKeyDown,
  };
}

export { useEmbedHeight };
export type { UseEmbedHeightResult };
