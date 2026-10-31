// @vitest-environment jsdom
// The image figure (the image subtype): the width / the align / the
// selection (the canvas token's outline + the corner ports) / the port
// resize session (the in-flight preview is view state, one updateBlock on
// the release) / the hover menu (the download, the caption, the align
// controls).
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { act } from "react";

import { createDoc } from "docblocks-core";

import { Editor } from "../src/Editor";
import type { BlobStore } from "../src/blob-store";
import { EditorProvider, useEditorContext } from "../src/editor-provider";

const CREATED_AT = "2026-10-10T00:00:00.000Z";

const IMAGE_STORE: BlobStore = {
  resolve: async () => ({ url: "https://cdn.test/pic.png", meta: { subtype: "image", name: "pic.png" } }),
  upload: async () => "up-1",
};

/** Seed the image (optionally with the view attrs), render, return the ids. */
function renderImageDoc(prepare?: (attrs: Record<string, unknown>) => void) {
  const doc = createDoc({ id: "doc-img", createdAt: CREATED_AT });
  const attrs: Record<string, unknown> = {};
  prepare?.(attrs);
  const imageId = doc.insertBlock("image", { src: "key-1", ...attrs });
  render(
    <EditorProvider doc={doc} blobStore={IMAGE_STORE}>
      <Editor />
    </EditorProvider>
  );
  return { doc, imageId };
}

/** Flush the async blob resolve. */
async function flushResolve(): Promise<void> {
  await act(async () => {});
}

/** The figure wrapper. */
function figureOf(): HTMLElement {
  const figure = document.querySelector<HTMLElement>('[data-slot="docblocks/image-figure"]');
  expect(figure, "the figure should render").not.toBeNull();
  return figure!;
}

/** The image block's attrs (the typed reader over the block union). */
function imageAttrs(doc: ReturnType<typeof createDoc>, id: string): Record<string, unknown> | null {
  const block = doc.getBlock(id);
  return block !== null && block.type === "image" ? (block.attrs as unknown as Record<string, unknown>) : null;
}

/** The img element. */
function imgOf(): HTMLImageElement {
  const img = document.querySelector<HTMLImageElement>("img[data-slot='docblocks/image']");
  expect(img, "the img should render").not.toBeNull();
  return img!;
}

/** Stand the figure's and the editor root's rects (jsdom measures nothing). */
function standRects(figure: HTMLElement, width: number, editorWidth: number): void {
  const left = 10;
  const rect = (l: number, w: number) =>
    ({ left: l, right: l + w, top: 0, bottom: 400, width: w, height: 400, x: l, y: 0, toJSON: () => ({}) }) as DOMRect;
  figure.getBoundingClientRect = () => rect(left, width);
  const editor = document.querySelector<HTMLElement>('[data-slot="docblocks/editor"]');
  expect(editor, "the editor root should render").not.toBeNull();
  editor!.getBoundingClientRect = () => rect(0, editorWidth);
}

afterEach(() => {
  cleanup();
});

describe("the image figure's width and the align", () => {
  it("stands the editor's full width by default (the absent width)", async () => {
    renderImageDoc();
    await flushResolve();
    const img = imgOf();
    expect(img.style.width).toBe("100%");
    expect(figureOf().getAttribute("data-align")).toBe("left");
    expect(figureOf().getAttribute("data-selected")).toBeNull();
    // The corner ports stand only while the figure is selected.
    expect(document.querySelectorAll('[data-slot="docblocks/image-port"]').length).toBe(0);
  });

  it("stands the width attr's px and the align's placement", async () => {
    renderImageDoc((attrs) => {
      attrs.width = 240;
      attrs.align = "center";
    });
    await flushResolve();
    expect(imgOf().style.width).toBe("240px");
    const figure = figureOf();
    expect(figure.getAttribute("data-align")).toBe("center");
    expect(figure.className).toContain("mx-auto");
  });

  it("stands the right / left placement for the right / left aligns", async () => {
    renderImageDoc((attrs) => {
      attrs.width = 240;
      attrs.align = "right";
    });
    await flushResolve();
    expect(figureOf().className).toContain("ml-auto");
  });
});

