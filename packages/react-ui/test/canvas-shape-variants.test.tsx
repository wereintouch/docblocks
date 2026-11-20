// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { createDoc } from "docblocks-core";

import { Editor } from "../src/Editor";
import { EditorProvider } from "../src/editor-provider";
import { CREATED_AT } from "./canvas-scene";

afterEach(cleanup);

describe("canvas: shape variants", () => {
  it("renders the diamond, the rounded rectangle, and the freehand points (the variant figures)", () => {
    const doc = createDoc({ id: "outer", createdAt: CREATED_AT });
    doc.transact(() => {
      const surface = doc.insertBlock("surface");
      const diamond = doc.insertBlock("shape", { variant: "diamond" }, { parent: surface });
      doc.setGeometry(diamond, { x: -100, y: 0, w: 80, h: 80 });
      const rounded = doc.insertBlock("shape", { variant: "rounded" }, { parent: surface });
      doc.setGeometry(rounded, { x: 0, y: 0, w: 100, h: 40 });
      const freehand = doc.insertBlock(
        "shape",
        {
          variant: "rect",
          points: [
            [0, 0],
            [10, 5],
            [20, 0],
          ],
        },
        { parent: surface }
      );
      doc.setGeometry(freehand, { x: 100, y: 0, w: 40, h: 40 });
    });
    render(
      <EditorProvider doc={doc}>
        <Editor view="canvas" />
      </EditorProvider>
    );

    const diamond = document.querySelector<SVGElement>('[data-slot="docblocks/shape"][data-variant="diamond"]')!;
    // The 4-point polygon: the box midpoint corners (the 80x80 box, the stroke inset 1).
    expect(diamond.querySelector("polygon")!.getAttribute("points")).toBe("40,1 79,40 40,79 1,40");

    // The rounded rect: the rect with the corner radius (15% of the
    // smaller box side — the 100x40 box stands 6).
    const rounded = document.querySelector<SVGElement>('[data-slot="docblocks/shape"][data-variant="rounded"]')!;
    expect(rounded.querySelector("rect")!.getAttribute("rx")).toBe("6");

    // The freehand points win over the variant figure: a stroke path
    // through the block-local points.
    const freehand = document.querySelector<SVGElement>('[data-slot="docblocks/shape"][data-variant="rect"]')!;
    expect(freehand.querySelector("path")!.getAttribute("d")).toBe("M 0 0 L 10 5 L 20 0");
    expect(freehand.querySelector("rect")).toBeNull();
  });

  it("renders the cylinder and the cloud (the new figure variants)", () => {
    const doc = createDoc({ id: "outer", createdAt: CREATED_AT });
    doc.transact(() => {
      const surface = doc.insertBlock("surface");
      const cylinder = doc.insertBlock("shape", { variant: "cylinder" }, { parent: surface });
      doc.setGeometry(cylinder, { x: 0, y: 0, w: 100, h: 120 });
      const cloud = doc.insertBlock("shape", { variant: "cloud" }, { parent: surface });
      doc.setGeometry(cloud, { x: 150, y: 0, w: 130, h: 95 });
    });
    render(
      <EditorProvider doc={doc}>
        <Editor view="canvas" />
      </EditorProvider>
    );

    // The cylinder (the 100x120 box, the stroke inset 1): the body path
    // with the elliptical end caps (the cap's half-height 15 — the
    // box-proportional stand) + the top cap's seam arc (the front half,
    // the figure's tell; the stroke only).
    const cylinder = document.querySelector<SVGElement>('[data-slot="docblocks/shape"][data-variant="cylinder"]')!;
    const paths = cylinder.querySelectorAll("path");
    expect(paths.length).toBe(2);
    expect(paths[0]!.getAttribute("d")).toBe("M 1 16 A 49 15 0 0 1 99 16 L 99 104 A 49 15 0 0 1 1 104 Z");
    expect(paths[1]!.getAttribute("d")).toBe("M 1 16 A 49 15 0 0 0 99 16");
    expect(paths[1]!.getAttribute("fill")).toBe("none");

    // The cloud (the 130x95 box): the mirrored outline (the silhouette
    // flipped over the vertical axisthe
    // box-proportional stand, the arc radii scale anisotropically, the
    // stroke width stands, the inverse sweep flags).
    const cloud = document.querySelector<SVGElement>('[data-slot="docblocks/shape"][data-variant="cloud"]')!;
    const cloudPath = cloud.querySelector("path")!;
    expect(cloudPath.getAttribute("d")).toBe(
      "M 27.256410256410255 94 H 83.05128205128204 A 45.94871794871795 40.6875 0 1 0 39.00615384615384 41.6875 H 27.256410256410255 A 29.538461538461537 26.15625 0 1 0 27.256410256410255 94 Z"
    );
  });
});
