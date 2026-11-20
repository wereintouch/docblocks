// The canvas hit resolver: the press zones (a filled figure's box, a
// stroke-only figure's outline by variant, the invisible figure's box, the
// container / the frame's border band, the connector's stroke band along the
// rendered route), the screen-px tolerance over the zoom, and the cycle
// stack's order (the paint order with the member lifted above its
// containers, transitively, the mutual membership guarded).
import { describe, expect, it } from "vitest";

import { createDoc } from "docblocks-core";

import { hitStackAt, pressHitAt } from "../src/canvas/canvas-view/hit-stack";
import { connectorLineGeometryOf } from "../src/canvas/connector-line-geometry";
import { flattenPath, outlineDistanceOf } from "../src/canvas/shape-contour";
import { shapeOutlinePath } from "../src/canvas/shape-outline";

const CREATED_AT = "2026-11-19T00:00:00.000Z";

type TestDoc = ReturnType<typeof createDoc>;

function seedDoc(docId: string): { doc: TestDoc; surface: string } {
  const doc = createDoc({ id: docId, createdAt: CREATED_AT });
  const surface = doc.insertBlock("surface");
  return { doc, surface };
}

/** A shape with the given attrs and box (the center anchor). */
function seedShape(
  doc: TestDoc,
  surface: string,
  attrs: Record<string, unknown>,
  box: { x: number; y: number; w: number; h: number }
): string {
  const id = doc.insertBlock("shape", attrs as never, { parent: surface });
  doc.setGeometry(id, box);
  return id;
}

/** The hit at the point (the press's answer's id, `null` over no zone). */
function hitIdAt(doc: TestDoc, point: { x: number; y: number }, zoom = 1): string | null {
  return pressHitAt(doc, point, zoom)?.id ?? null;
}

