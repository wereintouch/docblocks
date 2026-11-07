/**
 * The frame's window geometry (the canvas frame's viewport-window render):
 * the window's content offset and the box's background stand. The window
 * shows the surface's world content through the box: the surface's world
 * origin (0,0) stands at the box-local point the offset carries, and the
 * box's dot grid stands the canvas's world grid phase (the frame's box
 * looks like a seamless canvas continuation over the hidden content).
 */
import type { CSSProperties } from "react";

import { DOT_GRID_STEP_PX } from "../constants";
import type { Box } from "../models";

/**
 * The window's offset: the box-local position of the surface's world
 * origin (0,0) — the box's top-left corner (the center minus the half
 * spans) shifted to the origin. The window's content wrapper stands at
 * this point, so the world's content stands at its world coordinates over
 * the box (the center-anchor model: the content's center anchor is the
 * world origin).
 */
function frameWindowOffset(box: Box): { left: number; top: number } {
  return { left: box.w / 2 - box.x, top: box.h / 2 - box.y };
}

/**
 * The frame box's background's inline style: the canvas background's dot
 * grid (the canvas view's grid token's dot) phase-aligned to the world's
 * 24px grid from the box's WORLD top-left (the positive mod — the phase
 * stands for negative coordinates too): the box's background position is
 * the world grid's phase at the box's top-left corner, so the dots stand
 * on the world's grid lines and the box slides over them.
 */
function frameDotBackground(topLeftX: number, topLeftY: number): CSSProperties {
  const step = DOT_GRID_STEP_PX;
  // The grid's phase at the world point: the world distance from the
  // previous grid line (the positive mod, the negative stand).
  const phase = (value: number) => ((value % step) + step) % step;
  // The dot's point stands at the box-local position congruent to
  // -topLeft over the step (the world grid's line re-lands on the box's
  // edge's phase); the positive mod stands the negative's coordinates.
  const positionOf = (value: number) => (step - phase(value)) % step;
  return {
    backgroundImage: "radial-gradient(circle, var(--docblocks-canvas-view-dot) 1px, transparent 1px)",
    backgroundSize: `${step}px ${step}px`,
    backgroundPosition: `${positionOf(topLeftX)}px ${positionOf(topLeftY)}px`,
  };
}

export { frameDotBackground, frameWindowOffset };
