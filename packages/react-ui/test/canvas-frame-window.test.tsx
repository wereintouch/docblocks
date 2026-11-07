// @vitest-environment jsdom
// The canvas frame's viewport window (the reworked frame): the window's
// offset math (the world's origin over the box's local point), the dot
// grid's phase alignment (the world grid over the box's top-left), the
// frame chain's cycle guard (a frame inside another frame's window; a
// frame does not render itself), the inert surface layer (the copies'
// pointer-transparent stand), and the frame's move preview (the window's
// pan over the still content).
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { createDoc } from "docblocks-core";

import { Editor } from "../src/Editor";
import { DOT_GRID_STEP_PX, frameDotBackground, frameWindowOffset } from "../src/canvas/geometry";
import { EditorProvider } from "../src/editor-provider";

const CREATED_AT = "2026-11-06T00:00:00.000Z";

type TestDoc = ReturnType<typeof createDoc>;

/** Deterministic canvas ids: the surface first, then the elements in z-order. */
function canvasIdGenerator(): () => string {
  let next = 0;
  return () => {
    next += 1;
    return `f${String(next).padStart(4, "0")}`;
  };
}

interface Rendered {
  doc: TestDoc;
  view: HTMLElement;
  surface: string;
  a: string;
  frame1: string;
  frame2: string;
}

/** The window's scene: the surface + a shape + a labeled connector + the
 * two frames (the second's inside the first's window — the chain's stand). */
function seedScene(doc: TestDoc): { surface: string; a: string; frame1: string; frame2: string } {
  const surface = doc.insertBlock("surface");
  const a = doc.insertBlock("shape", { variant: "rect" }, { parent: surface });
  doc.setGeometry(a, { x: 10, y: 20, w: 50, h: 50 });
  const frame1 = doc.insertBlock("frame", { title: "First" }, { parent: surface });
  doc.setGeometry(frame1, { x: 100, y: 50, w: 300, h: 200 });
  const frame2 = doc.insertBlock("frame", undefined, { parent: surface });
  doc.setGeometry(frame2, { x: 400, y: 50, w: 200, h: 150 });
  doc.insertBlock(
    "connector",
    { start: { blockId: a }, end: { blockId: frame2 }, label: "bridge" },
    { parent: surface }
  );
  return { surface, a, frame1, frame2 };
}

function renderScene(): Rendered {
  const doc = createDoc({ id: "frame-window-doc", createdAt: CREATED_AT, generateId: canvasIdGenerator() });
  const { surface, a, frame1, frame2 } = seedScene(doc);
  const { container } = render(
    <EditorProvider doc={doc}>
      <Editor view="canvas" />
    </EditorProvider>
  );
  const view = container.querySelector<HTMLElement>('[data-slot="docblocks/canvas-view"]');
  if (view === null) throw new Error("the canvas view is missing");
  return { doc, view, surface, a, frame1, frame2 };
}

/** The frame's window's content (the query's helper — the missing's error). */
function windowContent(view: HTMLElement, frameId: string): HTMLElement {
  const frame = view.querySelector<HTMLElement>(`[data-slot="docblocks/frame"][data-block-id="${frameId}"]`);
  if (frame === null) throw new Error("the frame is missing");
  const content = frame.querySelector<HTMLElement>("[data-slot='docblocks/frame-window-content']");
  if (content === null) throw new Error("the window's content is missing");
  return content;
}

afterEach(cleanup);

describe("frameWindowOffset (the window's content's offset)", () => {
  it("stands the box's top-left corner shifted to the world's origin", () => {
    // The box at (100, 50) 300x200: the top-left world corner at (100 - 150,
    // 50 - 100) = (-50, -50) — the origin (0,0) stands at (50, 50) inside
    // the box.
    expect(frameWindowOffset({ x: 100, y: 50, w: 300, h: 200 })).toEqual({ left: 50, top: 50 });
  });

  it("stands the negative and the origin's stands", () => {
    // The box at (-300, 200) 200x100: the top-left at (-400, 150) — the
    // origin stands at (400, -150).
    expect(frameWindowOffset({ x: -300, y: 200, w: 200, h: 100 })).toEqual({ left: 400, top: -150 });
    // The box over the origin (the 0,0 center): the origin stands at the
    // center.
    expect(frameWindowOffset({ x: 0, y: 0, w: 320, h: 240 })).toEqual({ left: 160, top: 120 });
  });
});

