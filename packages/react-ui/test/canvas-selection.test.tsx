// @vitest-environment jsdom
// The canvas mouse selection (the shift-click additive toggle, the
// shift-marquee union, the Escape clear, and the selection's visual
// contract: the selected item's thin cyan outline over the tint, the
// marquee's line only).
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { createDoc } from "docblocks-core";

import { Editor } from "../src/Editor";
import { EditorProvider } from "../src/EditorProvider";

const CREATED_AT = "2026-10-10T00:00:00.000Z";

type TestDoc = ReturnType<typeof createDoc>;

interface Seeded {
  doc: TestDoc;
  a: string;
  b: string;
  connector: string;
}

function seededDoc(): Seeded {
  const doc = createDoc({ id: "canvas-selection-doc", createdAt: CREATED_AT });
  const surface: string = doc.insertBlock("surface");
  const a = doc.insertBlock("shape", { variant: "rect" }, { parent: surface });
  doc.setGeometry(a, { x: -100, y: -50, w: 100, h: 60 });
  const b = doc.insertBlock("shape", { variant: "ellipse" }, { parent: surface });
  doc.setGeometry(b, { x: 100, y: 50, w: 80, h: 60 });
  const connector = doc.insertBlock("connector", { start: { blockId: a }, end: { blockId: b } }, { parent: surface });
  return { doc, a, b, connector };
}

interface Rendered {
  doc: TestDoc;
  view: HTMLElement;
  a: string;
  b: string;
  connector: string;
  wrapperOf: (id: string) => HTMLElement;
  json: () => ReturnType<TestDoc["toJSON"]>;
}

function renderCanvas(): Rendered {
  const { doc, a, b, connector } = seededDoc();
  const { container } = render(
    <EditorProvider doc={doc}>
      <Editor view="canvas" />
    </EditorProvider>
  );
  const view = container.querySelector<HTMLElement>('[data-slot="docblocks/canvas-view"]');
  if (view === null) throw new Error("the canvas view is missing");
  return {
    doc,
    a,
    b,
    connector,
    view,
    wrapperOf: (id: string) => {
      const el = container.querySelector<HTMLElement>(`[data-slot="docblocks/canvas-item"][data-block-id="${id}"]`);
      if (el === null) throw new Error(`the canvas item ${id} is missing`);
      return el;
    },
    json: () => doc.toJSON(),
  };
}

/** The selected ids (the data-selected wrappers). */
function selectedIds(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll<HTMLElement>("[data-slot='docblocks/canvas-item'][data-selected]")).map(
    (el) => el.dataset.blockId as string
  );
}

/** A plain click on the wrapper's center (the press starts a no-op move). */
function click(container: HTMLElement, id: string): void {
  const wrapper = container.querySelector<HTMLElement>(`[data-slot="docblocks/canvas-item"][data-block-id="${id}"]`)!;
  fireEvent.pointerDown(wrapper, { clientX: 10, clientY: 10, pointerId: 1 });
  fireEvent.pointerUp(wrapper, { pointerId: 1 });
}

/** A shift-click on the wrapper's center. */
function shiftClick(container: HTMLElement, id: string): void {
  const wrapper = container.querySelector<HTMLElement>(`[data-slot="docblocks/canvas-item"][data-block-id="${id}"]`)!;
  fireEvent.pointerDown(wrapper, { clientX: 10, clientY: 10, shiftKey: true, pointerId: 1 });
  fireEvent.pointerUp(wrapper, { pointerId: 1 });
}

