import { createDoc } from "../src/core";
import type { Doc } from "../src/core";
import type { DocJSON } from "../src/schema";

/**
 * The canvas block types (the v2 data format: the canvas elements are
 * blocks of the SAME document): surface / shape / connector / frame /
 * canvas-text. The
 * validation boundary (the strict validator: the registry-driven enums and
 * bounds + the canvas branch for the points tuples, the connector refs,
 * and the geometry shape; the lenient reader over the raw + applyUpdate
 * path), the z-order semantics (the surface's children order IS the
 * paint order), and the structural rules. setGeometry is tested
 * separately.
 */

const CREATED_AT = "2026-01-01T00:00:00Z";

const newDoc = (): Doc => createDoc({ id: "r", createdAt: CREATED_AT });

/** The full canvas scene (the strict validator's happy path). */
const canvasDoc = (): DocJSON => ({
  v: 1,
  id: "d1",
  title: "",
  createdAt: CREATED_AT,
  blocks: {
    d1: { type: "root", children: ["s1", "p1", "pf1"] },
    // A page block with a geometry (the double mode: the block flows in the
    // page view, the geometry is ignored there).
    p1: { type: "paragraph", geometry: { x: 5, y: -5, w: 100, h: 40 }, content: [{ text: "page", marks: {} }] },
    // The page-frame block (a root child): the inline window into the
    // canvas frame f1 (the required frameId weak reference; no title).
    pf1: { type: "frame", attrs: { frameId: "f1" } },
    s1: { type: "surface", children: ["f1", "sh1", "sh2", "c1", "t1", "e1"] },
    // The canvas frame: the viewport window into the surface's content
    // (the optional title label; no children, no z-order index).
    f1: { type: "frame", attrs: { title: "Frame" }, geometry: { x: -80, y: -40, w: 200, h: 100 } },
    sh1: {
      type: "shape",
      attrs: {
        variant: "rect",
        stroke: "#0969da",
        fill: "rgba(9, 105, 218, 0.2)",
        strokeWidth: 2,
        strokeStyle: "dash",
        opacity: 0.5,
        points: [
          [1, 2],
          [3, 4],
        ],
      },
      geometry: { x: 60, y: 0, w: 80, h: 60 },
    },
    sh2: { type: "shape", attrs: { variant: "rounded" } },
    c1: {
      type: "connector",
      attrs: {
        start: { blockId: "f1" },
        end: { blockId: "sh1" },
        points: [[0, 30]],
        label: "link",
        variant: "orthogonal",
        strokeStyle: "dot",
      },
    },
    // A cross-doc connector ref (docId): valid data; the renderer resolves
    // blockId-only within the surface in v1 (the docId ref is skipped).
    e1: { type: "connector", attrs: { start: { docId: "master-1" }, end: { docId: "master-2", blockId: "b9" } } },
    t1: {
      type: "canvas-text",
      attrs: { fontSize: 14, textAlign: "center" },
      content: [{ text: "canvas", marks: {} }],
    },
  },
});

/** A scene variant: the base scene with one block entry replaced. */
const withBlock = (id: string, block: unknown): DocJSON => {
  const scene = canvasDoc();
  return { ...scene, blocks: { ...scene.blocks, [id]: block as DocJSON["blocks"][string] } };
};

export { CREATED_AT, canvasDoc, newDoc, withBlock };
