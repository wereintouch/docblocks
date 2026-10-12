import { createDoc } from "docblocks-core";
import type { Doc } from "docblocks-core";

import { deterministicIdGenerator } from "./catalog";

const DOC_ID = "d1";
const DOC_CREATED_AT = "2026-01-01T00:00:00Z";

/**
 * The canvas-demo seed (`?canvas=1`): a small page (heading, paragraphs,
 * divider) plus a surface with two shapes, a canvas text, and a connector
 * between the shapes. Deterministic ids (c0001, ...) with one seeder per
 * room (client a seeds, client b joins empty and receives the seed through
 * the room — two deterministic seeders in one room would duplicate the
 * ids in the shared root order).
 */
function createCanvasDoc(seed: boolean): Doc {
  const doc = createDoc({ id: DOC_ID, createdAt: DOC_CREATED_AT, generateId: deterministicIdGenerator() });
  if (!seed) return doc;
  doc.transact(() => {
    const heading = doc.insertBlock("heading", { level: 1 });
    doc.insertText(heading, 0, "Canvas document");
    const p1 = doc.insertBlock("paragraph");
    doc.insertText(p1, 0, "Page content — in the canvas view this page becomes a vertical rectangle on the canvas.");
    const p2 = doc.insertBlock("paragraph");
    doc.insertText(p2, 0, "The shapes, the text, and the connector below are surface elements on the same canvas.");
    doc.insertBlock("divider");

    const surface = doc.insertBlock("surface");
    const rect = doc.insertBlock("shape", { variant: "rect", fill: "#dbeafe", stroke: "#1f6feb" }, { parent: surface });
    const ellipse = doc.insertBlock(
      "shape",
      { variant: "ellipse", fill: "#fff8c5", stroke: "#7d4e00" },
      { parent: surface }
    );
    const text = doc.insertBlock("canvas-text", { fontSize: 20 }, { parent: surface });
    doc.insertText(text, 0, "Canvas text");
    doc.insertBlock(
      "connector",
      { start: { blockId: rect }, end: { blockId: ellipse }, label: "link" },
      { parent: surface }
    );

    doc.setGeometry(rect, { x: -260, y: -140, w: 220, h: 160 });
    doc.setGeometry(ellipse, { x: -260, y: 140, w: 160, h: 160 });
    doc.setGeometry(text, { x: 180, y: -140, w: 260, h: 80 });
  });
  return doc;
}

export { createCanvasDoc };