describe("frameDotBackground (the dot grid's phase over the world's grid)", () => {
  it("stands the grid's dot / the step / the world grid's phase (the dot over the grid line)", () => {
    // The dot stands at the tile's center over the world's grid line:
    // the box's top-left at (10, 10) stands the dot at the box-local
    // (2, 2) — the grid line's (24, 24) over the origin's half-step.
    expect(frameDotBackground(10, 10)).toEqual({
      backgroundImage: "radial-gradient(circle, var(--docblocks-canvas-view-dot) 1px, transparent 1px)",
      backgroundSize: "24px 24px",
      backgroundPosition: "2px 2px",
    });
  });

  it("stands the grid line over the box's edge (the phase's stand)", () => {
    // The top-left on a grid line: the dot's half-step's phase (the
    // tile's center stand — the canvas view's percentage position's
    // parity).
    expect(frameDotBackground(0, 0).backgroundPosition).toBe("12px 12px");
    expect(frameDotBackground(24, -48).backgroundPosition).toBe("12px 12px");
  });

  it("stands the negative's coordinates (the positive mod's stand)", () => {
    // The top-left at (-10, -10): the world grid's lines stand at the
    // box-local (-2, -2) + 24k — the position's 22 (the double positive
    // mod's stand).
    expect(frameDotBackground(-10, -10).backgroundPosition).toBe("22px 22px");
  });

  it("shares the canvas view's grid step", () => {
    expect(DOT_GRID_STEP_PX).toBe(24);
  });
});

describe("the window's render (the offset / the content's parity)", () => {
  it("stands the content over the window's offset (the shape's world parity)", () => {
    const { view, frame1, a } = renderScene();
    const frame = view.querySelector<HTMLElement>(`[data-slot="docblocks/frame"][data-block-id="${frame1}"]`)!;
    // The window's content's anchor (the world's origin's box-local point):
    // the frame at (100, 50) 300x200 stands the offset (150 - 100, 100 -
    // 50) = (50, 50).
    const content = frame.querySelector<HTMLElement>("[data-slot='docblocks/frame-window-content']")!;
    expect(content).not.toBeNull();
    const anchor = content.firstElementChild as HTMLElement | null;
    expect(anchor?.style.left).toBe("50px");
    expect(anchor?.style.top).toBe("50px");
    // The shape's copy stands over its world coordinates (the center
    // anchor's stand — the world's origin parity over the anchor): the
    // shape at (10, 20) stands at calc(50% + 10) / calc(50% + 20) over the
    // zero-size anchor (the 50%'s stand over the zero's box).
    const copy = content.querySelector<HTMLElement>(`[data-slot='docblocks/canvas-item'][data-block-id="${a}"]`)!;
    expect(copy.style.left).toBe("calc(50% + 10px)");
    expect(copy.style.top).toBe("calc(50% + 20px)");
  });

  it("stands the move's preview (the window's pan over the still content)", () => {
    const { view, frame1 } = renderScene();
    const wrapper = view.querySelector<HTMLElement>(`[data-slot="docblocks/canvas-item"][data-block-id="${frame1}"]`)!;
    const content = wrapper.querySelector<HTMLElement>("[data-slot='docblocks/frame-window-content']")!;
    const anchor = content.firstElementChild as HTMLElement | null;
    expect(anchor?.style.left).toBe("50px");
    // The press + the drag (the move session — the 3px threshold crossed,
    // the zoom's 1x scale): the wrapper stands the +30 offset, the
    // content's offset re-stands (the window's pan — the content stands
    // over its world's coordinates).
    fireEvent.pointerDown(wrapper, { clientX: 10, clientY: 10, buttons: 1, pointerId: 1 });
    fireEvent.pointerMove(view, { clientX: 40, clientY: 10, buttons: 1, pointerId: 1 });
    expect(wrapper.style.transform).toBe("translate(-50%, -50%) translate(30px, 0px)");
    expect(anchor?.style.left).toBe("20px"); // 50 - 30: the origin re-stands
    expect(anchor?.style.top).toBe("50px"); // no vertical's delta
    // The release's commit (the one setGeometry over the effective's
    // stand).
    fireEvent.pointerUp(view, { pointerId: 1 });
    const geometry = view.querySelector<HTMLElement>(
      `[data-slot="docblocks/canvas-item"][data-block-id="${frame1}"]`
    )!.style;
    expect(geometry.left).toBe("calc(50% + 130px)");
    expect(geometry.top).toBe("calc(50% + 50px)");
  });
});

