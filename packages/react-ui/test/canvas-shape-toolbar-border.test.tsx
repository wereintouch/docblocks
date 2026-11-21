// @vitest-environment jsdom
// The shape's color toolbar's border's controls (the width's selector +
// the style's menu), the text color's reset (the cross over the swatches),
// and the concurrent deletion's guard (the peer's removal over the open
// toolbar).
import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { validateDoc } from "docblocks-core";

import { ShapeToolbar } from "../src/canvas";
import { EditorProvider } from "../src/editor-provider";
import { newDoc, renderCanvas, seededDoc, selectBlock } from "./canvas-shape-toolbar.helpers";
import type { TestDoc } from "./canvas-shape-toolbar.helpers";

describe("the border's controls (the width selector + the style menu)", () => {
  const selector = () => screen.queryByLabelText("Shape border width");

  it("stands the selector on the current width's dot (the absent stand is the default 2 px = the second dot)", () => {
    const { doc, shape } = seededDoc();
    const { view } = renderCanvas(doc);
    selectBlock(view, doc, shape);
    expect(selector()?.getAttribute("aria-valuenow")).toBe("1");

    act(() => {
      doc.updateBlock(shape, { strokeWidth: 4 });
    });
    expect(selector()?.getAttribute("aria-valuenow")).toBe("3");
  });

  it("applies the width's dots (one updateBlock per apply, one undo step)", () => {
    const { doc, shape } = seededDoc();
    const { view } = renderCanvas(doc);
    selectBlock(view, doc, shape);

    const slider = selector();
    if (slider === null) throw new Error("the selector is missing");
    // The jsdom's zero-rect stand is the clamped index — the keyboard
    // step is the deterministic move (the drag's snap is the e2e's
    // real pointer).
    fireEvent.keyDown(slider, { key: "ArrowRight" });
    let block = doc.getBlock(shape);
    expect(block === null || block.type !== "shape" ? null : block.attrs?.["strokeWidth"]).toBe(3);

    // One undo step: the width apply is a single transact (the stand
    // back to the absent's default — the attr is not written on undo).
    doc.undo();
    block = doc.getBlock(shape);
    expect(block === null || block.type !== "shape" ? null : block.attrs?.["strokeWidth"]).toBeUndefined();
  });

  it("the style menu applies the solid / the dashed / the no-border (one updateBlock each)", () => {
    const { doc, shape } = seededDoc();
    const { view } = renderCanvas(doc);
    selectBlock(view, doc, shape);

    const styleOf = (id: string) => {
      const block = doc.getBlock(id);
      return block === null || block.type !== "shape" ? null : block.attrs?.["strokeStyle"];
    };
    const strokeOf = (id: string) => {
      const block = doc.getBlock(id);
      return block === null || block.type !== "shape" ? null : block.attrs?.["stroke"];
    };

    fireEvent.pointerDown(screen.getByLabelText("Shape border style"));
    expect(screen.getByRole("menuitemcheckbox", { name: "Solid line" }).getAttribute("aria-checked")).toBe("true");

    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "Dashed" }));
    expect(styleOf(shape)).toBe("dash");

    // The no-border entry stands the stroke's "none" (the existing
    // idiom; the width / the style attrs stand).
    fireEvent.pointerDown(screen.getByLabelText("Shape border style"));
    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "No border" }));
    expect(strokeOf(shape)).toBe("none");

    // One undo step per apply: the stands step back.
    doc.undo();
    expect(styleOf(shape)).toBe("dash");
    doc.undo();
    expect(styleOf(shape)).toBeUndefined();
  });
});