describe("the click's blocks selection (the canvas token's ring + the ports)", () => {
  it("a click selects the figure (the ring stands, the four ports stand)", async () => {
    renderImageDoc();
    await flushResolve();
    const figure = figureOf();
    fireEvent.click(figure);
    expect(figure.getAttribute("data-selected")).toBe("true");
    const ports = document.querySelectorAll('[data-slot="docblocks/image-port"]');
    expect(ports.length).toBe(4);
    expect([...ports].map((port) => port.getAttribute("data-corner"))).toEqual(["nw", "ne", "sw", "se"]);
    // The port is centered on the corner (the left / top stands the port's
    // left edge at the corner; the -50% translate centers it there).
    const ne = document.querySelector<HTMLElement>('[data-slot="docblocks/image-port"][data-corner="ne"]');
    expect(ne!.getAttribute("style")).toContain("left: 100%");
    expect(ne!.getAttribute("style")).toContain("top: 0px");
    expect(ne!.getAttribute("style")).toContain("translate(-50%, -50%)");
  });

  it("the Delete key over the single selected image converts it to an empty paragraph (the caret seats there)", async () => {
    const { doc, imageId } = renderImageDoc();
    await flushResolve();
    const figure = figureOf();
    fireEvent.click(figure);
    fireEvent.keyDown(figure, { key: "Delete" });
    // The block survives as a plain paragraph (the image's attrs drop),
    // not removed.
    expect(doc.getBlock(imageId)?.type).toBe("paragraph");
    expect(document.querySelector('[data-slot="docblocks/image-figure"]')).toBeNull();
    // The caret seats in the survivor's inner on the next frame.
    const inner = document.querySelector<HTMLElement>(
      `[data-block-id="${imageId}"][data-slot="docblocks/block-content"]`
    )!;
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(document.activeElement).toBe(inner);
  });

  it("Backspace stands the same conversion", async () => {
    const { doc, imageId } = renderImageDoc();
    await flushResolve();
    const figure = figureOf();
    fireEvent.click(figure);
    fireEvent.keyDown(figure, { key: "Backspace" });
    expect(doc.getBlock(imageId)?.type).toBe("paragraph");
  });

  it("a multi-selection that includes the image still deletes (the removal path stands)", async () => {
    const doc = createDoc({ id: "doc-img", createdAt: CREATED_AT });
    const imageId = doc.insertBlock("image", { src: "key-1" });
    const dividerId = doc.insertBlock("divider", undefined, { parent: doc.meta.id });
    // Seed the blocks selection (both ids) through the provider context.
    const seed = { current: null as null | ((ids: string[]) => void) };
    function SeedSelection() {
      const { selection } = useEditorContext();
      seed.current = (ids: string[]) => selection.view?.set({ kind: "blocks", ids, anchorId: ids[0]! });
      return null;
    }
    render(
      <EditorProvider doc={doc} blobStore={IMAGE_STORE}>
        <Editor />
        <SeedSelection />
      </EditorProvider>
    );
    await flushResolve();
    act(() => {
      seed.current!([imageId, dividerId]);
    });
    await act(async () => {});
    fireEvent.keyDown(document.querySelector('[data-slot="docblocks/editor"]')!, { key: "Delete" });
    expect(doc.getBlock(imageId)).toBeNull();
    expect(doc.getBlock(dividerId)).toBeNull();
  });
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

describe("the hover menu (the download, the caption, the align)", () => {
  it("stands the download anchor (the resolved url, the download attribute)", async () => {
    renderImageDoc();
    await flushResolve();
    const link = document.querySelector<HTMLAnchorElement>('[data-slot="docblocks/image-download"]');
    expect(link).not.toBeNull();
    expect(link!.getAttribute("href")).toBe("https://cdn.test/pic.png");
    expect(link!.getAttribute("download")).toBe("pic.png");
  });

  it("the caption button stands the caption line (the code caption's idiom; the commit is one updateBlock)", async () => {
    const { doc, imageId } = renderImageDoc();
    await flushResolve();
    expect(document.querySelector('[data-slot="docblocks/image-caption"]')).toBeNull();

    fireEvent.click(screen.getByLabelText("Add a caption"));

    const line = document.querySelector<HTMLInputElement>('[data-slot="docblocks/image-caption"]');
    expect(line).not.toBeNull();
    fireEvent.change(line!, { target: { value: "fig 1" } });
    expect(imageAttrs(doc, imageId)).toEqual({ src: "key-1", caption: "fig 1" });
    expect(line!.value).toBe("fig 1");
  });

  it("the align buttons are one updateBlock each (a no-op pick issues nothing)", async () => {
    const { doc, imageId } = renderImageDoc();
    await flushResolve();

    const center = document.querySelector<HTMLElement>('[data-slot="docblocks/image-align"][data-align="center"]');
    expect(center).not.toBeNull();
    fireEvent.click(center!);
    expect(imageAttrs(doc, imageId)).toEqual({ src: "key-1", align: "center" });
    expect(figureOf().getAttribute("data-align")).toBe("center");
    expect(center!.getAttribute("data-active")).toBe("true");

    // The already-active pick is a no-op (the attrs stand as they are).
    fireEvent.click(center!);
    expect(imageAttrs(doc, imageId)).toEqual({ src: "key-1", align: "center" });
  });
});
