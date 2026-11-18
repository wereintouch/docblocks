import { createDoc } from "docblocks-core";
import type { Doc } from "docblocks-core";

import { deterministicIdGenerator } from "./catalog";

const DOC_ID = "d1";
const DOC_CREATED_AT = "2026-01-01T00:00:00Z";

/** The heavy canvas's scene (synthetic data only, no content of its own):
 * the shapes' grid (the cell's pitch, the shape's size) + the figures'
 * count + the connector's count. The grid's span stands the culling's
 * stand (the off-viewport cells stand no DOM of their own). */
const HEAVY_COLS = 100;
const HEAVY_ROWS = 50;
const HEAVY_CELL_PX = 220;
const HEAVY_SHAPE_W = 120;
const HEAVY_SHAPE_H = 80;
const HEAVY_CONNECTORS = 1500;

const HEAVY_SHAPES = HEAVY_COLS * HEAVY_ROWS;

/** The shape's fill / stroke palette (the deterministic pick's stand). */
const HEAVY_PALETTE: { fill: string; stroke: string }[] = [
  { fill: "#dbeafe", stroke: "#1f6feb" },
  { fill: "#dcfce7", stroke: "#16a34a" },
  { fill: "#fef9c3", stroke: "#ca8a04" },
  { fill: "#fce7f3", stroke: "#db2777" },
  { fill: "#ede9fe", stroke: "#7c3aed" },
  { fill: "#e0f2fe", stroke: "#0284c7" },
];

/** The shape's variant's rotation (the dock's tool set's parity). */
const HEAVY_VARIANTS = ["rect", "ellipse", "diamond", "cylinder", "cloud"] as const;

/** The seeded PRNG (mulberry32): the scene's determinism (the same
 * geometry over the reload / the room's join — the one seeder's stand,
 * the client b's join stands the wire's sync, not a second seed). */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * The heavy canvas's seed (`?heavy=1`): the grid's shapes (the center
 * origin, the grid's span) + the neighbor's connectors (the in-grid
 * neighbor's pick — the short routes' stand). One seeder per room (the
 * client a's seed; the client b joins empty and receives the seed
 * through the room — the two seeders in one room would duplicate the ids
 * in the shared root order). One transact (one undo step, one wire
 * update).
 */
function createHeavyDoc(seed: boolean): Doc {
  const doc = createDoc({ id: DOC_ID, createdAt: DOC_CREATED_AT, generateId: deterministicIdGenerator() });
  if (!seed) return doc;
  const rand = mulberry32(0x5eed);
  doc.transact(() => {
    const heading = doc.insertBlock("heading", { level: 1 });
    doc.insertText(heading, 0, "Heavy canvas (the synthetic grid)");
    doc.insertBlock("paragraph");

    const surface = doc.insertBlock("surface");
    const shapeIds: string[] = [];
    for (let row = 0; row < HEAVY_ROWS; row += 1) {
      for (let col = 0; col < HEAVY_COLS; col += 1) {
        const x = (col - (HEAVY_COLS - 1) / 2) * HEAVY_CELL_PX;
        const y = (row - (HEAVY_ROWS - 1) / 2) * HEAVY_CELL_PX;
        const variant = HEAVY_VARIANTS[Math.floor(rand() * HEAVY_VARIANTS.length)] ?? "rect";
        const color = HEAVY_PALETTE[Math.floor(rand() * HEAVY_PALETTE.length)] ?? HEAVY_PALETTE[0]!;
        const id = doc.insertBlock("shape", { variant, fill: color.fill, stroke: color.stroke }, { parent: surface });
        doc.setGeometry(id, { x, y, w: HEAVY_SHAPE_W, h: HEAVY_SHAPE_H });
        shapeIds.push(id);
      }
    }
    // The neighbor's connectors: each source picks a right / bottom
    // neighbor (the in-grid stand; the last row / column skip their
    // missing neighbor). The connector's count floors at the grid's
    // edge (the last row / column's pick stands the left / top neighbor).
    let created = 0;
    let attempt = 0;
    while (created < HEAVY_CONNECTORS && attempt < HEAVY_CONNECTORS * 3) {
      attempt += 1;
      const source = Math.floor(rand() * shapeIds.length);
      const col = source % HEAVY_COLS;
      const row = Math.floor(source / HEAVY_COLS);
      let target: number;
      if (rand() < 0.5) {
        // the right neighbor (the last column stands the left)
        target = col < HEAVY_COLS - 1 ? source + 1 : source - 1;
      } else {
        // the bottom neighbor (the last row stands the top)
        target = row < HEAVY_ROWS - 1 ? source + HEAVY_COLS : source - HEAVY_COLS;
      }
      if (target < 0 || target >= shapeIds.length) continue;
      doc.insertBlock(
        "connector",
        { start: { blockId: shapeIds[source]! }, end: { blockId: shapeIds[target]! } },
        { parent: surface }
      );
      created += 1;
    }
  });
  return doc;
}

export { createHeavyDoc, HEAVY_CONNECTORS, HEAVY_SHAPES };