describe("the press zones (the plain click's answer)", () => {
  it("stands the whole box over a filled figure and nothing outside it", () => {
    const { doc, surface } = seedDoc("hit-fill");
    const id = seedShape(doc, surface, { variant: "rect", fill: "#dbeafe" }, { x: 0, y: 0, w: 100, h: 60 });
    expect(hitIdAt(doc, { x: 0, y: 0 })).toBe(id);
    expect(hitIdAt(doc, { x: -40, y: 20 })).toBe(id);
    expect(hitIdAt(doc, { x: 60, y: 0 })).toBeNull();
  });

  it("stands the whole box over a figure with an absent fill (the normal figure)", () => {
    const { doc, surface } = seedDoc("hit-absent-fill");
    const id = seedShape(doc, surface, { variant: "rect" }, { x: 0, y: 0, w: 100, h: 60 });
    expect(hitIdAt(doc, { x: 0, y: 0 })).toBe(id);
  });

  it("stands the outline over an explicitly transparent rect (the interior passes through)", () => {
    const { doc, surface } = seedDoc("hit-nofill-rect");
    const id = seedShape(doc, surface, { variant: "rect", fill: "none" }, { x: 0, y: 0, w: 100, h: 60 });
    expect(hitIdAt(doc, { x: 0, y: 0 })).toBeNull();
    expect(hitIdAt(doc, { x: -50, y: 0 })).toBe(id); // the left edge's midpoint
    expect(hitIdAt(doc, { x: 0, y: 30 })).toBe(id); // the bottom edge's midpoint
    expect(hitIdAt(doc, { x: -50, y: 30 })).toBe(id); // the corner
  });

  it("stands the arc over a stroke-only ellipse (the box's corner passes through)", () => {
    const { doc, surface } = seedDoc("hit-nofill-ellipse");
    const id = seedShape(doc, surface, { variant: "ellipse", fill: "none" }, { x: 0, y: 0, w: 100, h: 60 });
    expect(hitIdAt(doc, { x: -50, y: 0 })).toBe(id); // the left vertex
    expect(hitIdAt(doc, { x: 0, y: -30 })).toBe(id); // the top vertex
    expect(hitIdAt(doc, { x: -46, y: -26 })).toBeNull(); // the box's corner region
  });

  it("stands the diamond's edges over a stroke-only diamond (the box's corner region passes through)", () => {
    const { doc, surface } = seedDoc("hit-nofill-diamond");
    const id = seedShape(doc, surface, { variant: "diamond", fill: "none" }, { x: 0, y: 0, w: 100, h: 60 });
    expect(hitIdAt(doc, { x: 0, y: -30 })).toBe(id); // the top vertex
    expect(hitIdAt(doc, { x: -50, y: 0 })).toBe(id); // the left vertex
    expect(hitIdAt(doc, { x: -44, y: -24 })).toBeNull(); // the box's top-left corner region
  });

  it("stands the variant's own outline over the cylinder / the cloud / the freehand stroke", () => {
    const { doc, surface } = seedDoc("hit-nofill-paths");
    const cases: { attrs: Record<string, unknown>; box: { x: number; y: number; w: number; h: number } }[] = [
      { attrs: { variant: "cylinder", fill: "none" }, box: { x: 0, y: 0, w: 100, h: 80 } },
      { attrs: { variant: "cloud", fill: "none" }, box: { x: 0, y: 0, w: 120, h: 90 } },
      {
        attrs: {
          variant: "rect",
          fill: "none",
          points: [
            [10, 10],
            [90, 10],
            [50, 60],
          ],
        },
        box: { x: 0, y: 0, w: 100, h: 70 },
      },
    ];
    for (const { attrs, box } of cases) {
      const id = seedShape(doc, surface, attrs, box);
      const outline = shapeOutlinePath(attrs as never, { w: box.w, h: box.h })!;
      const points = flattenPath(outline);
      // A point of the figure's own flattened outline stands the hit; the
      // box's centre stands off (no fill).
      const vertex = points[Math.floor(points.length / 2)]!;
      const world = { x: box.x - box.w / 2 + vertex.x, y: box.y - box.h / 2 + vertex.y };
      expect(hitIdAt(doc, world), `the ${String(attrs.variant)}'s outline`).toBe(id);
      expect(hitIdAt(doc, { x: box.x, y: box.y }), `the ${String(attrs.variant)}'s centre`).toBeNull();
      doc.removeBlock(id);
    }
  });

  it("stands the legacy line's segment over its box (the diagonal only)", () => {
    // The legacy variant is read-only data (the validator rejects it on
    // write): the outline stands its own geometry's band.
    const attrs = { variant: "line" } as never;
    const box = { w: 100, h: 100 };
    expect(shapeOutlinePath(attrs, box)).toBe("M 0 0 L 100 100");
    expect(outlineDistanceOf(attrs, box, { x: 50, y: 50 })).toBe(0);
    expect(outlineDistanceOf(attrs, box, { x: 90, y: 10 })!).toBeGreaterThan(20);
  });

  it("stands the whole box over an invisible figure (no fill, no stroke) and over the zero opacity", () => {
    const { doc, surface } = seedDoc("hit-invisible");
    const invisible = seedShape(
      doc,
      surface,
      { variant: "rect", fill: "none", stroke: "none" },
      {
        x: 0,
        y: 0,
        w: 100,
        h: 60,
      }
    );
    expect(hitIdAt(doc, { x: 0, y: 0 })).toBe(invisible);
    const transparent = seedShape(doc, surface, { variant: "rect", opacity: 0 }, { x: 400, y: 0, w: 100, h: 60 });
    expect(hitIdAt(doc, { x: 400, y: 0 })).toBe(transparent);
  });

  it("keeps the tolerance in screen px over the zoom (the band narrows in world px)", () => {
    const { doc, surface } = seedDoc("hit-zoom-tolerance");
    const id = seedShape(doc, surface, { variant: "rect", fill: "none" }, { x: 0, y: 0, w: 100, h: 60 });
    // 4 world px off the left edge (the outline's inset is 1 px).
    const point = { x: -54, y: 0 };
    expect(hitIdAt(doc, point, 1)).toBe(id); // the 6 px band
    expect(hitIdAt(doc, point, 2)).toBeNull(); // the 3 px band
    expect(hitIdAt(doc, point, 0.25)).toBe(id); // the 24 px band
  });
});

