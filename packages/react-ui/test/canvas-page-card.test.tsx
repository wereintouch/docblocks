// @vitest-environment jsdom
// The page miniature's two-click contract (the editor over the canvas):
// the first press on the page's content selects the card (the root's
// one-item selection + the move session — a drag moves the miniature,
// a sub-threshold release stands the selection only), the second press
// (the card already selected) keeps the caret. The card stands the
// shared selection's outline while selected and the eight box handles
// (the rotate handle is gone from the editor — the negative pin below).
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createDoc, validateDoc } from "docblocks-core";

import { Editor } from "../src/Editor";
import { EditorProvider } from "../src/editor-provider";

const CREATED_AT = "2026-10-10T00:00:00.000Z";

type TestDoc = ReturnType<typeof createDoc>;

interface Rendered {
  doc: TestDoc;
  view: HTMLElement;
  surface: string;
  shape: string;
  card: () => HTMLElement;
  pageText: () => HTMLElement;
  handles: (view: HTMLElement) => HTMLElement[];
}

function renderCanvas(): Rendered {
  const doc = createDoc({ id: "page-card-doc", createdAt: CREATED_AT });
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
    surface,
    shape,
    card: () => {
      const el = view.querySelector<HTMLElement>('[data-slot="docblocks/page-card"]');
      if (el === null) throw new Error("the page card is missing");
      return el;
    },
    pageText: () => {
      const el = view.querySelector<HTMLElement>('[data-slot="docblocks/block-content"]');
      if (el === null) throw new Error("the page's text is missing");
      return el;
    },
    handles: (el) => Array.from(el.querySelectorAll<HTMLElement>('[data-slot="docblocks/canvas-handle"]')),
  };
}

const rootIdOf = (doc: TestDoc): string => doc.meta.id;

beforeEach(() => window.localStorage.clear());
afterEach(cleanup);

describe("the two-click contract", () => {
  it("the first press selects the card (the outline stands; the doc stands)", () => {
    const r = renderCanvas();
    const before = r.doc.toJSON();
    const text = r.pageText();

    fireEvent.pointerDown(text, { clientX: 100, clientY: 100, button: 0, buttons: 1, pointerId: 1 });
    fireEvent.pointerUp(r.view, { clientX: 100, clientY: 100, pointerId: 1 });

    // The selection: the root's one-item selection (the card's outline
    // stands, the no-op press writes nothing).
    expect(r.card().className).toContain("outline-(--docblocks-canvas-selection-border-color)");
    expect(r.doc.toJSON()).toEqual(before);
  });

  it("the first press's drag moves the miniature (one transact)", () => {
    const r = renderCanvas();
    const root = rootIdOf(r.doc);
    const text = r.pageText();

    fireEvent.pointerDown(text, { clientX: 100, clientY: 100, button: 0, buttons: 1, pointerId: 1 });
    fireEvent.pointerMove(r.view, { clientX: 140, clientY: 120, buttons: 1, pointerId: 1 });
    fireEvent.pointerUp(r.view, { clientX: 140, clientY: 120, pointerId: 1 });

    // The root's geometry lands at the screen delta (zoom 1, pan 0): the
    // effective box (the default page size) at (40, 20).
    const block = r.doc.getBlock(root);
    if (block === null || block.type !== "root") throw new Error("the root block is missing");
    expect(block.geometry).toEqual({ x: 40, y: 20, w: 720, h: 960 });
    // One undo step: the move is a single transact.
    r.doc.undo();
    expect(r.doc.getBlock(root)?.geometry).toBeUndefined();
    expect(validateDoc(r.doc.toJSON())).toEqual([]);
  });

  it("the second press keeps the caret (no move session, the doc stands)", () => {
    const r = renderCanvas();
    const before = r.doc.toJSON();
    const text = r.pageText();

    // The first press selects the card.
    fireEvent.pointerDown(text, { clientX: 100, clientY: 100, button: 0, buttons: 1, pointerId: 1 });
    fireEvent.pointerUp(r.view, { clientX: 100, clientY: 100, pointerId: 1 });
    expect(r.card().className).toContain("outline-(--docblocks-canvas-selection-border-color)");

    // The second press: the caret path (no session) — a drag stands no
    // preview and writes nothing (the native text gesture owns the drag).
    fireEvent.pointerDown(text, { clientX: 100, clientY: 100, button: 0, buttons: 1, pointerId: 2 });
    fireEvent.pointerMove(r.view, { clientX: 160, clientY: 130, buttons: 1, pointerId: 2 });
    fireEvent.pointerUp(r.view, { clientX: 160, clientY: 130, pointerId: 2 });
    expect(r.doc.toJSON()).toEqual(before);
  });

  it("the editing surfaces outside the card keep the plain caret press", () => {
    const r = renderCanvas();
    const before = r.doc.toJSON();
    // The seeded shape's press: the item's selection (not the card's).
    const wrapper = r.view.querySelector<HTMLElement>(
      `[data-slot="docblocks/canvas-item"][data-block-id="${r.shape}"]`
    );
    if (wrapper === null) throw new Error("the shape's wrapper is missing");
    fireEvent.pointerDown(wrapper, { clientX: 50, clientY: 50, button: 0, buttons: 1, pointerId: 1 });
    fireEvent.pointerUp(r.view, { clientX: 50, clientY: 50, pointerId: 1 });
    expect(r.card().className).not.toContain("outline-(--docblocks-canvas-selection-border-color)");
    expect(wrapper.getAttribute("data-selected")).toBe("true");
    expect(r.doc.toJSON()).toEqual(before);
  });
});

