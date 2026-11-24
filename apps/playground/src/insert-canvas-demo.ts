import type { BlockId, Doc } from "docblocks-core";

/**
 * The canvas demo scene the harness inserts (harness convenience): the
 * fixed geometries, one surface with two frames (the viewport windows —
 * the childless box's stand; the window's content is the surface's own
 * content, clipped to the box), four shapes (the rounded one texted —
 * the shape text's stand), a canvas-text (the font attrs' stand), and a
 * connector between frame A and the rect.
 */
function seedCanvas(doc: Doc): { surface: BlockId; frame: BlockId } {
  const surface = doc.insertBlock("surface");
  doc.setGeometry(surface, { x: 0, y: 0, w: 900, h: 500 });
  // Frame A: the window box over the rounded shape + the note (the
  // window's content stand — the figures stand through the window) and
  // the connector's start endpoint.
  const frame = doc.insertBlock("frame", { title: "Frame A" }, { parent: surface });
  doc.setGeometry(frame, { x: 120, y: -100, w: 320, h: 160 });
  // Frame B: the second window at a disjoint empty box (the dot grid's
  // stand; the slash picker's list stand).
  const frameB = doc.insertBlock("frame", { title: "Frame B" }, { parent: surface });
  doc.setGeometry(frameB, { x: 320, y: 90, w: 200, h: 120 });
  const rect = doc.insertBlock("shape", { variant: "rect", fill: "rgba(9, 105, 218, 0.2)" }, { parent: surface });
  doc.setGeometry(rect, { x: -120, y: 90, w: 160, h: 80 });
  const ellipse = doc.insertBlock("shape", { variant: "ellipse" }, { parent: surface });
  doc.setGeometry(ellipse, { x: 40, y: 90, w: 100, h: 80 });
  const diamond = doc.insertBlock("shape", { variant: "diamond" }, { parent: surface });
  doc.setGeometry(diamond, { x: 160, y: 40, w: 90, h: 90 });
  const rounded = doc.insertBlock(
    "shape",
    {
      variant: "rounded",
      text: "Shape text",
      fontSize: 16,
      fontFamily: "Inter",
      textStyle: "semibold",
      textAlign: "center",
    },
    { parent: surface }
  );
  doc.setGeometry(rounded, { x: 60, y: -60, w: 160, h: 60 });
  // The canvas-text's font attrs' stand (the shape text's parity).
  const note = doc.insertBlock("canvas-text", { textColor: "#b45309", textStyle: "semibold" }, { parent: surface });
  doc.insertText(note, 0, "Canvas note");
  doc.setGeometry(note, { x: 140, y: -140, w: 200, h: 40 });
  // The connector is the topmost element (the z-order last): from the
  // frame's center to the rect's center.
  doc.insertBlock(
    "connector",
    { start: { blockId: frame }, end: { blockId: rect }, label: "relates to" },
    { parent: surface }
  );
  return { surface, frame };
}

export { seedCanvas };
