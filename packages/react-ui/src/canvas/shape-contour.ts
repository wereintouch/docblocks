/** The canvas figure's contour math: the SVG path data's flattening into a
 * polyline (the M / L / H / V / C / A / Z command set the canvas figures
 * emit — the arcs stand the endpoint → center conversion's sampling) and the
 * point-to-polyline distance. The hit zones' contour band and the
 * connector's stroke band read one distance measure. */
import type { ShapeAttrs } from "docblocks-core";

import { shapeOutlinePath } from "./shape-outline";

/** The path's flattening: the curve-sampling step count (an arc / a cubic's
 * segments; the 6-screen-px tolerance band absorbs the chord error). */
const CURVE_STEPS = 16;

/** A point of the flattened outline (canvas px, block-local). */
interface OutlinePoint {
  x: number;
  y: number;
}

/** The SVG arc's endpoint → center conversion's sampling (SVG 1.1 F.6.5). */
function arcPoints(
  from: OutlinePoint,
  rxIn: number,
  ryIn: number,
  phiDeg: number,
  largeArc: boolean,
  sweep: boolean,
  to: OutlinePoint
): OutlinePoint[] {
  const phi = (phiDeg * Math.PI) / 180;
  const cosPhi = Math.cos(phi);
  const sinPhi = Math.sin(phi);
  const dx = (from.x - to.x) / 2;
  const dy = (from.y - to.y) / 2;
  const x1p = cosPhi * dx + sinPhi * dy;
  const y1p = -sinPhi * dx + cosPhi * dy;
  let rx = Math.abs(rxIn);
  let ry = Math.abs(ryIn);
  if (rx === 0 || ry === 0) return [to];
  // The radii's correction (the segment does not fit the ellipse).
  const lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (lambda > 1) {
    const scale = Math.sqrt(lambda);
    rx *= scale;
    ry *= scale;
  }
  const sign = largeArc === sweep ? -1 : 1;
  const numerator = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p;
  const denominator = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
  const coef = denominator === 0 ? 0 : sign * Math.sqrt(Math.max(numerator / denominator, 0));
  const cxp = (coef * rx * y1p) / ry;
  const cyp = (-coef * ry * x1p) / rx;
  const cx = cosPhi * cxp - sinPhi * cyp + (from.x + to.x) / 2;
  const cy = sinPhi * cxp + cosPhi * cyp + (from.y + to.y) / 2;
  const angleOf = (x: number, y: number) => Math.atan2((y - cyp) / ry, (x - cxp) / rx);
  const theta1 = angleOf(x1p, y1p);
  const theta2 = angleOf(-x1p, -y1p);
  let delta = theta2 - theta1;
  if (!sweep && delta > 0) delta -= 2 * Math.PI;
  if (sweep && delta < 0) delta += 2 * Math.PI;
  const points: OutlinePoint[] = [];
  for (let step = 1; step <= CURVE_STEPS; step += 1) {
    const t = theta1 + (delta * step) / CURVE_STEPS;
    points.push({
      x: cx + cosPhi * rx * Math.cos(t) - sinPhi * ry * Math.sin(t),
      y: cy + sinPhi * rx * Math.cos(t) + cosPhi * ry * Math.sin(t),
    });
  }
  return points;
}

/** The path data → the flattened polyline (M / L / H / V / C / A / Z — the
 * command set the canvas figures emit; any other command is skipped). */
function flattenPath(d: string): OutlinePoint[] {
  const tokens = d.match(/[A-Za-z]|-?(?:\d+\.?\d*|\.\d+)/g) ?? [];
  const points: OutlinePoint[] = [];
  let index = 0;
  let command = "";
  let current: OutlinePoint = { x: 0, y: 0 };
  let start: OutlinePoint = { x: 0, y: 0 };
  const number = (): number => Number.parseFloat(tokens[index++] ?? "0");
  const push = (point: OutlinePoint): void => {
    points.push(point);
    current = point;
  };
  while (index < tokens.length) {
    const token = tokens[index]!;
    if (/[A-Za-z]/.test(token)) {
      command = token;
      index += 1;
    } else if (command === "M") {
      // The repeated pairs after a move are implicit line-to's.
      command = "L";
    }
    if (command === "Z" || command === "z") {
      push({ ...start });
      continue;
    }
    if (command === "M") {
      start = { x: number(), y: number() };
      push({ ...start });
      continue;
    }
    if (command === "L") {
      push({ x: number(), y: number() });
      continue;
    }
    if (command === "H") {
      push({ x: number(), y: current.y });
      continue;
    }
    if (command === "V") {
      push({ x: current.x, y: number() });
      continue;
    }
    if (command === "C") {
      const c1 = { x: number(), y: number() };
      const c2 = { x: number(), y: number() };
      const end = { x: number(), y: number() };
      for (let step = 1; step <= CURVE_STEPS; step += 1) {
        const t = step / CURVE_STEPS;
        const u = 1 - t;
        points.push({
          x: u * u * u * current.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * end.x,
          y: u * u * u * current.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * end.y,
        });
      }
      current = end;
      continue;
    }
    if (command === "A") {
      const rx = number();
      const ry = number();
      const phi = number();
      const largeArc = number() !== 0;
      const sweep = number() !== 0;
      const end = { x: number(), y: number() };
      for (const point of arcPoints(current, rx, ry, phi, largeArc, sweep, end)) push(point);
      current = end;
      continue;
    }
    // An unknown command: drop it (the lenient reader's posture).
    index += 1;
  }
  return points;
}

/** The distance from the point to the segment. */
function pointSegmentDistance(point: OutlinePoint, a: OutlinePoint, b: OutlinePoint): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq === 0) return Math.hypot(point.x - a.x, point.y - a.y);
  const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSq));
  return Math.hypot(point.x - (a.x + t * dx), point.y - (a.y + t * dy));
}

/** The distance from the point to the polyline (the outline's contour). */
function distanceToPolyline(point: OutlinePoint, points: readonly OutlinePoint[]): number {
  let best = Infinity;
  for (let i = 0; i < points.length - 1; i += 1) {
    const a = points[i]!;
    const b = points[i + 1]!;
    best = Math.min(best, pointSegmentDistance(point, a, b));
  }
  return best;
}

/**
 * The distance from the block-local point to the figure's outline (the
 * contour's band). `null` when the figure's variant stands no outline (the
 * unknown variant — the caller keeps the box).
 */
function outlineDistanceOf(
  attrs: ShapeAttrs | undefined,
  box: { w: number; h: number },
  point: OutlinePoint
): number | null {
  const d = shapeOutlinePath(attrs, box);
  if (d === null) return null;
  return distanceToPolyline(point, flattenPath(d));
}

export { distanceToPolyline, flattenPath, outlineDistanceOf, pointSegmentDistance };
export type { OutlinePoint };
