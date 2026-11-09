// @vitest-environment jsdom
// The page-frame block (the window reference in the page): the window's
// render over the referenced frame's surface (the offset's stand, the
// world parity of the inert copy), the box's width's clip (the narrow row
// clips the wide window center-wise, the wide row stands the frame's
// width), the dangling's stands (the gone frame, the missing frameId, the
// surface-less frame — the lenient placeholder, no throw), the live's
// stand (a surface child's geometry change re-stands the window's copy),
// the aria-label's stand, the Backspace-merge's guard (no merge into the
// frame — the frame's slot stands, no write), and the Delete's stand (the
// reference's removal; the canvas frame survives).
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { createDoc } from "docblocks-core";
import type { BlockId } from "docblocks-core";

import { Editor } from "../src/Editor";
import { EditorProvider, useEditorContext } from "../src/editor-provider";

const CREATED_AT = "2026-11-06T00:00:00.000Z";

type TestDoc = ReturnType<typeof createDoc>;

// The row's width's mock stand: the observer's callback fires with the
// row's content width (the house's measurement stand, driven by the test).
type ROCallback = (entries: { contentRect: { width: number } }[]) => void;
const roInstances: { callback: ROCallback }[] = [];
class MockResizeObserver {
  callback: ROCallback;
  constructor(callback: ROCallback) {
    this.callback = callback;
    roInstances.push(this);
  }
  observe(): void {}
  disconnect(): void {}
}

beforeAll(() => {
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver = MockResizeObserver;
});

/** Fire the latest window's row observer with `width` (the row's remeasure). */
function standRowWidth(width: number): void {
  const instance = roInstances[roInstances.length - 1];
  expect(instance, "the window should observe its row's width").toBeDefined();
  act(() => {
    instance!.callback([{ contentRect: { width } }]);
  });
}

interface Scene {
  doc: TestDoc;
  surface: string;
  a: string;
  b: string;
  frame: string;
  pageFrame: string;
}

/** The page-frame's scene: the surface + two shapes (one in the window's
 *  region, one far outside) + the canvas frame (the page-frame's target). */
function seedScene(doc: TestDoc): Omit<Scene, "doc"> {
  const surface = doc.insertBlock("surface");
  const a = doc.insertBlock("shape", { variant: "rect" }, { parent: surface });
  doc.setGeometry(a, { x: 10, y: 20, w: 50, h: 50 });
  const b = doc.insertBlock("shape", { variant: "rect" }, { parent: surface });
  doc.setGeometry(b, { x: 1000, y: 1000, w: 50, h: 50 });
  const frame = doc.insertBlock("frame", { title: "The frame" }, { parent: surface });
  doc.setGeometry(frame, { x: 100, y: 50, w: 300, h: 200 });
  const pageFrame = doc.insertBlock("frame", { frameId: frame });
  return { surface, a, b, frame, pageFrame };
}

/** Render the doc's page view; the scene's ids stand the queries. */
function renderScene(): Scene {
  const doc = createDoc({ id: "frame-page-doc", createdAt: CREATED_AT });
  const ids = seedScene(doc);
  render(
    <EditorProvider doc={doc}>
      <Editor />
    </EditorProvider>
  );
  return { doc, ...ids };
}

/** The page-frame's window's box (the query's helper — the missing's error). */
function windowOf(pageFrame: string): HTMLElement {
  const row = document.querySelector<HTMLElement>(`[data-slot="docblocks/frame-page"][data-block-id="${pageFrame}"]`);
  expect(row, "the page-frame's row should stand").not.toBeNull();
  const box = row!.querySelector<HTMLElement>('[data-slot="docblocks/frame-page-window"]');
  expect(box, "the window's box should stand").not.toBeNull();
  return box!;
}

afterEach(() => {
  cleanup();
  window.getSelection()?.removeAllRanges();
  roInstances.length = 0;
});

