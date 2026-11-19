// The canvas unit tests' press stand: the block selection reads the hit
// resolver (the geometry), so a press must land on the block's own zone — the
// box's center over a filled figure or a canvas-text, the figure's outline
// over a stroke-only one, the border's band over a container / a frame, the
// line's midpoint over a connector. The jsdom's container rect stands at the
// origin, so a press's client point is the world point at the default zoom /
// pan.
import { fireEvent } from "@testing-library/react";

import type { Doc } from "docblocks-core";

import { effectiveGeometry } from "../src/canvas/geometry";

interface PressPoint {
  x: number;
  y: number;
}

/** Whether the figure is explicitly transparent (`fill: "none"`): its press
 * zone is the outline, not the box. An absent fill stands a normal figure. */
function explicitlyTransparent(doc: Doc, id: string): boolean {
  const block = doc.getBlock(id);
  if (block === null || block.type !== "shape") return false;
  const fill = block.attrs?.fill;
  return fill === "none" || fill === "transparent";
}

/**
 * The block's press point: the box's inset corner over a figure / a
 * canvas-text (an interior point clear of a connector's center-to-center
 * route), the box's left-edge midpoint over an explicitly transparent figure
 * (the outline's vertex stands every variant), the top edge's midpoint over a
 * container / a frame (the border's band), the two endpoint boxes' centers'
 * middle over a connector (on the straight and the orthogonal routes — the
 * unit scenes' connectors).
 */
function pressPointOf(doc: Doc, id: string): PressPoint {
  const block = doc.getBlock(id);
  if (block === null) throw new Error(`the canvas block ${id} is missing`);
  if (block.type === "connector") {
    const points: PressPoint[] = [];
    for (const ref of [block.attrs.start, block.attrs.end]) {
      if (ref.x !== undefined && ref.y !== undefined) {
        points.push({ x: ref.x, y: ref.y });
        continue;
      }
      const target = ref.blockId !== undefined ? doc.getBlock(ref.blockId) : null;
      if (target === null) throw new Error(`the connector's endpoint ${ref.blockId ?? "free"} is missing`);
      const box = effectiveGeometry(target);
      points.push({ x: box.x, y: box.y });
    }
    const [start, end] = points;
    if (start === undefined || end === undefined) throw new Error("the connector's endpoints are missing");
    return { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
  }
  const box = effectiveGeometry(block);
  if (block.type === "group" || block.type === "frame") return { x: box.x, y: box.y - box.h / 2 };
  if (block.type === "shape" && explicitlyTransparent(doc, id)) return { x: box.x - box.w / 2, y: box.y };
  // The box's zone: the bottom-left corner's inset (an interior point clear
  // of the connectors' center-to-center routes, which cross the box's middle).
  return { x: box.x - box.w / 2 + box.w / 8, y: box.y - box.h / 2 + (box.h * 7) / 8 };
}

/** The press's client point over the view's origin (the jsdom's container
 * rect stands at the origin, so the client point is the world point). */
function pressAt(view: Element, point: PressPoint, options: { shiftKey?: boolean; pointerId?: number } = {}): void {
  const pointerId = options.pointerId ?? 1;
  fireEvent.pointerDown(view, {
    button: 0,
    clientX: point.x,
    clientY: point.y,
    pointerId,
    shiftKey: options.shiftKey ?? false,
  });
  fireEvent.pointerUp(view, { pointerId });
}

/** The plain press on the block (the press over the block's own zone). */
function pressBlock(
  view: Element,
  doc: Doc,
  id: string,
  options: { shiftKey?: boolean; pointerId?: number } = {}
): PressPoint {
  const point = pressPointOf(doc, id);
  pressAt(view, point, options);
  return point;
}

/** The press's move beyond the drag threshold (the move session's feed). */
function dragTo(view: Element, to: PressPoint, pointerId = 1): void {
  fireEvent.pointerMove(view, { clientX: to.x, clientY: to.y, pointerId, buttons: 1 });
}

export { dragTo, explicitlyTransparent, pressAt, pressBlock, pressPointOf };
export type { PressPoint };
