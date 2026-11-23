// @vitest-environment jsdom
// The page-frame's block (the window's reference in the page): the
// window's render (the offset's stand, the world's parity of the inert
// copy, the self's exclusion), the box's width's clip (the narrow's
// row's center-wise's clip, the wide's row's frame's width), the live's
// stand (the geometry's change's re-stand), and the aria-label's stand.
import { act, render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { createDoc } from "docblocks-core";

import { Editor } from "../src/Editor";
import { EditorProvider } from "../src/editor-provider";
import { CREATED_AT, renderScene, standRowWidth, windowOf } from "./frame-page.helpers";

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