describe("the window's render (the offset's stand + the world's parity)", () => {
  it("stands the content over the window's offset (the shape's world parity)", () => {
    const { a, pageFrame } = renderScene();
    const box = windowOf(pageFrame);
    // The frame at (100, 50) 300x200, the row unmeasured (jsdom's 0): the
    // box stands the frame's 1:1 span — the offset stands the world's
    // origin at the box-local (150 - 100, 100 - 50) = (50, 50).
    expect(box.style.width).toBe("300px");
    expect(box.style.height).toBe("200px");
    const content = box.querySelector<HTMLElement>("[data-slot='docblocks/frame-window-content']")!;
    const anchor = content.firstElementChild as HTMLElement | null;
    expect(anchor?.style.left).toBe("50px");
    expect(anchor?.style.top).toBe("50px");
    // The shape's copy stands over its world coordinates (the center
    // anchor's stand — the world's origin parity over the anchor).
    const copyA = content.querySelector<HTMLElement>(`[data-slot='docblocks/canvas-item'][data-block-id="${a}"]`)!;
    expect(copyA.style.left).toBe("calc(50% + 10px)");
    expect(copyA.style.top).toBe("calc(50% + 20px)");
    // The box's chrome: the canvas's own background + the dot grid's phase
    // over the box's world top-left (-50, -50) + the container's border.
    expect(box.style.backgroundColor).toBe("var(--docblocks-canvas-background)");
    expect(box.style.backgroundPosition).toBe("14px 14px");
    expect(box.style.boxShadow).toBe("inset 0 0 0 1px var(--docblocks-canvas-group-border-color)");
    expect(box.className).toContain("overflow-hidden");
  });

  it("stands the shape outside the window's region at its world's point (the overflow's clip's stand)", () => {
    const { b, pageFrame } = renderScene();
    const box = windowOf(pageFrame);
    const content = box.querySelector<HTMLElement>("[data-slot='docblocks/frame-window-content']")!;
    // The far shape's copy stands over its world coordinates (outside the
    // box's region — the box's overflow hidden clips it; the copy stands
    // at the world's parity, the clip is the visual's stand).
    const copyB = content.querySelector<HTMLElement>(`[data-slot='docblocks/canvas-item'][data-block-id="${b}"]`)!;
    expect(copyB.style.left).toBe("calc(50% + 1000px)");
    expect(copyB.style.top).toBe("calc(50% + 1000px)");
    expect(box.className).toContain("overflow-hidden");
  });

  it("does not stand the referenced frame's box inside its own window (the self's exclusion)", () => {
    const { frame, pageFrame } = renderScene();
    const box = windowOf(pageFrame);
    // The frame-chain's stand ({frameId}): the referenced frame does not
    // render its own box inside its own page window.
    expect(box.querySelector(`[data-slot='docblocks/frame'][data-block-id="${frame}"]`)).toBeNull();
  });
});

describe("the box's width's stand (the row's clip over the frame's center)", () => {
  it("clips the wide window center-wise over the narrow row (the offset re-stands)", () => {
    const { pageFrame } = renderScene();
    const box = windowOf(pageFrame);
    // The narrow row (200 over the 300's frame): the box clips to the
    // row's width, the center stays at the frame's center (x = 100) — the
    // offset re-stands (100 - 100, 100 - 50) = (0, 50).
    standRowWidth(200);
    expect(box.style.width).toBe("200px");
    expect(box.style.height).toBe("200px");
    const content = box.querySelector<HTMLElement>("[data-slot='docblocks/frame-window-content']")!;
    const anchor = content.firstElementChild as HTMLElement | null;
    expect(anchor?.style.left).toBe("0px");
    expect(anchor?.style.top).toBe("50px");
    // The dot grid's phase re-stands over the clipped top-left (0, -50):
    // the origin's phase 0 → the dot's half-step 12; -50's phase 22 →
    // 12 - 22 + 24 = 14.
    expect(box.style.backgroundPosition).toBe("12px 14px");
  });

  it("stands the frame's width over the wide row (no clip)", () => {
    const { pageFrame } = renderScene();
    const box = windowOf(pageFrame);
    standRowWidth(800);
    expect(box.style.width).toBe("300px");
  });
});

