/** Renders remote peers' selections as absolutely positioned boxes over
 * the editor root — a pure view of the presence slice (it never
 * mutates). A caret selection draws a caret bar; a range selection
 * (cross-block included) draws its highlight boxes — one per client rect
 * of each chain-block segment. The boxes are recomputed on presence
 * changes, on block snapshot changes (text shifts the pixels), and on
 * window resize; a peer whose block is not rendered (removed, unknown
 * type) draws nothing. The structural classes of the overlay boxes (the
 * per-peer hue comes from the inline --docblocks-presence-hue property,
 * the geometry from the inline layout properties): the caret bar is the
 * fixed width token; the range highlight is a softened box of the same
 * hue. */
import { useStore } from "zustand";

import { useLayoutEffect, useState } from "react";
import type { CSSProperties, RefObject } from "react";

import { useEditorContext } from "../editor-provider";
import type { BoxRect, OverlayBox } from "./models";
import { caretGeometry, caretPointsOf, peerHue, rangeRects, rangeSegmentsOf } from "./utils";

/**
 * The structural classes of the overlay boxes (the per-peer hue comes
 * from the inline --docblocks-presence-hue property, the geometry from
 * the inline layout properties). The caret bar is the fixed width token;
 * the range highlight is a softened box of the same hue.
 */
const CARET_CLASS =
  "pointer-events-none absolute w-(--docblocks-presence-caret-width) bg-[hsl(var(--docblocks-presence-hue,200)_var(--docblocks-presence-caret-saturation)_var(--docblocks-presence-caret-lightness))]";
const RANGE_CLASS =
  "pointer-events-none absolute rounded-[2px] bg-[hsl(var(--docblocks-presence-hue,200)_var(--docblocks-presence-caret-saturation)_var(--docblocks-presence-caret-lightness)/var(--docblocks-presence-range-opacity))]";

function PresenceCaretOverlay({ rootRef }: { rootRef: RefObject<HTMLDivElement | null> }) {
  const { store, doc } = useEditorContext();
  const presence = useStore(store, (state) => state.presence);
  // The blocks' wide read stands only with peers (the stable sentinel
  // without them — a doc change with zero peers re-renders nothing here).
  const blocks = useStore(store, (state) => (state.presence.length === 0 ? null : state.blocks));
  const [boxes, setBoxes] = useState<OverlayBox[]>([]);

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (root === null) return;

    const recompute = (): void => {
      const next: OverlayBox[] = [];
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
          next.push({
            key: `${peer.peerId}:caret:${point.blockId}:${point.offset}`,
            peerId: peer.peerId,
            slot: "docblocks/presence-caret",
            ...caretGeometry(root, block, point.offset),
          });
        }
        for (const segment of rangeSegmentsOf(peer.selection, doc, blocks ?? {})) {
          // A range segment is text: it measures inside the inner editable;
          // a block without one (removed, non-text, unrendered) draws nothing.
          const block = root.querySelector<HTMLElement>(
            `[data-block-id="${segment.blockId}"][data-slot="docblocks/block-content"]`
          );
          if (block === null) continue;
          const rects = rangeRects(root, block, segment.from, segment.to);
          // Environments without layout: one zero-geometry box, so the
          // highlight's presence (and data attributes) still renders.
          const measured: BoxRect[] = rects.length > 0 ? rects : [{ left: 0, top: 0, width: 0, height: 0 }];
          measured.forEach((rect, index) => {
            next.push({
              key: `${peer.peerId}:range:${segment.blockId}:${segment.from}-${segment.to}:${index}`,
              peerId: peer.peerId,
              slot: "docblocks/presence-range",
              blockId: segment.blockId,
              ...rect,
            });
          });
        }
      }
      // Skip the state update when the geometry is unchanged (a remeasure
      // pass can land with identical boxes — no overlay re-render then).
      setBoxes((prev) => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next));
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
  }, [presence, blocks, doc, rootRef]);

  return (
    <>
      {boxes.map((box) => (
        <span
          key={box.key}
          data-slot={box.slot}
          data-peer={box.peerId}
          data-range-block={box.blockId}
          className={box.slot === "docblocks/presence-caret" ? CARET_CLASS : RANGE_CLASS}
          style={
            {
              "--docblocks-presence-hue": peerHue(box.peerId),
              left: box.left,
              top: box.top,
              height: box.height,
              ...(box.width !== undefined ? { width: box.width } : null),
            } as CSSProperties
          }
        />
      ))}
    </>
  );
}

export { PresenceCaretOverlay };
