// @vitest-environment jsdom
// The canvas drill-down: the Alt press steps the stack at the point (the
// top when the current candidate stands outside it) and wraps, the plain
// repeat press inside the session's radius / window steps the same way, the
// session drops over the camera / the tool / a drag, the touch pointer
// stands the wider radius, the double-click's own entries win over the
// repeat press over an inline-editable target, and the `i / N` indicator
// fades after its window.
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createDoc } from "docblocks-core";

import { Editor } from "../src/Editor";
import { EditorProvider } from "../src/editor-provider";
import { pressAt } from "./canvas-press";

const CREATED_AT = "2026-11-19T00:00:00.000Z";

type TestDoc = ReturnType<typeof createDoc>;

interface Rendered {
  doc: TestDoc;
  view: HTMLElement;
  top: string;
  bottom: string;
}

/** The overlapping pair: the later shape paints on top (the stack's top). */
function renderStack(): Rendered {
  const doc = createDoc({ id: "canvas-cycle-doc", createdAt: CREATED_AT });
  const surface = doc.insertBlock("surface");
  const bottom = doc.insertBlock("shape", { variant: "rect", fill: "#dbeafe" }, { parent: surface });
  doc.setGeometry(bottom, { x: 0, y: 0, w: 200, h: 120 });
  const top = doc.insertBlock("shape", { variant: "rect", fill: "#fee2e2" }, { parent: surface });
  doc.setGeometry(top, { x: 0, y: 0, w: 120, h: 80 });
  const { container } = render(
    <EditorProvider doc={doc}>
      <Editor view="canvas" />
    </EditorProvider>
  );
  const view = container.querySelector<HTMLElement>('[data-slot="docblocks/canvas-view"]')!;
  return { doc, view, top, bottom };
}

/** The selected ids (the data-selected wrappers). */
function selectedIds(view: HTMLElement): string[] {
  return Array.from(view.querySelectorAll<HTMLElement>("[data-slot='docblocks/canvas-item'][data-selected]")).map(
    (element) => element.dataset.blockId as string
  );
}

/** The `i / N` indicator's read (null outside its fade). */
function indicator(view: HTMLElement): { index: string | null; count: string | null; text: string } | null {
  const chip = view.querySelector<HTMLElement>("[data-slot='docblocks/canvas-cycle-indicator']");
  if (chip === null) return null;
  return { index: chip.dataset.index ?? null, count: chip.dataset.count ?? null, text: chip.textContent ?? "" };
}

const SHARED_POINT = { x: 0, y: 0 };