describe("the live's stand (the canvas's changes re-stand the window)", () => {
  it("re-stands the copy over a surface child's geometry change", () => {
    const { a, doc, pageFrame } = renderScene();
    const box = windowOf(pageFrame);
    const content = box.querySelector<HTMLElement>("[data-slot='docblocks/frame-window-content']")!;
    const copyA = content.querySelector<HTMLElement>(`[data-slot='docblocks/canvas-item'][data-block-id="${a}"]`)!;
    expect(copyA.style.left).toBe("calc(50% + 10px)");
    act(() => {
      doc.setGeometry(a, { x: 25, y: 20, w: 50, h: 50 });
    });
    // The content's item reads its own snapshot: the copy re-stands over
    // the new world coordinates without the block's own re-render.
    expect(copyA.style.left).toBe("calc(50% + 25px)");
  });
});

describe("the aria-label's stand", () => {
  it("stands the referenced frame's title", () => {
    renderScene();
    const windowEl = document.querySelector<HTMLElement>('[data-slot="docblocks/frame-page-window"]');
    expect(windowEl?.getAttribute("aria-label")).toBe("Frame: The frame");
  });

  it("stands the default over the absent title", () => {
    const doc = createDoc({ id: "frame-page-aria-default-doc", createdAt: CREATED_AT });
    const surface = doc.insertBlock("surface");
    const frame = doc.insertBlock("frame", undefined, { parent: surface });
    doc.setGeometry(frame, { x: 0, y: 0, w: 300, h: 200 });
    doc.insertBlock("frame", { frameId: frame });
    render(
      <EditorProvider doc={doc}>
        <Editor />
      </EditorProvider>
    );
    const windowEl = document.querySelector<HTMLElement>('[data-slot="docblocks/frame-page-window"]');
    expect(windowEl?.getAttribute("aria-label")).toBe("Frame");
  });
});

describe("the dangling's stands (the lenient placeholder — no throw)", () => {
  it("stands the placeholder over the gone frame's id", () => {
    const doc = createDoc({ id: "frame-page-gone-doc", createdAt: CREATED_AT });
    doc.insertBlock("frame", { frameId: "gone-frame" });
    render(
      <EditorProvider doc={doc}>
        <Editor />
      </EditorProvider>
    );
    const placeholder = document.querySelector<HTMLElement>('[data-slot="docblocks/frame-page-missing"]');
    expect(placeholder).not.toBeNull();
    expect(placeholder!.textContent).toContain("Frame not found");
    expect(document.querySelector('[data-slot="docblocks/frame-page-window"]')).toBeNull();
  });

  it("stands the placeholder over the missing frameId (a canvas frame at the root)", () => {
    const doc = createDoc({ id: "frame-page-missing-doc", createdAt: CREATED_AT });
    doc.insertBlock("frame", undefined);
    render(
      <EditorProvider doc={doc}>
        <Editor />
      </EditorProvider>
    );
    const placeholder = document.querySelector<HTMLElement>('[data-slot="docblocks/frame-page-missing"]');
    expect(placeholder).not.toBeNull();
    expect(placeholder!.textContent).toContain("Frame not found");
  });

  it("stands the placeholder over the surface-less frame (the invalid context's lenient posture)", () => {
    const doc = createDoc({ id: "frame-page-surfaless-doc", createdAt: CREATED_AT });
    // A frame at the root is not a canvas frame (the surface's child is
    // the canvas context) — no surface holds it, so the reference's
    // surface derivation stands nothing.
    const stray = doc.insertBlock("frame", { title: "Stray" });
    doc.insertBlock("frame", { frameId: stray });
    render(
      <EditorProvider doc={doc}>
        <Editor />
      </EditorProvider>
    );
    const placeholder = document.querySelector<HTMLElement>('[data-slot="docblocks/frame-page-missing"]');
    expect(placeholder).not.toBeNull();
    expect(placeholder!.textContent).toContain("Frame not found");
  });
});

