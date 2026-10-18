// @vitest-environment jsdom
// The wheel's zoom at the cursor (the native non-passive listener over
// the canvas container: the delta accumulates to the 100 px step
// threshold, the point under the pointer stands fixed) and the M key's
// mode switch (the select mode; the dock's button icon stands the
// current mode).
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { createDoc } from "docblocks-core";

import { Editor } from "../src/Editor";
import { EditorProvider } from "../src/EditorProvider";

const CREATED_AT = "2026-10-10T00:00:00.000Z";

interface Rendered {
  view: HTMLElement;
  world: () => HTMLElement;
  transform: () => string;
  pageText: () => HTMLElement;
}

function renderCanvas(): Rendered {
  const doc = createDoc({ id: "wheel-doc", createdAt: CREATED_AT });
  const paragraph = doc.insertBlock("paragraph");
  doc.insertText(paragraph, 0, "the line");
  const surface = doc.insertBlock("surface");
  const shape = doc.insertBlock("shape", { variant: "rect" }, { parent: surface });
  doc.setGeometry(shape, { x: 0, y: 0, w: 100, h: 60 });
  const { container } = render(
    <EditorProvider doc={doc}>
      <Editor view="canvas" />
    </EditorProvider>
  );
  const view = container.querySelector<HTMLElement>('[data-slot="docblocks/canvas-view"]');
  if (view === null) throw new Error("the canvas view is missing");
  return {
    view,
    world: () => {
      const el = view.querySelector<HTMLElement>('[data-slot="docblocks/canvas-world"]');
      if (el === null) throw new Error("the canvas world is missing");
      return el;
    },
    transform: () => {
      const el = view.querySelector<HTMLElement>('[data-slot="docblocks/canvas-world"]');
      if (el === null) throw new Error("the canvas world is missing");
      return el.style.transform;
    },
    pageText: () => {
      const el = view.querySelector<HTMLElement>('[data-slot="docblocks/block-content"]');
      if (el === null) throw new Error("the page's text is missing");
      return el;
    },
  };
}

afterEach(cleanup);

describe("the wheel's zoom at the cursor", () => {
  it("a notch zooms in at the pointer (the point under the cursor stands fixed)", () => {
    const r = renderCanvas();
    expect(r.transform()).toBe("translate(0px, 0px) scale(1)");

    // The mouse's notch (120 px) over the (100, 50) screen point (the
    // jsdom rect stands zero — the point is the client coords): the zoom
    // steps 1 → 1.1 and the pan compensates so the canvas point (100, 50)
    // stays under the cursor.
    fireEvent.wheel(r.view, { clientX: 100, clientY: 50, deltaY: -120 });
    expect(r.transform()).toBe("translate(-10px, -5px) scale(1.1)");
    // The invariant: (100 - (-10)) / 1.1 = 100 (the pre-zoom canvas x).
  });

  it("the delta accumulates to the step threshold (the small trackpad events)", () => {
    const r = renderCanvas();

    // 60 px stands no step (below the 100 px threshold).
    fireEvent.wheel(r.view, { clientX: 100, clientY: 50, deltaY: 60 });
    expect(r.transform()).toBe("translate(0px, 0px) scale(1)");

    // The second 60 px crosses the threshold (120 px accumulated): one
    // step out (the zoom 1 → 0.9, the pan compensates).
    fireEvent.wheel(r.view, { clientX: 100, clientY: 50, deltaY: 60 });
    expect(r.transform()).toBe("translate(10px, 5px) scale(0.9)");

    // The accumulator resets after the step: a third 60 px stands no step.
    fireEvent.wheel(r.view, { clientX: 100, clientY: 50, deltaY: 60 });
    expect(r.transform()).toBe("translate(10px, 5px) scale(0.9)");
  });

  it("stands no-op at the zoom bounds (the zoom and the pan keep)", () => {
    const r = renderCanvas();

    // Eight notches out stand the 25% floor (1 → 0.9 → … → 0.3 → 0.25).
    for (let i = 0; i < 8; i += 1) {
      fireEvent.wheel(r.view, { clientX: 100, clientY: 50, deltaY: 120 });
    }
    const atBound = r.transform();
    expect(atBound).toContain("scale(0.25)");

    // The fourth notch stands no step (the bound) — the transform keeps.
    fireEvent.wheel(r.view, { clientX: 100, clientY: 50, deltaY: 120 });
    expect(r.transform()).toBe(atBound);
  });

  it("zooms at the cursor in the pan mode too (the wheel is the zoom, not the pan)", () => {
    const r = renderCanvas();
    // The hand's toggle: the pan mode.
    fireEvent.click(screen.getByLabelText("Switch to the pan mode"));
    expect(screen.getByLabelText("Switch to the select mode")).toBeTruthy();

    // The wheel over the (100, 50) point: the zoom steps in (the pan
    // compensates the zoom — not a grab drag).
    fireEvent.wheel(r.view, { clientX: 100, clientY: 50, deltaY: -120 });
    expect(r.transform()).toBe("translate(-10px, -5px) scale(1.1)");
  });
});

describe("the M key's mode switch", () => {
  it("stands the select mode (the dock's button icon stands the current mode)", () => {
    const r = renderCanvas();

    // The select mode stands the pointer's icon.
    expect(screen.getByLabelText("Switch to the pan mode")).toBeTruthy();

    // The hand's toggle: the pan mode stands the hand's icon.
    fireEvent.click(screen.getByLabelText("Switch to the pan mode"));
    expect(screen.getByLabelText("Switch to the select mode")).toBeTruthy();
    expect(screen.getByLabelText("Switch to the select mode").querySelector("svg path")?.getAttribute("d")).toBe(
      "M18 11V6a2 2 0 0 0-2-2a2 2 0 0 0-2 2"
    );

    // The M key: back to the select mode (the pointer's icon).
    fireEvent.keyDown(r.view, { key: "m" });
    const select = screen.getByLabelText("Switch to the pan mode");
    expect(select.getAttribute("aria-pressed")).toBe("false");
    expect(select.querySelector("svg path")?.getAttribute("d")).toBe(
      "M4.037 4.688a.495.495 0 0 1 .651-.651l16 6.5a.5.5 0 0 1-.063.947l-6.124 1.58a2 2 0 0 0-1.438 1.435l-1.579 6.126a.5.5 0 0 1-.947.063z"
    );
  });

  it("stands no-op in the select mode (the doc stands)", () => {
    const r = renderCanvas();
    const before = r.transform();
    fireEvent.keyDown(r.view, { key: "m" });
    expect(r.transform()).toBe(before);
    expect(screen.getByLabelText("Switch to the pan mode")).toBeTruthy();
  });

  it("wins over the editing surface (the m is not typed, the mode switches)", () => {
    const r = renderCanvas();
    // The pan mode first.
    fireEvent.click(screen.getByLabelText("Switch to the pan mode"));
    expect(screen.getByLabelText("Switch to the select mode")).toBeTruthy();

    // The M key from the page's text (the editing surface): the default
    // action stands prevented (no "m" character) and the mode switches
    // to the select.
    const text = r.pageText();
    // The window's bubble listener stands last in the propagation (after
    // the React root's handler) — the defaultPrevented is the handler's
    // own call.
    let prevented = false;
    const listener = (event: Event) => {
      prevented = event.defaultPrevented;
    };
    window.addEventListener("keydown", listener);
    fireEvent.keyDown(text, { key: "m" });
    window.removeEventListener("keydown", listener);
    expect(prevented).toBe(true);
    expect(screen.getByLabelText("Switch to the pan mode")).toBeTruthy();
  });
});