beforeEach(() => {
  window.localStorage.clear();
  vi.useFakeTimers();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("the Alt press (the positional drill-down)", () => {
  it("steps the stack from its top and wraps, with the i / N indicator", () => {
    const r = renderStack();
    pressAt(r.view, SHARED_POINT, { altKey: true });
    expect(selectedIds(r.view)).toEqual([r.top]);
    expect(indicator(r.view)).toMatchObject({ index: "1", count: "2" });
    pressAt(r.view, SHARED_POINT, { altKey: true });
    expect(selectedIds(r.view)).toEqual([r.bottom]);
    expect(indicator(r.view)).toMatchObject({ index: "2", count: "2" });
    pressAt(r.view, SHARED_POINT, { altKey: true });
    expect(selectedIds(r.view)).toEqual([r.top]);
    expect(indicator(r.view)).toMatchObject({ index: "1", count: "2" });
  });

  it("replaces a multi-selection with the one candidate", () => {
    const r = renderStack();
    // The multi-selection: the far block joins the stack's top (the shift
    // click's additive toggle).
    const surface = r.doc.getChildren(r.doc.meta.id)[0]!;
    const far = r.doc.insertBlock("shape", { variant: "rect", fill: "#fff" }, { parent: surface });
    r.doc.setGeometry(far, { x: 0, y: 500, w: 80, h: 60 });
    act(() => {
      // The store's change flush (the new block lands in the document map
      // before the press).
      r.doc.getBlock(far);
    });
    pressAt(r.view, { x: 0, y: 500 }, { shiftKey: true });
    pressAt(r.view, SHARED_POINT, { shiftKey: true });
    expect(selectedIds(r.view).sort()).toEqual([far, r.top].sort());
    pressAt(r.view, SHARED_POINT, { altKey: true });
    expect(selectedIds(r.view)).toEqual([r.bottom]);
  });

  it("continues from the current candidate when the selection stands in the stack", () => {
    const r = renderStack();
    pressAt(r.view, SHARED_POINT); // the plain press selects the top
    expect(selectedIds(r.view)).toEqual([r.top]);
    pressAt(r.view, SHARED_POINT, { altKey: true });
    expect(selectedIds(r.view)).toEqual([r.bottom]);
  });

  it("enters at the top when the current candidate stands outside the new stack", () => {
    const r = renderStack();
    // The selection stands on a far block: the Alt press at the pair's point
    // starts the cycle from the pair's top.
    const far = r.doc.insertBlock(
      "shape",
      { variant: "rect", fill: "#fff" },
      {
        parent: r.doc.getChildren(r.doc.meta.id)[0]!,
      }
    );
    r.doc.setGeometry(far, { x: 0, y: 500, w: 80, h: 60 });
    act(() => {
      pressAt(r.view, { x: 0, y: 500 });
    });
    expect(selectedIds(r.view)).toEqual([far]);
    pressAt(r.view, SHARED_POINT, { altKey: true });
    expect(selectedIds(r.view)).toEqual([r.top]);
    expect(indicator(r.view)).toMatchObject({ index: "1", count: "2" });
  });
});

describe("the plain repeat press", () => {
  it("steps the stack inside the window, and the camera's move drops the session", () => {
    const r = renderStack();
    pressAt(r.view, SHARED_POINT);
    expect(selectedIds(r.view)).toEqual([r.top]);
    pressAt(r.view, SHARED_POINT);
    expect(selectedIds(r.view)).toEqual([r.bottom]);
    expect(indicator(r.view)).toMatchObject({ index: "2", count: "2" });
    // The camera's step drops the session: the next press stands a plain
    // select (the top), no indicator.
    act(() => {
      r.view.closest<HTMLElement>('[data-slot="docblocks/canvas-view"]')!;
      const zoomIn = Array.from(r.view.querySelectorAll<HTMLElement>("button")).find(
        (button) => button.getAttribute("aria-label") === "Zoom in"
      );
      zoomIn?.click();
    });
    pressAt(r.view, SHARED_POINT);
    expect(selectedIds(r.view)).toEqual([r.top]);
    expect(indicator(r.view)).toBeNull();
  });

  it("stands no step over a single-candidate stack, and the tool's pick drops the session", () => {
    const doc = createDoc({ id: "canvas-cycle-single", createdAt: CREATED_AT });
    const surface = doc.insertBlock("surface");
    const only = doc.insertBlock("shape", { variant: "rect", fill: "#dbeafe" }, { parent: surface });
    doc.setGeometry(only, { x: 0, y: 0, w: 200, h: 120 });
    const { container } = render(
      <EditorProvider doc={doc}>
        <Editor view="canvas" />
      </EditorProvider>
    );
    const view = container.querySelector<HTMLElement>('[data-slot="docblocks/canvas-view"]')!;
    pressAt(view, SHARED_POINT);
    pressAt(view, SHARED_POINT);
    // The single candidate's repeat press stands the plain select, no step.
    expect(selectedIds(view)).toEqual([only]);
    expect(indicator(view)).toBeNull();
  });

  it("stands the wider radius for the touch pointer", () => {
    const r = renderStack();
    pressAt(r.view, SHARED_POINT);
    // 12 px away: outside the mouse's 8 px, inside the touch's 18 px.
    pressAt(r.view, { x: 12, y: 0 }, { pointerType: "touch", pointerId: 5 });
    expect(selectedIds(r.view)).toEqual([r.bottom]);
    expect(indicator(r.view)).toMatchObject({ index: "2", count: "2" });
  });

  it("drops the session over a drag (the press was a move, not a step)", () => {
    const r = renderStack();
    pressAt(r.view, SHARED_POINT);
    fireEvent.pointerDown(r.view, { button: 0, clientX: 0, clientY: 0, pointerId: 7 });
    fireEvent.pointerMove(r.view, { clientX: 40, clientY: 20, buttons: 1, pointerId: 7 });
    fireEvent.pointerUp(r.view, { pointerId: 7 });
    // The drag's move drops the session: the press after it stands a plain
    // select of the top (the small figure did not ride the drag — the stepped
    // candidate, the bottom, moved).
    pressAt(r.view, { x: 0, y: 0 });
    expect(indicator(r.view)).toBeNull();
  });

  it("wins no repeat over an inline-editable target inside the double-click's interval", () => {
    const doc = createDoc({ id: "canvas-cycle-editable", createdAt: CREATED_AT });
    const surface = doc.insertBlock("surface");
    const under = doc.insertBlock("shape", { variant: "rect", fill: "#fee2e2" }, { parent: surface });
    doc.setGeometry(under, { x: 0, y: 0, w: 200, h: 120 });
    const shape = doc.insertBlock("shape", { variant: "rect", fill: "#dbeafe", text: "label" }, { parent: surface });
    doc.setGeometry(shape, { x: 0, y: 0, w: 120, h: 80 });
    const { container } = render(
      <EditorProvider doc={doc}>
        <Editor view="canvas" />
      </EditorProvider>
    );
    const view = container.querySelector<HTMLElement>('[data-slot="docblocks/canvas-view"]')!;
    pressAt(view, SHARED_POINT);
    // The second press inside the double-click's interval over the shape's
    // inline text: the editor's entry, not the cycle's step.
    pressAt(view, SHARED_POINT, { detail: 2 });
    expect(indicator(view)).toBeNull();
    // Past the interval the repeat press steps the stack.
    vi.setSystemTime(Date.now() + 600);
    pressAt(view, SHARED_POINT);
    expect(indicator(view)).toMatchObject({ index: "2", count: "2" });
  });
});

describe("the i / N indicator", () => {
  it("fades after its window", () => {
    const r = renderStack();
    pressAt(r.view, SHARED_POINT, { altKey: true });
    expect(indicator(r.view)).not.toBeNull();
    act(() => {
      vi.advanceTimersByTime(1_100);
    });
    expect(indicator(r.view)).toBeNull();
  });

  it("stands the accessible label over the position and the size", () => {
    const r = renderStack();
    pressAt(r.view, SHARED_POINT, { altKey: true });
    const chip = r.view.querySelector<HTMLElement>("[data-slot='docblocks/canvas-cycle-indicator']")!;
    expect(chip.getAttribute("role")).toBe("status");
    expect(chip.getAttribute("aria-label")).toBe("1 of 2");
    expect(chip.textContent).toBe("1 / 2");
  });
});