describe("the Backspace-merge's guard (no merge into the frame)", () => {
  /** Place the DOM caret at `offset` of the block's inner and press Backspace on the wrapper. */
  function backspaceAt(blockId: BlockId, offset: number): void {
    const wrapper = document.querySelector<HTMLElement>(`[data-block-id="${blockId}"]`);
    expect(wrapper, "the block should stand").not.toBeNull();
    const inner = wrapper!.querySelector<HTMLElement>('[data-slot="docblocks/block-content"]');
    expect(inner, "the block should carry the inner editable").not.toBeNull();
    const textNode = Array.from(inner!.childNodes).find((node) => node.nodeType === Node.TEXT_NODE);
    const range = document.createRange();
    if (textNode !== undefined) range.setStart(textNode, offset);
    else range.setStart(inner!, 0);
    range.collapse(true);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    act(() => {
      wrapper!.dispatchEvent(new KeyboardEvent("keydown", { key: "Backspace", bubbles: true, cancelable: true }));
    });
  }

  it("a Backspace at the start of the block after a page-frame stands no merge (the frame's slot stands, no write)", () => {
    const doc = createDoc({ id: "frame-page-backspace-doc", createdAt: CREATED_AT });
    const surface = doc.insertBlock("surface");
    const frame = doc.insertBlock("frame", { title: "The frame" }, { parent: surface });
    doc.setGeometry(frame, { x: 0, y: 0, w: 300, h: 200 });
    const before = doc.insertBlock("paragraph");
    doc.insertText(before, 0, "before");
    const pageFrame = doc.insertBlock("frame", { frameId: frame }, { parent: doc.meta.id, after: before });
    const after = doc.insertBlock("paragraph", undefined, { parent: doc.meta.id, after: pageFrame });
    doc.insertText(after, 0, "after");
    render(
      <EditorProvider doc={doc}>
        <Editor />
      </EditorProvider>
    );

    backspaceAt(after, 0);

    // The guard's no-op: the frame stands (the childless window's
    // unconditional stand — the surface's unconditional's parity), nothing
    // is merged, nothing is written.
    const frameBlock = doc.getBlock(pageFrame);
    expect(frameBlock?.type).toBe("frame");
    expect(frameBlock?.type === "frame" && frameBlock.attrs?.frameId).toBe(frame);
    expect(doc.getText(before)).toBe("before");
    expect(doc.getText(after)).toBe("after");
    expect(Object.keys(doc.toJSON().blocks).length).toBe(6); // root + surface + frame + before + after + the page-frame
  });
});

describe("the Delete's stand (the reference's removal; the canvas frame's survival)", () => {
  /** Seed the blocks' selection (the frame's id) through the provider's context. */
  function SelectionProbe({ onReady }: { onReady: (set: (ids: BlockId[]) => void) => void }) {
    const { selection } = useEditorContext();
    onReady((ids) => {
      selection.view?.set({ kind: "blocks", ids, anchorId: ids[0]! });
    });
    return null;
  }

  it("the selected page-frame's Delete removes the reference (the canvas frame survives — no cascade)", () => {
    const doc = createDoc({ id: "frame-page-delete-doc", createdAt: CREATED_AT });
    const surface = doc.insertBlock("surface");
    const frame = doc.insertBlock("frame", { title: "The frame" }, { parent: surface });
    doc.setGeometry(frame, { x: 0, y: 0, w: 300, h: 200 });
    const pageFrame = doc.insertBlock("frame", { frameId: frame });
    const probe = { current: null as null | ((ids: BlockId[]) => void) };
    render(
      <EditorProvider doc={doc}>
        <Editor />
        <SelectionProbe onReady={(set) => (probe.current = set)} />
      </EditorProvider>
    );
    act(() => {
      probe.current!([pageFrame]);
    });
    const wrapper = document.querySelector<HTMLElement>(
      `[data-slot="docblocks/frame-page"][data-block-id="${pageFrame}"]`
    )!;
    fireEvent.keyDown(wrapper, { key: "Delete" });
    // The reference's removal (the standard page's selection-delete — the
    // removeBlock's no-cascade stand: the frame is childless, the canvas
    // frame + its surface's content stand untouched).
    expect(doc.getBlock(pageFrame)).toBeNull();
    expect(doc.getBlock(frame)?.type).toBe("frame");
    expect(doc.getBlock(surface)?.type).toBe("surface");
    expect(doc.getChildren(surface)).toContain(frame);
  });
});
