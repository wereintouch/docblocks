// @vitest-environment jsdom
// The canvas pan sessions: the hand's contract over the editing surfaces
// (a grab anywhere pans — no caret, no text selection) and the stale
// session drop (a lost release: a button-less move over a surviving
// session drops it — the world stands, no stale commit on the next
// release).
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { createDoc } from "docblocks-core";

import { Editor } from "../src/Editor";
import { EditorProvider } from "../src/EditorProvider";

const CREATED_AT = "2026-10-10T00:00:00.000Z";

type TestDoc = ReturnType<typeof createDoc>;

interface Rendered {
  doc: TestDoc;
  view: HTMLElement;
  shape: string;
  wrapperOf: (id: string) => HTMLElement;
  json: () => ReturnType<TestDoc["toJSON"]>;
}

function renderCanvas(): Rendered {
  const doc = createDoc({ id: "canvas-pan-doc", createdAt: CREATED_AT });
  const paragraph = doc.insertBlock("paragraph");
  doc.insertText(paragraph, 0, "the page line");
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
    doc,
    view,
    shape,
    wrapperOf: (id: string) => {
      const el = container.querySelector<HTMLElement>(`[data-slot="docblocks/canvas-item"][data-block-id="${id}"]`);
      if (el === null) throw new Error(`the canvas item ${id} is missing`);
      return el;
    },
    json: () => doc.toJSON(),
  };
}

/** The world wrapper's transform (the pan's carrier). */
function worldTransform(view: HTMLElement): string {
  const els = Array.from(view.querySelectorAll("div"));
  const world = els.find((el) => (el.getAttribute("style") ?? "").includes("scale("));
  return world?.getAttribute("style") ?? "";
}

/** The pan's translate part (the world wrapper's inline transform). */
function panOf(view: HTMLElement): { x: number; y: number } {
  const match = /translate\((-?[\d.]+)px,\s*(-?[\d.]+)px\)/.exec(worldTransform(view));
  if (match === null) throw new Error("the world wrapper's transform is missing");
  return { x: Number.parseFloat(match[1] ?? "0"), y: Number.parseFloat(match[2] ?? "0") };
}

function panMode(view: HTMLElement): void {
  const hand = view.querySelector<HTMLElement>('[aria-label="Switch to the pan mode"]');
  if (hand === null) throw new Error("the hand toggle is missing");
  fireEvent.click(hand);
}

/** The page miniature's editable text (an editing surface). */
function pageText(view: HTMLElement): HTMLElement {
  const card = view.querySelector<HTMLElement>("[data-slot='docblocks/page-card']");
  const inner = card?.querySelector<HTMLElement>('[data-slot="docblocks/block-content"]');
  if (inner === null || inner === undefined) throw new Error("the page miniature's text is missing");
  return inner;
}

afterEach(cleanup);

describe("the hand over the editing surfaces", () => {
  it("pans from the page miniature's text (no caret, no text selection)", () => {
    const r = renderCanvas();
    panMode(r.view);
    const text = pageText(r.view);
    const before = panOf(r.view);
    fireEvent.pointerDown(text, { clientX: 100, clientY: 100, buttons: 1, pointerId: 1 });
    fireEvent.pointerMove(r.view, { clientX: 160, clientY: 130, buttons: 1, pointerId: 1 });
    const after = panOf(r.view);
    expect({ x: after.x - before.x, y: after.y - before.y }).toEqual({ x: 60, y: 30 });
    fireEvent.pointerUp(r.view, { pointerId: 1 });
  });

  it("keeps the caret over the page miniature's text in the pointer mode (the guard stands)", () => {
    const r = renderCanvas();
    const text = pageText(r.view);
    const before = panOf(r.view);
    // The pointer mode (no pan): the editing surface keeps the press (the
    // text's caret / selection), the canvas stands.
    fireEvent.pointerDown(text, { clientX: 100, clientY: 100, buttons: 1, pointerId: 1 });
    fireEvent.pointerMove(r.view, { clientX: 160, clientY: 130, buttons: 1, pointerId: 1 });
    expect(panOf(r.view)).toEqual(before);
    fireEvent.pointerUp(r.view, { pointerId: 1 });
  });
});

describe("the stale session drop (the lost release)", () => {
  it("drops the surviving pan session (the button-less move stands the world)", () => {
    const r = renderCanvas();
    panMode(r.view);
    fireEvent.pointerDown(r.view, { clientX: 100, clientY: 100, buttons: 1, pointerId: 1 });
    fireEvent.pointerMove(r.view, { clientX: 140, clientY: 120, buttons: 1, pointerId: 1 });
    const panned = panOf(r.view);
    // The lost release: no pointerup — the button-less move (the pointer
    // stands, no button held) drops the surviving session.
    fireEvent.pointerMove(r.view, { clientX: 200, clientY: 200, buttons: 0, pointerId: 1 });
    expect(panOf(r.view)).toEqual(panned);
    // Another button-less move: the world stands (the session is gone).
    fireEvent.pointerMove(r.view, { clientX: 300, clientY: 300, buttons: 0, pointerId: 1 });
    expect(panOf(r.view)).toEqual(panned);
  });

  it("drops the in-flight move session (the release after the drop writes nothing)", () => {
    const r = renderCanvas();
    const wrapper = r.wrapperOf(r.shape);
    fireEvent.pointerDown(wrapper, { clientX: 100, clientY: 100, buttons: 1, pointerId: 2 });
    fireEvent.pointerMove(r.view, { clientX: 150, clientY: 100, buttons: 1, pointerId: 2 });
    expect(wrapper.style.transform).toContain("translate(50px,");
    const before = JSON.stringify(r.json());
    // The lost release: the button-less move drops the session (the
    // preview stands down).
    fireEvent.pointerMove(r.view, { clientX: 160, clientY: 100, buttons: 0, pointerId: 2 });
    expect(wrapper.style.transform).toBe("translate(-50%, -50%) rotate(0deg)");
    // The release after the drop writes nothing (the stale commit would
    // stand the geometry at the lost drag's delta).
    fireEvent.pointerUp(r.view, { pointerId: 2 });
    expect(JSON.stringify(r.json())).toBe(before);
  });

  it("drops the in-flight marquee (the standing rectangle stands down)", () => {
    const r = renderCanvas();
    fireEvent.pointerDown(r.view, { clientX: 100, clientY: 100, buttons: 1, pointerId: 3 });
    fireEvent.pointerMove(r.view, { clientX: 200, clientY: 160, buttons: 1, pointerId: 3 });
    expect(r.view.querySelector("[data-slot='docblocks/canvas-marquee']")).not.toBeNull();
    // The lost release: the button-less move drops the marquee (no
    // selection write either — the plain press's clear stands only on a
    // real release).
    fireEvent.pointerMove(r.view, { clientX: 220, clientY: 180, buttons: 0, pointerId: 3 });
    expect(r.view.querySelector("[data-slot='docblocks/canvas-marquee']")).toBeNull();
    expect(r.view.querySelectorAll("[data-slot='docblocks/canvas-item'][data-selected]")).toHaveLength(0);
  });
});