describe("the container / the frame's zones", () => {
  it("presses the border's band only; the interior stands the item beneath", () => {
    const { doc, surface } = seedDoc("hit-group-band");
    const group = doc.insertBlock("group", { members: [] }, { parent: surface });
    doc.setGeometry(group, { x: 0, y: 0, w: 200, h: 120 });
    expect(hitIdAt(doc, { x: 0, y: -60 })).toBe(group); // the top edge's midpoint
    expect(hitIdAt(doc, { x: 0, y: 0 })).toBeNull(); // the interior
    const frame = doc.insertBlock("frame", undefined, { parent: surface });
    doc.setGeometry(frame, { x: 0, y: 400, w: 200, h: 120 });
    expect(hitIdAt(doc, { x: 0, y: 340 })).toBe(frame); // the top edge's midpoint
    expect(hitIdAt(doc, { x: 0, y: 400 })).toBeNull(); // the interior
  });

  it("takes the interior as the STACK zone (the drill-down reaches the container)", () => {
    const { doc, surface } = seedDoc("hit-group-stack");
    const group = doc.insertBlock("group", { members: [] }, { parent: surface });
    doc.setGeometry(group, { x: 0, y: 0, w: 200, h: 120 });
    expect(hitStackAt(doc, { x: 0, y: 0 }, 1).map((candidate) => candidate.id)).toEqual([group]);
  });
});

describe("the connector's stroke band", () => {
  const variants = ["straight", "orthogonal", "curved"] as const;
  for (const variant of variants) {
    it(`stands the rendered ${variant} route and not its bounding box`, () => {
      const { doc, surface } = seedDoc(`hit-connector-${variant}`);
      const a = seedShape(doc, surface, { variant: "rect", fill: "#fff" }, { x: -200, y: -80, w: 80, h: 60 });
      const b = seedShape(doc, surface, { variant: "rect", fill: "#fff" }, { x: 200, y: 80, w: 80, h: 60 });
      const connector = doc.insertBlock(
        "connector",
        { start: { blockId: a }, end: { blockId: b }, variant },
        {
          parent: surface,
        }
      );
      const children = doc.getChildren(surface);
      const blocks = Object.fromEntries(
        children.flatMap((id) => {
          const block = doc.getBlock(id);
          return block === null ? [] : [[id, block]];
        })
      );
      const block = doc.getBlock(connector);
      if (block === null || block.type !== "connector") throw new Error("the connector is missing");
      const path = connectorLineGeometryOf(connector, block, children, blocks, {
        movePreview: null,
        resizePreview: null,
        endpointDrag: null,
        endpointPreview: null,
      })!.path;
      const points = flattenPath(path);
      // A route vertex stands the hit; the bounding box's corner stands off
      // (the band is the route, not the box).
      const vertex = points[Math.floor(points.length / 2)]!;
      expect(hitIdAt(doc, vertex)).toBe(connector);
      expect(hitIdAt(doc, { x: -200, y: 140 })).toBeNull();
    });
  }
});

