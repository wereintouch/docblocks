/**
 * The page-frame block's renderer: the inline window into the referenced
 * canvas frame's surface — the content's mirror (FrameWindowContent over
 * the window's offset; the box's background the canvas's own background +
 * the dot grid phase-aligned to the world's grid; the container's thin
 * rounded border), inlined in the page flow at
 * 1:1 (no fit/zoom controls — the v1 boundary). The canvas frame stands the
 * boundary only (a region marker) — this page block is the sole renderer
 * of the frame's content. The box's height is the
 * referenced frame's 1:1; the width is the frame's width clipped to the
 * row's measured width (the window's center stays at the frame's center —
 * a narrow row clips the wide window horizontally, the offset and the dot
 * grid's phase re-derive over the clipped width). The reference is a weak
 * one: the absent / gone / surface-less reference stands the lenient
 * placeholder (the dangling stand — the render never throws). The
 * window's content is inert (the copies' pointer-transparent stand — the
 * interaction stands on the originals in the canvas mode) and re-renders
 * over the canvas's changes (the content's items read their own
 * snapshots — a surface child's geometry / attr change re-stands the copy
 * without the block's own re-render).
 */
import { useTranslation } from "react-i18next";
import { useStore } from "zustand";

import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";

import type { Block, BlockId, FrameBlock } from "docblocks-core";

import { FrameWindowContent } from "../canvas/FrameWindowContent";
import { effectiveGeometry, frameDotBackground, frameWindowOffset } from "../canvas/geometry";
import { useEditorContext } from "../editor-provider";
import { useBlock } from "../hooks";
import { Card, CardContent } from "../shared/ui/Card";
import { preventDefault } from "../shared/utils";

/**
 * The referenced frame's surface: the root's child whose children hold the
 * frame (the frame is a surface's direct child; the store's snapshot
 * carries no parent, so the derivation walks the root's children over the
 * surfaces' children — the O(root's children x children) stand). The
 * selector's primitive result memoizes it: the re-render stands only over
 * a surface change (the derivation re-runs on every store change, the
 * result comparison bails while it stands).
 */
function surfaceOfFrame(
  rootChildren: readonly BlockId[],
  blocks: Readonly<Record<BlockId, Block>>,
  frameId: BlockId
): BlockId | null {
  for (const childId of rootChildren) {
    const child = blocks[childId];
    if (child === undefined || child.type !== "surface") continue;
    if ((child.children ?? []).includes(frameId)) return childId;
  }
  return null;
}

function FramePageBlock({ id }: { id: BlockId }) {
  const { t } = useTranslation("frame");
  const { store } = useEditorContext();
  const block = useBlock(id);
  // The weak reference (the absent / empty stand is the dangling's
  // placeholder; the empty id's map read stands undefined stably).
  const frameId = block !== undefined && block.type === "frame" ? (block.attrs?.frameId ?? "") : "";
  const referenced = useBlock(frameId);
  const surfaceId = useStore(store, (state) =>
    frameId === "" ? null : surfaceOfFrame(state.rootChildren, state.blocks, frameId)
  );

  // The lenient dangling stand (the reference is absent, the frame is
  // gone — or stands under no surface: the invalid context's lenient
  // posture): the placeholder, never a throw.
  if (frameId === "" || referenced === undefined || referenced.type !== "frame" || surfaceId === null) {
    return (
      <Card
        data-slot="docblocks/frame-page-missing"
        data-block-type="frame"
        data-block-id={id}
        className="
          mx-0 my-(--docblocks-block-spacing) rounded-(--docblocks-radius)
          border-(length:--docblocks-table-border-width) border-dashed border-(--docblocks-table-border-color)
          outline-none
        "
      >
        <CardContent className="flex items-center justify-center text-sm text-muted-foreground">
          {t("page.missing")}
        </CardContent>
      </Card>
    );
  }
  return <FramePageWindow id={id} frameId={frameId} surfaceId={surfaceId} referenced={referenced} />;
}

/**
 * The window's box (the row's measurement + the offset / background's
 * derivation over the clipped width): a separate component so the
 * ResizeObserver's mount stand stands only over the window (the dangling's
 * placeholder never observes).
 */
function FramePageWindow({
  id,
  frameId,
  surfaceId,
  referenced,
}: {
  id: BlockId;
  frameId: BlockId;
  surfaceId: BlockId;
  referenced: FrameBlock;
}) {
  const { t } = useTranslation("frame");
  const [rowWidth, setRowWidth] = useState(0);
  const rowRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (typeof ResizeObserver === "undefined") return;
    const el = rowRef.current;
    if (el === null) return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry === undefined) return;
      // The stable stand: the width's change re-renders, the observer's
      // own re-measure over an unchanged width stands no re-render.
      setRowWidth((prev) => (prev === entry.contentRect.width ? prev : entry.contentRect.width));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // The referenced frame's effective geometry (the committed box or the
  // default stand): the window's 1:1 center and span.
  const box = effectiveGeometry(referenced);
  const boxW = rowWidth > 0 ? Math.min(box.w, rowWidth) : box.w;
  const boxH = box.h;
  // The window's offset over the clipped width: the window's center stays
  // at the frame's center (a narrow row clips the wide window
  // horizontally, the vertical's stand is 1:1).
  const offset = frameWindowOffset({ x: box.x, y: box.y, w: boxW, h: boxH });
  // The dot grid's phase over the box's world top-left (the clipped
  // width's stand — the box's center stays at the frame's center).
  const boxStyle: CSSProperties = {
    backgroundColor: "var(--docblocks-canvas-background)",
    ...frameDotBackground(box.x - boxW / 2, box.y - boxH / 2),
    boxShadow: "inset 0 0 0 1px var(--docblocks-canvas-group-border-color)",
    width: boxW,
    height: boxH,
  };
  const title = referenced.attrs?.title ?? "";
  // The referenced frame's box stands out of its own page window
  // (excludedIds): a frame does not render its own boundary inside the
  // window it defines. The reference stands memoized (the window's copies'
  // CanvasItem memo over the stable reference — the row's re-measure's stand).
  const excludedIds = useMemo(() => [frameId], [frameId]);

  return (
    <div
      ref={rowRef}
      data-slot="docblocks/frame-page"
      data-block-type="frame"
      data-block-id={id}
      tabIndex={0}
      onMouseDown={preventDefault}
      className="
        my-(--docblocks-block-spacing) outline-none
        focus-visible:outline-(length:--docblocks-canvas-selection-border-width) focus-visible:outline-offset-1
        focus-visible:outline-(--docblocks-canvas-selection-border-color) focus-visible:outline-dashed
      "
    >
      <div
        data-slot="docblocks/frame-page-window"
        role="img"
        aria-label={title !== "" ? t("page.windowTitle", { title }) : t("page.windowLabel")}
        className="relative mx-auto overflow-hidden rounded-(--docblocks-radius)"
        style={boxStyle}
      >
        <FrameWindowContent
          surfaceId={surfaceId}
          offset={offset}
          // The page-frame block's stand: the referenced frame does not
          // render its own box inside its own page window (excludedIds).
          excludedIds={excludedIds}
        />
      </div>
    </div>
  );
}

export { FramePageBlock };