describe("the shift-click toggle", () => {
  it("adds the id to the standing selection (no move, the doc stands)", () => {
    const r = renderCanvas();
    const before = JSON.stringify(r.json());
    click(r.view, r.a);
    expect(selectedIds(r.view)).toEqual([r.a]);

    shiftClick(r.view, r.b);
    expect(selectedIds(r.view)).toEqual([r.a, r.b]);
    expect(JSON.stringify(r.json())).toBe(before); // no update (a no-op move would stand the same)
    // The no-preview pin: the wrapper's transform stands its own (no move preview).
    expect(r.wrapperOf(r.b).style.transform).toBe("translate(-50%, -50%) rotate(0deg)");
  });

  it("removes the id from the selection (the anchor follows)", () => {
    const r = renderCanvas();
    click(r.view, r.a);
    shiftClick(r.view, r.b); // the anchor is b (the clicked id joins)
    expect(selectedIds(r.view).sort()).toEqual([r.a, r.b].sort());

    shiftClick(r.view, r.b); // the toggle removes b; the anchor falls back to a
    expect(selectedIds(r.view)).toEqual([r.a]);

    shiftClick(r.view, r.a); // the last id's removal stands no selection
    expect(selectedIds(r.view)).toEqual([]);
  });

  it("stands alone from an empty selection", () => {
    const r = renderCanvas();
    shiftClick(r.view, r.b);
    expect(selectedIds(r.view)).toEqual([r.b]);
  });

  it("toggles the connector over the hit path (the wrapper stands no outline)", () => {
    const r = renderCanvas();
    const hit = r.view.querySelector<SVGElement>(`[data-connector-hit="${r.connector}"]`);
    if (hit === null) throw new Error("the connector's hit path is missing");

    fireEvent.pointerDown(hit, { clientX: 5, clientY: 5, shiftKey: true, pointerId: 1 });
    fireEvent.pointerUp(hit, { pointerId: 1 });
    const line = r.view.querySelector<SVGPathElement>(`[data-connector-id="${r.connector}"]`)!;
    expect(line.getAttribute("data-selected")).toBe("true");

    // The connector's wrapper: no tint, no outline (the line's stroke is
    // its emphasis).
    const wrapper = r.wrapperOf(r.connector);
    expect(wrapper.classList.contains("bg-(--docblocks-selected-background)")).toBe(false);
    expect(wrapper.className).toBe("");

    // The toggle back: the line stands deselected.
    fireEvent.pointerDown(hit, { clientX: 5, clientY: 5, shiftKey: true, pointerId: 1 });
    fireEvent.pointerUp(hit, { pointerId: 1 });
    expect(line.getAttribute("data-selected")).toBe(null);
  });
});

describe("the shift-marquee union", () => {
  it("unions the marquee's ids with the standing selection", () => {
    const r = renderCanvas();
    click(r.view, r.a);
    expect(selectedIds(r.view)).toEqual([r.a]);

    // The additive marquee (the shift down on the empty canvas): jsdom
    // stands the wrappers 0x0 at the origin, so a rect crossing the
    // origin picks up both — the union adds b.
    const start = {
      x: r.view.getBoundingClientRect().x + r.view.clientWidth / 2,
      y: r.view.getBoundingClientRect().y + r.view.clientHeight / 2,
    };
    fireEvent.pointerDown(r.view, { clientX: start.x - 60, clientY: start.y - 40, shiftKey: true, pointerId: 2 });
    fireEvent.pointerMove(r.view, { clientX: start.x + 60, clientY: start.y + 40, buttons: 1, pointerId: 2 });
    fireEvent.pointerUp(r.view, { pointerId: 2 });
    // The union: a (the pre-marquee) + b (the marquee's pick).
    expect(selectedIds(r.view).sort()).toEqual([r.a, r.b].sort());
  });

  it("keeps the selection on the sub-3px additive press (no clear)", () => {
    const r = renderCanvas();
    click(r.view, r.a);

    // The shift press without a drag: the selection STANDS (the plain
    // press would clear it).
    const start = r.view.getBoundingClientRect();
    fireEvent.pointerDown(r.view, {
      clientX: start.x + start.width - 5,
      clientY: start.y + 5,
      shiftKey: true,
      pointerId: 3,
    });
    fireEvent.pointerUp(r.view, { pointerId: 3 });
    expect(selectedIds(r.view)).toEqual([r.a]);
  });
});