describe("the cycle stack's order", () => {
  it("orders by the paint order (the later sibling stands on top)", () => {
    const { doc, surface } = seedDoc("hit-stack-paint");
    const first = seedShape(doc, surface, { variant: "rect", fill: "#fff" }, { x: 0, y: 0, w: 100, h: 60 });
    const second = seedShape(doc, surface, { variant: "rect", fill: "#fff" }, { x: 0, y: 0, w: 120, h: 80 });
    expect(hitStackAt(doc, { x: 0, y: 0 }, 1).map((candidate) => candidate.id)).toEqual([second, first]);
  });

  it("lifts a member above its container, transitively", () => {
    const { doc, surface } = seedDoc("hit-stack-nested");
    const outer = doc.insertBlock("group", { members: [] }, { parent: surface });
    doc.setGeometry(outer, { x: 0, y: 0, w: 400, h: 300 });
    const inner = doc.insertBlock("group", { members: [] }, { parent: surface });
    doc.setGeometry(inner, { x: 0, y: 0, w: 200, h: 150 });
    const member = seedShape(doc, surface, { variant: "rect", fill: "#fff" }, { x: 0, y: 0, w: 80, h: 60 });
    doc.transact(() => {
      doc.updateBlock(outer, { members: [inner] });
      doc.updateBlock(inner, { members: [member] });
    });
    // The paint order stands outer, inner, member — the lift puts the member
    // first, then the inner container, then the outer.
    expect(hitStackAt(doc, { x: 0, y: 0 }, 1).map((candidate) => candidate.id)).toEqual([member, inner, outer]);
  });

  it("lifts a multi-owned member above every container that lists it", () => {
    const { doc, surface } = seedDoc("hit-stack-multi-owner");
    const first = doc.insertBlock("group", { members: [] }, { parent: surface });
    doc.setGeometry(first, { x: 0, y: 0, w: 300, h: 200 });
    const second = doc.insertBlock("group", { members: [] }, { parent: surface });
    doc.setGeometry(second, { x: 0, y: 0, w: 200, h: 160 });
    const member = seedShape(doc, surface, { variant: "rect", fill: "#fff" }, { x: 0, y: 0, w: 60, h: 40 });
    doc.transact(() => {
      doc.updateBlock(first, { members: [member] });
      doc.updateBlock(second, { members: [member] });
    });
    expect(hitStackAt(doc, { x: 0, y: 0 }, 1).map((candidate) => candidate.id)).toEqual([member, second, first]);
  });

  it("survives a mutual membership (the remaining candidates stand their paint order)", () => {
    const { doc, surface } = seedDoc("hit-stack-mutual");
    const a = doc.insertBlock("group", { members: [] }, { parent: surface });
    doc.setGeometry(a, { x: 0, y: 0, w: 300, h: 200 });
    const b = doc.insertBlock("group", { members: [] }, { parent: surface });
    doc.setGeometry(b, { x: 0, y: 0, w: 200, h: 160 });
    doc.transact(() => {
      doc.updateBlock(a, { members: [b] });
      doc.updateBlock(b, { members: [a] });
    });
    expect(hitStackAt(doc, { x: 0, y: 0 }, 1).map((candidate) => candidate.id)).toEqual([b, a]);
  });

  it("keeps the connectors out of the stack (the direct grab is their access)", () => {
    const { doc, surface } = seedDoc("hit-stack-connector");
    const a = seedShape(doc, surface, { variant: "rect", fill: "#fff" }, { x: -200, y: 0, w: 80, h: 60 });
    const b = seedShape(doc, surface, { variant: "rect", fill: "#fff" }, { x: 200, y: 0, w: 80, h: 60 });
    doc.insertBlock("connector", { start: { blockId: a }, end: { blockId: b } }, { parent: surface });
    expect(hitStackAt(doc, { x: 0, y: 0 }, 1)).toEqual([]);
  });

  it("orders the surfaces by the root's children's order", () => {
    const { doc, surface } = seedDoc("hit-stack-surfaces");
    const lower = seedShape(doc, surface, { variant: "rect", fill: "#fff" }, { x: 0, y: 0, w: 100, h: 60 });
    const second = doc.insertBlock("surface");
    const upper = seedShape(doc, second, { variant: "rect", fill: "#fff" }, { x: 0, y: 0, w: 100, h: 60 });
    expect(second).toBeTruthy();
    expect(hitStackAt(doc, { x: 0, y: 0 }, 1).map((candidate) => candidate.id)).toEqual([upper, lower]);
  });
});
