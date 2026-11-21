// @vitest-environment jsdom
// The image figure (the image subtype): the width / the align / the
// selection (the canvas token's outline + the corner ports) / the hover
// menu (the download, the caption, the align controls).
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { act } from "react";

import { createDoc } from "docblocks-core";

import { Editor } from "../src/Editor";
import { EditorProvider, useEditorContext } from "../src/editor-provider";
import {
  CREATED_AT,
  IMAGE_STORE,
  figureOf,
  flushResolve,
  imageAttrs,
  imgOf,
  renderImageDoc,
} from "./image-block.helpers";

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

describe("the hover menu (the download, the caption, the align)", () => {
  it("stands the download anchor (the resolved url, the download attribute)", async () => {
    renderImageDoc();
    await flushResolve();
    const link = document.querySelector<HTMLAnchorElement>('[data-slot="docblocks/image-download"]');
    expect(link).not.toBeNull();
    expect(link!.getAttribute("href")).toMatch(/^blob:/);
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