describe("the visual contract", () => {
  it("stands the selected item's outline over the tint", () => {
    const r = renderCanvas();
    click(r.view, r.a);
    const wrapper = r.wrapperOf(r.a);
    expect(wrapper.className).toContain("bg-(--docblocks-selected-background)");
    expect(wrapper.className).toContain("outline-(color:--docblocks-canvas-selection-border-color)");
    expect(wrapper.className).toContain("outline-(length:--docblocks-canvas-selection-border-width)");
    expect(wrapper.className).toContain("outline-offset-1");
    // The unselected item stands neither.
    expect(r.wrapperOf(r.b).className).toBe("");
  });

  it("stands the marquee's line + the 50% fill (the cyan selection tokens)", () => {
    const r = renderCanvas();
    const start = r.view.getBoundingClientRect();
    const cx = start.x + start.width / 2;
    const cy = start.y + start.height / 2;
    fireEvent.pointerDown(r.view, { clientX: cx - 40, clientY: cy - 30, pointerId: 4 });
    fireEvent.pointerMove(r.view, { clientX: cx + 40, clientY: cy + 30, buttons: 1, pointerId: 4 });
    const marquee = r.view.querySelector<HTMLElement>("[data-slot='docblocks/canvas-marquee']");
    expect(marquee).not.toBeNull();
    expect(marquee!.className).toContain("border-(--docblocks-canvas-selection-border-color)");
    expect(marquee!.className).toContain("border-(length:--docblocks-canvas-selection-border-width)");
    expect(marquee!.className).toContain("bg-(--docblocks-canvas-selection-fill)");
    expect(marquee!.className).not.toContain("bg-(--docblocks-selected-background)");
    expect(marquee!.className).not.toContain("border-(--docblocks-formatbar-border-color)");
    fireEvent.pointerUp(r.view, { pointerId: 4 });
  });
});

describe("the Escape clear", () => {
  it("clears the standing selection (nothing is written)", () => {
    const r = renderCanvas();
    click(r.view, r.a);
    const before = JSON.stringify(r.json());
    // The Escape clear stands on the editor root's blocks-selection path
    // (the page contract — the container's handler only intercepts the
    // tool / the in-flight session cancels, which stand first).
    fireEvent.keyDown(r.view, { key: "Escape" });
    expect(selectedIds(r.view)).toEqual([]);
    expect(JSON.stringify(r.json())).toBe(before);
  });

  it("does not clear while a move preview is in flight (the cancel stands first)", () => {
    const r = renderCanvas();
    const wrapper = r.wrapperOf(r.a);
    fireEvent.pointerDown(wrapper, { clientX: 100, clientY: 100, pointerId: 5 });
    fireEvent.pointerMove(r.view, { clientX: 140, clientY: 100, buttons: 1, pointerId: 5 }); // the preview stands
    expect(wrapper.style.transform).toContain("translate(40px, 0px)");

    // The Escape drops the preview; the selection STANDS.
    fireEvent.keyDown(r.view, { key: "Escape" });
    expect(wrapper.style.transform).toBe("translate(-50%, -50%) rotate(0deg)");
    expect(selectedIds(r.view)).toEqual([r.a]);
    // The release after the cancel writes nothing (the no-op contract).
    fireEvent.pointerUp(r.view, { pointerId: 5 });
    expect(r.doc.getBlock(r.a)?.geometry).toEqual({ x: -100, y: -50, w: 100, h: 60 });
  });

  it("stands the selection over a shift press on the page card (no root move, no clear)", () => {
    const r = renderCanvas();
    click(r.view, r.a);
    expect(selectedIds(r.view)).toEqual([r.a]);
    const card = r.view.querySelector<HTMLElement>("[data-slot='docblocks/page-card']");
    expect(card).not.toBeNull();
    const before = JSON.stringify(r.json());
    fireEvent.pointerDown(card!, { button: 0, shiftKey: true, clientX: 0, clientY: 0, pointerId: 9 });
    // The selection stands (the card's shift press starts no move).
    expect(selectedIds(r.view)).toEqual([r.a]);
    expect(JSON.stringify(r.json())).toBe(before);
  });

  it("keeps the base selection over an additive marquee that sweeps nothing", () => {
    const r = renderCanvas();
    click(r.view, r.a);
    const before = JSON.stringify(r.json());
    // The shift-marquee stands off every item (the 0x0 jsdom boxes stand
    // at the origin) — the empty union keeps the base selection.
    fireEvent.pointerDown(r.view, { button: 0, shiftKey: true, clientX: 500, clientY: 500, pointerId: 8 });
    fireEvent.pointerMove(r.view, { clientX: 600, clientY: 560, buttons: 1, pointerId: 8 });
    fireEvent.pointerUp(r.view, { pointerId: 8 });
    expect(selectedIds(r.view)).toEqual([r.a]);
    expect(JSON.stringify(r.json())).toBe(before);
  });
});

afterEach(cleanup);