describe("the frame chain's cycle guard", () => {
  it("stands the frame inside another frame's window (the chain's growth)", () => {
    const { view, frame1, frame2, a } = renderScene();
    // Frame1's window: the surface's children minus frame1 (the frame2's
    // copy stands — its chain stands {frame1}).
    const window1 = windowContent(view, frame1);
    expect(window1.querySelector(`[data-slot='docblocks/canvas-item'][data-block-id="${frame2}"]`)).not.toBeNull();
    expect(window1.querySelector(`[data-slot='docblocks/canvas-item'][data-block-id="${a}"]`)).not.toBeNull();
    // The frame1 does not stand inside its own window (the self's
    // exclusion).
    expect(window1.querySelector(`[data-slot='docblocks/canvas-item'][data-block-id="${frame1}"]`)).toBeNull();
  });

  it("stands the nested copy's exclusion (the chain's frames + the self)", () => {
    const { view, frame1, frame2, a } = renderScene();
    // The frame2's copy inside the frame1's window: the chain {frame1} +
    // the self — the content stands the surface's children minus
    // {frame1, frame2}: the shape + the connector stand, the frames do
    // not (the recursion's stand — the chain's strict growth).
    const window1 = windowContent(view, frame1);
    const nestedFrame2 = window1.querySelector<HTMLElement>(
      `[data-slot="docblocks/canvas-item"][data-block-id="${frame2}"]`
    )!;
    const nestedWindow = nestedFrame2.querySelector<HTMLElement>("[data-slot='docblocks/frame-window-content']")!;
    expect(nestedWindow.querySelector(`[data-slot='docblocks/canvas-item'][data-block-id="${a}"]`)).not.toBeNull();
    expect(nestedWindow.querySelector(`[data-slot='docblocks/canvas-item'][data-block-id="${frame1}"]`)).toBeNull();
    expect(nestedWindow.querySelector(`[data-slot='docblocks/canvas-item'][data-block-id="${frame2}"]`)).toBeNull();
  });

  it("stands the labeled connector's chip over the window's content", () => {
    const { view, frame1 } = renderScene();
    const window1 = windowContent(view, frame1);
    // The connector's label's chip stands over the window's content (the
    // world's parity — the chip stands over the line's midpoint).
    expect(window1.querySelector("[data-connector-label]")).not.toBeNull();
    expect(window1.querySelector("[data-connector-label]")!.textContent).toBe("bridge");
  });
});

describe("the inert's surface layer (the copies' stand)", () => {
  it("stands the content's pointer-transparent and the ports' dots' stand off", () => {
    const { view, frame1 } = renderScene();
    const content = windowContent(view, frame1);
    // The inert's stand: the whole layer's pointer-transparent (the
    // copies' stand is the render only).
    expect(content.className).toContain("pointer-events-none");
    // The ports' dots stand off (the tool's chrome is not the copy's
    // stand).
    expect(content.querySelector("[data-slot='docblocks/canvas-port-dots']")).toBeNull();
    // The window's content stands the committed's geometry only (the
    // session's props' null stand — the previews do not reach the copy).
    const copy = content.querySelector<HTMLElement>("[data-slot='docblocks/canvas-item']")!;
    expect(copy.hasAttribute("data-connector-pending")).toBe(false);
  });
});

