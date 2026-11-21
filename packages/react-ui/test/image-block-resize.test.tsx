// @vitest-environment jsdom
// The corner port's resize session (the in-flight preview is view state,
// one updateBlock on the release): the shrink's stands (the right / the
// left's corner, the editor's clamp, the width's floor, the sub-threshold's
// no-op) + the keyboard's step (the arrows over the corner's side, one
// updateBlock per press).
import { act, cleanup, fireEvent } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { figureOf, flushResolve, imageAttrs, imgOf, renderImageDoc, standRects } from "./image-block.helpers";

afterEach(() => {
  cleanup();
});

describe("the corner port's resize session", () => {
  /** Press the port, drag to `toX`, release — the session's full gesture (the figure is click-selected first: the ports stand only while selected). */
  async function dragPort(corner: string, fromX: number, toX: number): Promise<void> {
    await flushResolve();
    const figure = figureOf();
    standRects(figure, 400, 800);
    fireEvent.click(figure);
    const port = document.querySelector<HTMLElement>(`[data-slot="docblocks/image-port"][data-corner="${corner}"]`);
    expect(port, `the ${corner} port should stand (the figure is selected)`).not.toBeNull();
    fireEvent.pointerDown(port!, { clientX: fromX, clientY: 0, pointerId: 1 });
    fireEvent.pointerMove(port!, { clientX: toX, clientY: 0, pointerId: 1 });
    fireEvent.pointerUp(port!, { pointerId: 1 });
  }

  it("the right corner's drag shrinks the width and commits one updateBlock on the release", async () => {
    const { doc, imageId } = renderImageDoc();
    await dragPort("se", 410, 310);
    expect(imageAttrs(doc, imageId)).toEqual({ src: "key-1", width: 300 });
    expect(imgOf().style.width).toBe("300px");
    // One undo step: the undo drops the width (the absent attr stood before).
    act(() => {
      doc.undo();
    });
    expect(imageAttrs(doc, imageId)).toEqual({ src: "key-1" });
    expect(imgOf().style.width).toBe("100%");
  });

  it("the left corner's drag shrinks against the fixed right edge", async () => {
    const { doc, imageId } = renderImageDoc();
    // The nw corner: the pointer left of the start grows nothing — the left
    // edge's drag: the pointer to the RIGHT (toward the figure) shrinks.
    await dragPort("nw", 10, 110);
    expect(imageAttrs(doc, imageId)).toEqual({ src: "key-1", width: 300 });
  });

  it("the right corner's drag past the editor's width clamps at the editor (no stretch)", async () => {
    const { doc, imageId } = renderImageDoc();
    await dragPort("se", 410, 1210);
    // The editor's content width is 800 (the mocked root rect).
    expect(imageAttrs(doc, imageId)).toEqual({ src: "key-1", width: 800 });
  });

  it("the drag never goes below the width's floor", async () => {
    const { doc, imageId } = renderImageDoc();
    await dragPort("se", 410, -400);
    expect(imageAttrs(doc, imageId)).toEqual({ src: "key-1", width: 20 });
  });

  it("a sub-threshold drag issues no command (the doc stands as it is)", async () => {
    const { doc, imageId } = renderImageDoc();
    await dragPort("se", 410, 409);
    expect(imageAttrs(doc, imageId)).toEqual({ src: "key-1" });
    expect(imgOf().style.width).toBe("100%");
  });

  it("the keyboard resize stands the width by a step (the arrows over the corner's side), one updateBlock per press", async () => {
    const { doc, imageId } = renderImageDoc((attrs) => {
      attrs.width = 400;
    });
    await flushResolve();
    const figure = figureOf();
    standRects(figure, 400, 800);
    fireEvent.click(figure); // the selection's seats (the ports' stand)
    const ne = document.querySelector<HTMLElement>('[data-slot="docblocks/image-port"][data-corner="ne"]');
    expect(ne, "the ne's port's stands (the figure's selected)").not.toBeNull();
    // The ne's (the right's corner): the right's arrow's widens, the left's
    // shrinks (one `updateBlock` per press — the step's stands on the
    // committed's width).
    act(() => {
      fireEvent.keyDown(ne!, { key: "ArrowRight" });
    });
    expect(imageAttrs(doc, imageId)).toEqual({ src: "key-1", width: 410 });
    act(() => {
      fireEvent.keyDown(ne!, { key: "ArrowLeft" });
    });
    expect(imageAttrs(doc, imageId)).toEqual({ src: "key-1", width: 400 });
    // The non-arrow's key's stands the width (the no-op's — the Enter's
    // default's activate's issues nothing, the resize's is the arrows's).
    act(() => {
      fireEvent.keyDown(ne!, { key: "Enter" });
    });
    expect(imageAttrs(doc, imageId)).toEqual({ src: "key-1", width: 400 });
  });
});