describe("the selection's outline", () => {
  it("drops the card's outline with the selection (the empty-canvas click)", () => {
    const r = renderCanvas();
    const text = r.pageText();

    fireEvent.pointerDown(text, { clientX: 100, clientY: 100, button: 0, buttons: 1, pointerId: 1 });
    fireEvent.pointerUp(r.view, { clientX: 100, clientY: 100, pointerId: 1 });
    expect(r.card().className).toContain("outline-(--docblocks-canvas-selection-border-color)");

    // The sub-threshold press on the empty canvas (outside the card)
    // clears the selection.
    fireEvent.pointerDown(r.view, { clientX: -40, clientY: -40, button: 0, buttons: 1, pointerId: 2 });
    fireEvent.pointerUp(r.view, { clientX: -40, clientY: -40, pointerId: 2 });
    expect(r.card().className).not.toContain("outline-(--docblocks-canvas-selection-border-color)");
  });
});

describe("the box handles", () => {
  it("stands the eight box handles (no rotate handle) for the shape and the page miniature", () => {
    const r = renderCanvas();
    const wrapper = r.view.querySelector<HTMLElement>(
      `[data-slot="docblocks/canvas-item"][data-block-id="${r.shape}"]`
    );
    if (wrapper === null) throw new Error("the shape's wrapper is missing");

    // The shape: the eight box handles, no rotate handle.
    fireEvent.pointerDown(wrapper, { clientX: 50, clientY: 50, button: 0, buttons: 1, pointerId: 1 });
    fireEvent.pointerUp(r.view, { clientX: 50, clientY: 50, pointerId: 1 });
    let handles = r.handles(r.view);
    expect(handles).toHaveLength(8);
    expect(handles.some((el) => el.dataset.handle === "rotate")).toBe(false);

    // The page card (selected from its content): the same eight box
    // handles, no rotate handle.
    const text = r.pageText();
    fireEvent.pointerDown(text, { clientX: 100, clientY: 100, button: 0, buttons: 1, pointerId: 2 });
    fireEvent.pointerUp(r.view, { clientX: 100, clientY: 100, pointerId: 2 });
    handles = r.handles(r.view);
    expect(handles).toHaveLength(8);
    expect(handles.some((el) => el.dataset.handle === "rotate")).toBe(false);
  });
});
