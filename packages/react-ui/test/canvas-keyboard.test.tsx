// @vitest-environment jsdom
// The canvas's keyboard model: the container stands a tab stop (the visible
// focus's ring), the arrows move the keyboard focus over the canvas items
// (the paint order, the wrap stand) over the selection's absence, the Enter
// selects the focused item (the shared blocks selection — the pointer
// click's parity), and the selection's arrows stand the nudge over the
// navigation.
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { createDoc } from "docblocks-core";

import { Editor } from "../src/Editor";
import { EditorProvider } from "../src/editor-provider";

const CREATED_AT = "2026-10-10T00:00:00.000Z";

type TestDoc = ReturnType<typeof createDoc>;

interface Rendered {
  doc: TestDoc;
  view: HTMLElement;
  shapeA: string;
  shapeB: string;
  text: string;
  itemOf: (id: string) => HTMLElement;
}

function renderCanvas(): Rendered {
  const doc = createDoc({ id: "canvas-kbd-doc", createdAt: CREATED_AT });
  const surface = doc.insertBlock("surface");
  const shapeA = doc.insertBlock("shape", { variant: "rect" }, { parent: surface });
  doc.setGeometry(shapeA, { x: -100, y: -50, w: 100, h: 60 });
  const shapeB = doc.insertBlock("shape", { variant: "ellipse" }, { parent: surface });
  doc.setGeometry(shapeB, { x: 100, y: 50, w: 80, h: 60 });
  const text = doc.insertBlock("canvas-text", undefined, { parent: surface });
  doc.setGeometry(text, { x: 0, y: 0, w: 100, h: 30 });
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
    shapeA,
    shapeB,
    text,
    itemOf: (id: string) => {
      const el = container.querySelector<HTMLElement>(`[data-slot="docblocks/canvas-item"][data-block-id="${id}"]`);
      if (el === null) throw new Error(`the canvas item ${id} is missing`);
      return el;
    },
  };
}

/** The kb-focused item's id (the data-kb-focused wrapper); null when none. */
function kbFocusedId(view: HTMLElement): string | null {
  const el = view.querySelector<HTMLElement>("[data-slot='docblocks/canvas-item'][data-kb-focused]");
  return el === null ? null : (el.dataset.blockId ?? null);
}

afterEach(() => {
  cleanup();
});

describe("the canvas's keyboard contract", () => {
  it("the container stands a tab stop (the role, the label, the tab index)", () => {
    const { view } = renderCanvas();
    expect(view.tabIndex).toBe(0);
    expect(view.getAttribute("role")).toBe("application");
    expect(view.getAttribute("aria-label")).toBe("Canvas");
  });

  it("the items stand the selection's announcement (the role, the label, the pressed state)", () => {
    const { view, shapeA } = renderCanvas();
    const item = view.querySelector<HTMLElement>(`[data-slot="docblocks/canvas-item"][data-block-id="${shapeA}"]`)!;
    expect(item.getAttribute("role")).toBe("button");
    expect(item.getAttribute("aria-label")).toBe("Shape block");
    expect(item.hasAttribute("aria-pressed")).toBe(false);
  });

  it("the arrows move the keyboard focus over the items (the paint order, the wrap stand)", () => {
    const { view, shapeA, shapeB, text } = renderCanvas();
    // The first arrow stands the first item (the paint order).
    fireEvent.keyDown(view, { key: "ArrowRight" });
    expect(kbFocusedId(view)).toBe(shapeA);
    // The next arrow steps to the next item.
    fireEvent.keyDown(view, { key: "ArrowDown" });
    expect(kbFocusedId(view)).toBe(shapeB);
    fireEvent.keyDown(view, { key: "ArrowRight" });
    expect(kbFocusedId(view)).toBe(text);
    // The wrap: the next stand returns to the first.
    fireEvent.keyDown(view, { key: "ArrowRight" });
    expect(kbFocusedId(view)).toBe(shapeA);
    // The backward stand wraps to the last.
    fireEvent.keyDown(view, { key: "ArrowLeft" });
    expect(kbFocusedId(view)).toBe(text);
  });

  it("the Enter selects the focused item (the selection stand + the pressed state)", async () => {
    const { doc, view, shapeA } = renderCanvas();
    fireEvent.keyDown(view, { key: "ArrowRight" });
    await act(async () => {
      fireEvent.keyDown(view, { key: "Enter" });
    });
    const item = view.querySelector<HTMLElement>(`[data-slot="docblocks/canvas-item"][data-block-id="${shapeA}"]`)!;
    expect(item.hasAttribute("data-selected")).toBe(true);
    expect(item.getAttribute("aria-pressed")).toBe("true");
    // The selection stands the shared view (the pointer click's parity).
    expect(doc.getBlock(shapeA)).not.toBeNull();
  });

  it("the selection's arrows stand the nudge over the navigation", async () => {
    const { doc, view, shapeA } = renderCanvas();
    const x0 = (doc.getBlock(shapeA) as { geometry?: { x?: number } }).geometry?.x;
    // The selection (the Enter's stand).
    fireEvent.keyDown(view, { key: "ArrowRight" });
    await act(async () => {
      fireEvent.keyDown(view, { key: "Enter" });
    });
    // The arrow over the selection's stand: the nudge (the x moves), the
    // kb focus stands (no navigation).
    await act(async () => {
      fireEvent.keyDown(view, { key: "ArrowRight" });
    });
    const x1 = (doc.getBlock(shapeA) as { geometry?: { x?: number } }).geometry?.x;
    expect(x1).toBe((x0 ?? 0) + 10); // the nudge's step (the 10 px's stand)
    expect(kbFocusedId(view)).toBe(shapeA);
  });

  it("the Delete removes the keyboard's selection (the doc stand + the selection's clear)", async () => {
    const { doc, view, shapeA, shapeB } = renderCanvas();
    fireEvent.keyDown(view, { key: "ArrowRight" });
    await act(async () => {
      fireEvent.keyDown(view, { key: "Enter" });
    });
    await act(async () => {
      fireEvent.keyDown(view, { key: "Delete" });
    });
    expect(doc.getBlock(shapeA)).toBeNull();
    expect(doc.getBlock(shapeB)).not.toBeNull();
  });
});
