// @vitest-environment jsdom
import { cleanup, fireEvent } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { act } from "react";

import { type TestDoc, renderScene } from "./canvas-scene";

afterEach(cleanup);

/** The texted shape of the scene's JSON (the text-attr's stand). */
function textedShape(doc: TestDoc) {
  const block = Object.values(doc.toJSON().blocks).find((entry) => entry.type === "shape");
  return block?.type === "shape" ? block : null;
}

describe("canvas: the shape's text (the double-click's inline edit)", () => {
  function seedTextedShape(doc: TestDoc) {
    doc.transact(() => {
      const surface = doc.insertBlock("surface");
      const rounded = doc.insertBlock(
        "shape",
        {
          variant: "rounded",
          text: "Привет\nмир",
          fontSize: 24,
          fontFamily: "Inter",
          textColor: "#ff0000",
          textStyle: "semibold-italic",
          textAlign: "left",
        },
        { parent: surface }
      );
      doc.setGeometry(rounded, { x: 0, y: 0, w: 160, h: 80 });
      const plain = doc.insertBlock("shape", { variant: "rect" }, { parent: surface });
      doc.setGeometry(plain, { x: 100, y: 100, w: 80, h: 40 });
    });
  }

  it("stands the text overlay with the font attrs as inline styles (the data, not theme)", () => {
    renderScene({ seed: seedTextedShape, view: "canvas" });
    const overlay = document.querySelector<HTMLElement>("[data-slot='docblocks/shape-text']")!;
    expect(overlay).not.toBeNull();
    expect(overlay.textContent).toBe("Привет\nмир");
    // The style stands the wrapper div (the flex centering box).
    const wrapper = overlay.parentElement!;
    const style = wrapper.style;
    expect(style.fontFamily).toBe('"Inter", "Open Sans", Arial, sans-serif');
    expect(style.fontSize).toBe("24px");
    expect(style.color).toBe("rgb(255, 0, 0)");
    expect(style.fontWeight).toBe("600");
    expect(style.fontStyle).toBe("italic");
    expect(style.textAlign).toBe("left");
    // The wrapping (the figure's edges) and the pre-wrap soft breaks.
    expect(style.whiteSpace).toBe("pre-wrap");
    expect(style.overflowWrap).toBe("break-word");
  });

  it("stands the defaults (the 16px, the center alignment, the editor's font) for the attrless stand", () => {
    renderScene({ seed: seedTextedShape, view: "canvas" });
    const plainItem = document.querySelectorAll<HTMLElement>("[data-slot='docblocks/shape-text']");
    // The textless rect stands the empty overlay (the dblclick's target).
    expect(plainItem.length).toBe(2);
    const empty = [...plainItem].find((el) => el.textContent === "")!;
    const style = empty.parentElement!.style;
    expect(style.fontSize).toBe("16px");
    expect(style.textAlign).toBe("center");
    expect(style.fontFamily).toBe("");
  });

  it("enters the inline edit on the double-click and commits the text on the blur (one updateBlock)", () => {
    const doc = renderScene({ seed: seedTextedShape, view: "canvas" });
    // The dblclick's target is the full-size box (the inner's content div
    // is zero-height on the empty stand).
    const target = document.querySelector<HTMLElement>("[data-slot='docblocks/shape-text-target']")!;
    fireEvent.dblClick(target);
    const edit = document.querySelector<HTMLElement>("[data-slot='docblocks/shape-text-edit']")!;
    expect(edit).not.toBeNull();
    expect(edit.getAttribute("contenteditable")).toBe("true");
    // The seed stands the attr's text (the draft is the browser's).
    expect(edit.textContent).toBe("Привет\nмир");
    // The draft: the browser's edit (the test stands it directly).
    act(() => {
      edit.textContent = "Привет\nмир!\nдва";
    });
    fireEvent.blur(edit);
    expect(textedShape(doc)?.attrs?.text).toBe("Привет\nмир!\nдва");
    // One undo step.
    doc.undo();
    expect(textedShape(doc)?.attrs?.text).toBe("Привет\nмир");
  });

  it("commits nothing for the empty edit (the no-op stand writes no attr)", () => {
    const doc = renderScene({ seed: seedTextedShape, view: "canvas" });
    const items = document.querySelectorAll<HTMLElement>("[data-slot='docblocks/shape-text-target']");
    const empties = [...items];
    const before = doc.toJSON();
    fireEvent.dblClick(empties[empties.length - 1]!);
    const edit = document.querySelector<HTMLElement>("[data-slot='docblocks/shape-text-edit']")!;
    expect(edit.textContent).toBe("");
    fireEvent.blur(edit);
    expect(doc.toJSON()).toEqual(before);
  });
});
