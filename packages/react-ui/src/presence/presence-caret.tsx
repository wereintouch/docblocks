import { useStore } from "zustand";

import { useLayoutEffect, useState } from "react";
import type { CSSProperties, RefObject } from "react";

import type { PresenceSelection } from "docblocks-core";

import { useEditorContext } from "../EditorProvider";
import { locatePosition } from "../editing/dom-offset";

/** One rendered caret bar: the peer and the pixel geometry relative to the editor root. */
interface CaretBar {
  key: string;
  peerId: string;
  left: number;
  top: number;
  height: number;
}

/** A caret endpoint in a block's flattened text. */
type CaretPoint = { blockId: string; offset: number };

/** Deterministic hue (0–359) from the peer id (pure function, no peer state). */
function peerHue(peerId: string): number {
  let hash = 0;
  for (let i = 0; i < peerId.length; i++) hash = (hash * 31 + peerId.charCodeAt(i)) >>> 0;
  return hash % 360;
}

/** The caret endpoints a peer's wire selection draws; blocks kind draws none in v1. */
function caretPointsOf(selection: PresenceSelection | null): CaretPoint[] {
  if (selection === null) return [];
  if ("blockId" in selection) return [{ blockId: selection.blockId, offset: selection.offset }];
  if ("from" in selection) {
    return [
      { blockId: selection.from.blockId, offset: selection.from.offset },
      { blockId: selection.to.blockId, offset: selection.to.offset },
    ];
  }
  return [];
}

/**
 * The client rect of a collapsed range at the flat offset inside the
 * block element, relative to the root's rect. Environments without layout
 * (jsdom — no getClientRects) yield zero rects, so a missing rect maps to 0.
 */
function caretGeometry(root: HTMLElement, block: HTMLElement, offset: number): Omit<CaretBar, "key" | "peerId"> {
  const position = locatePosition(block, offset);
  const range = document.createRange();
  range.setStart(position.node, position.offset);
  range.collapse(true);
  let rect: DOMRect | undefined;
  if (typeof range.getClientRects === "function") {
    const rects = range.getClientRects();
    rect = rects.length > 0 ? rects[0] : undefined;
  }
  const rootRect = root.getBoundingClientRect();
  return {
    left: rect !== undefined ? rect.left - rootRect.left : 0,
    top: rect !== undefined ? rect.top - rootRect.top : 0,
    height: rect !== undefined ? rect.height : 0,
  };
}

/**
 * Renders remote peers' carets as absolutely positioned bars over the
 * editor root — a pure view of the presence slice (it never mutates).
 *
 * The bars are recomputed on presence changes, on block snapshot changes
 * (text shifts the pixels), and on window resize; a peer whose block is
 * not rendered (removed, unknown type) draws nothing.
 */
function PresenceCaretOverlay({ rootRef }: { rootRef: RefObject<HTMLDivElement | null> }) {
  const { store } = useEditorContext();
  const presence = useStore(store, (state) => state.presence);
  const blocks = useStore(store, (state) => state.blocks);
  const [bars, setBars] = useState<CaretBar[]>([]);

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (root === null) return;

    const recompute = (): void => {
      const next: CaretBar[] = [];
      for (const peer of presence) {
        for (const point of caretPointsOf(peer.selection)) {
          // A text-editable block measures inside its inner editable (a
          // nested list's text must not corrupt the flat offset); a
          // non-text block falls back to the wrapper element.
          const block =
            root.querySelector<HTMLElement>(
              `[data-block-id="${point.blockId}"][data-slot="docblocks/block-content"]`
            ) ?? root.querySelector<HTMLElement>(`[data-block-id="${point.blockId}"]`);
          if (block === null) continue;
          const geometry = caretGeometry(root, block, point.offset);
          next.push({
            key: `${peer.peerId}:${point.blockId}:${point.offset}`,
            peerId: peer.peerId,
            ...geometry,
          });
        }
      }
      // Skip the state update when the geometry is unchanged (a remeasure
      // pass can land with identical bars — no overlay re-render then).
      setBars((prev) => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next));
    };

    // The measurement needs settled layout: a store-triggered recompute can
    // land mid-rebuild (a rebased text DOM), so every trigger also remeasures
    // on the next frame, after React has applied the rebuild.
    let frame = 0;
    const scheduleRecompute = (): void => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        frame = 0;
        recompute();
      });
    };

    recompute();
    scheduleRecompute();
    window.addEventListener("resize", scheduleRecompute);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", scheduleRecompute);
    };
  }, [presence, blocks, rootRef]);

  return (
    <>
      {bars.map((bar) => (
        <span
          key={bar.key}
          data-slot="docblocks/presence-caret"
          data-peer={bar.peerId}
          style={
            {
              "--docblocks-presence-hue": peerHue(bar.peerId),
              left: bar.left,
              top: bar.top,
              height: bar.height,
            } as CSSProperties
          }
        />
      ))}
    </>
  );
}

export { PresenceCaretOverlay };
export type { CaretBar };