describe("the shared title chip (the group's parity + the frame's slots)", () => {
  it("stands the group's chip over the group's slots (the extraction's parity)", () => {
    const doc = createDoc({ id: "title-chip-doc", createdAt: CREATED_AT, generateId: canvasIdGenerator() });
    const surface = doc.insertBlock("surface");
    const group = doc.insertBlock("group", { members: [], title: "The group" }, { parent: surface });
    doc.setGeometry(group, { x: 0, y: 0, w: 200, h: 150 });
    const { container } = render(
      <EditorProvider doc={doc}>
        <Editor view="canvas" />
      </EditorProvider>
    );
    const view = container.querySelector<HTMLElement>('[data-slot="docblocks/canvas-view"]')!;
    const groupItem = view.querySelector<HTMLElement>(`[data-slot="docblocks/canvas-item"][data-block-id="${group}"]`)!;
    // The group's chip stands the group's slots (the extraction keeps the
    // slots' stand — the container's parity).
    const chip = groupItem.querySelector<HTMLElement>("[data-slot='docblocks/group-title']");
    expect(chip).not.toBeNull();
    expect(chip!.textContent).toBe("The group");
    // The group's border's press stand (the extraction keeps the border's
    // slots' stand — the press's target).
    expect(groupItem.querySelector("[data-slot='docblocks/group-border']")).not.toBeNull();
  });

  it("stands the frame's chip over the frame's slots (the aria's stand)", () => {
    const doc = createDoc({ id: "title-chip-frame-doc", createdAt: CREATED_AT, generateId: canvasIdGenerator() });
    const surface = doc.insertBlock("surface");
    const frame = doc.insertBlock("frame", { title: "The frame" }, { parent: surface });
    doc.setGeometry(frame, { x: 0, y: 0, w: 300, h: 200 });
    const { container } = render(
      <EditorProvider doc={doc}>
        <Editor view="canvas" />
      </EditorProvider>
    );
    const view = container.querySelector<HTMLElement>('[data-slot="docblocks/canvas-view"]')!;
    const frameItem = view.querySelector<HTMLElement>(`[data-slot="docblocks/canvas-item"][data-block-id="${frame}"]`)!;
    const chip = frameItem.querySelector<HTMLElement>("[data-slot='docblocks/frame-title']");
    expect(chip).not.toBeNull();
    expect(chip!.textContent).toBe("The frame");
    // The chip's double-click opens the edit (the aria's "Frame title"
    // stand).
    fireEvent.dblClick(chip!);
    const edit = frameItem.querySelector<HTMLElement>("[data-slot='docblocks/frame-title-edit']");
    expect(edit).not.toBeNull();
    expect(edit!.getAttribute("aria-label")).toBe("Frame title");
    // The commit (the blur's one updateBlock).
    (edit! as HTMLInputElement).value = "Renamed";
    fireEvent.blur(edit!);
    const block = doc.getBlock(frame);
    expect(block?.type === "frame" && block.attrs?.title).toBe("Renamed");
  });

  it("stands the frame's set-title menu (the selected's title-less stand)", () => {
    const doc = createDoc({ id: "title-chip-menu-doc", createdAt: CREATED_AT, generateId: canvasIdGenerator() });
    const surface = doc.insertBlock("surface");
    const frame = doc.insertBlock("frame", undefined, { parent: surface });
    doc.setGeometry(frame, { x: 0, y: 0, w: 300, h: 200 });
    const { container } = render(
      <EditorProvider doc={doc}>
        <Editor view="canvas" />
      </EditorProvider>
    );
    const view = container.querySelector<HTMLElement>('[data-slot="docblocks/canvas-view"]')!;
    const wrapper = view.querySelector<HTMLElement>(`[data-slot="docblocks/canvas-item"][data-block-id="${frame}"]`)!;
    // The selection (the title-less's stand): the menu's trigger stands.
    fireEvent.pointerDown(wrapper, { clientX: 5, clientY: 5, pointerId: 1 });
    fireEvent.pointerUp(wrapper, { pointerId: 1 });
    const menu = wrapper.querySelector<HTMLElement>("[data-slot='docblocks/frame-title-menu']");
    expect(menu).not.toBeNull();
    // The commit (the Enter's one updateBlock — the chip's stand).
    fireEvent.click(menu!);
    const input = wrapper.querySelector<HTMLElement>("[data-slot='docblocks/frame-title-menu-input']")!;
    fireEvent.change(input, { target: { value: "Menu stand" } });
    fireEvent.keyDown(input, { key: "Enter" });
    const block = doc.getBlock(frame);
    expect(block?.type === "frame" && block.attrs?.title).toBe("Menu stand");
    expect(wrapper.querySelector("[data-slot='docblocks/frame-title']")!.textContent).toBe("Menu stand");
  });
});