describe("the text color's reset (the cross over the swatches)", () => {
  const textedDoc = (): { doc: TestDoc; shape: string } => {
    const doc = newDoc();
    const surface = doc.insertBlock("surface");
    const shape = doc.insertBlock("shape", { variant: "rect", text: "hello" }, { parent: surface });
    doc.setGeometry(shape, { x: 0, y: 0, w: 200, h: 100 });
    return { doc, shape };
  };

  it("stands the cross after the swatches; the pick removes the textColor attr (one undo step)", () => {
    const { doc, shape } = textedDoc();
    doc.updateBlock(shape, { textColor: "#123456" });
    const { view } = renderCanvas(doc);
    selectBlock(view, doc, shape);

    // The text section: the cross stands over the row's tail (the
    // after-all-the-colors' position) and its active stand is the set
    // color (the reset's applicability).
    fireEvent.click(screen.getByLabelText("Text color"));
    const none = screen.getByLabelText("Reset color");
    expect(none.getAttribute("data-color")).toBe("none");
    expect(none.getAttribute("aria-pressed")).toBe("true");
    const group = none.closest('[role="group"]')!;
    // The row's tail: the custom's swatch stands after the cross (the
    // hex's entry — the picker's focus), the cross stands over the
    // color's set.
    expect(group.lastElementChild?.getAttribute("data-color")).toBe("custom");
    expect(none.closest('[role="group"]')?.parentElement?.querySelector('[data-color="custom"]')).toBeTruthy();
    const customIndex = Array.from(group.children).indexOf(group.querySelector('[data-color="custom"]')!);
    const noneIndex = Array.from(group.children).indexOf(none);
    expect(noneIndex).toBe(customIndex - 1);
    expect(group.querySelectorAll('[data-slot="docblocks/palette-swatch"]').length).toBe(3);

    // The pick: the attr's removal (the other attrs stand) in one undo
    // step; the section closes (the pick's stand's parity).
    fireEvent.click(none);
    const shapeBlock = doc.getBlock(shape);
    expect(shapeBlock?.type === "shape" ? shapeBlock.attrs : null).toEqual({
      variant: "rect",
      text: "hello",
      zIndex: 1,
    });
    expect(validateDoc(doc.toJSON())).toEqual([]);
    expect(screen.queryByLabelText("Text color hex value")).toBeNull();
    doc.undo();
    const restored = doc.getBlock(shape);
    expect(restored?.type === "shape" ? restored.attrs : null).toEqual({
      variant: "rect",
      text: "hello",
      zIndex: 1,
      textColor: "#123456",
    });
  });

  it("stands the cross inert when no color stands (the active stand is off; the pick is a no-op)", () => {
    const { doc, shape } = textedDoc();
    const { view } = renderCanvas(doc);
    // The render stands the tail's paragraph (the tail contract) — the
    // attrs' stand is the comparison's unit, not the whole doc.
    const before = doc.toJSON();
    selectBlock(view, doc, shape);

    fireEvent.click(screen.getByLabelText("Text color"));
    const none = screen.getByLabelText("Reset color");
    expect(none.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(none);
    // The no-op: no write (the absent key's removal stands no update),
    // the block stands.
    const shapeBlock = doc.getBlock(shape);
    expect(shapeBlock?.type === "shape" ? shapeBlock.attrs : null).toEqual({
      variant: "rect",
      text: "hello",
      zIndex: 1,
    });
    expect(doc.toJSON().blocks[shape]).toEqual(before.blocks[shape]);
    expect(screen.queryByLabelText("Text color hex value")).toBeNull();
  });
});

describe("the concurrent deletion's guard (the peer's removal over the open toolbar)", () => {
  it("the apply over the detached block stands the no-op (no typed error into the event handler)", async () => {
    const { doc, shape } = seededDoc();
    const caught: string[] = [];
    const onUncaught = (error: Error) => caught.push(error.message);
    process.on("uncaughtException", onUncaught);
    // The toolbar renders standalone (presentational: the canvas view's
    // selection state owns its mount — here the stale stand stands, the
    // peer's deletion does not unmount it).
    render(
      <EditorProvider doc={doc}>
        <ShapeToolbar
          id={shape}
          fill={undefined}
          stroke={undefined}
          strokeWidth={undefined}
          strokeStyle={undefined}
          variant={undefined}
          text={undefined}
          fontSize={undefined}
          fontFamily={undefined}
          textColor={undefined}
          textStyle={undefined}
          textAlign={undefined}
          zStand={null}
          style={{}}
        />
      </EditorProvider>
    );
    fireEvent.pointerDown(screen.getByLabelText("Shape border style"));
    // The peer's deletion lands while the menu is open.
    act(() => {
      doc.removeBlock(shape);
    });
    try {
      fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "Dashed" }));
      await new Promise((resolve) => setTimeout(resolve, 20));
      // The guard stands the no-op: the command's typed rejection (the
      // UnknownBlockError over the detached block) never runs — no error
      // over the event dispatch (the unguarded command's throw would
      // reach the process's uncaught exception handler).
      expect(caught.filter((message) => message.includes("Unknown block"))).toEqual([]);
      expect(doc.getBlock(shape)).toBeNull();
      expect(validateDoc(doc.toJSON())).toEqual([]);
    } finally {
      process.off("uncaughtException", onUncaught);
    }
  });
});
