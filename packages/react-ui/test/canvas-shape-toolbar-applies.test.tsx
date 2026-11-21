// @vitest-environment jsdom
// The shape's color toolbar's applies: a palette swatch, the "none"
// entry, and the custom hex input (one updateBlock per apply, one undo
// step; the invalid hex is ignored) + the shape type's picker.
import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { validateDoc } from "docblocks-core";

import { renderCanvas, seededDoc, selectBlock, shapeAttr, toolbar } from "./canvas-shape-toolbar.helpers";
import type { TestDoc } from "./canvas-shape-toolbar.helpers";

describe("the applies", () => {
  it("applies the fill swatch in one undo step (the svg fill stands)", () => {
    const { doc, shape } = seededDoc();
    const { view } = renderCanvas(doc);
    selectBlock(view, doc, shape);
    const before = doc.toJSON();

    // The fill section: the swatch stands directly in the open palette
    // (the popover is non-modal; the swatch click applies, the palette
    // stays open — the page format palette's behavior).
    fireEvent.click(screen.getByLabelText("Shape fill color"));
    const swatch = screen.getByLabelText("fill color 1");
    fireEvent.click(swatch);

    expect(shapeAttr(doc, shape, "fill")).toBe("#3b82f6");
    expect(validateDoc(doc.toJSON())).toEqual([]);
    doc.undo();
    expect(doc.toJSON()).toEqual(before);
  });

  it("applies the stroke swatch", () => {
    const { doc, shape } = seededDoc();
    const { view } = renderCanvas(doc);
    selectBlock(view, doc, shape);

    fireEvent.click(screen.getByLabelText("Shape stroke color"));
    fireEvent.click(screen.getByLabelText("stroke color 2"));

    expect(shapeAttr(doc, shape, "stroke")).toBe("#e11d48");
  });

  it("applies the none entry (the literal 'none' value)", () => {
    const { doc, shape } = seededDoc();
    const { view } = renderCanvas(doc);
    selectBlock(view, doc, shape);
    doc.updateBlock(shape, { fill: "#111111" });

    fireEvent.click(screen.getByLabelText("Shape fill color"));
    fireEvent.click(screen.getByLabelText("No color"));

    expect(shapeAttr(doc, shape, "fill")).toBe("none");
  });

  it("applies the custom hex on Enter (3 and 6 digits; the invalid draft is ignored)", () => {
    const { doc, shape } = seededDoc();
    const { view } = renderCanvas(doc);
    selectBlock(view, doc, shape);

    fireEvent.click(screen.getByLabelText("Shape fill color"));
    const input = screen.getByLabelText("Shape fill color hex value") as HTMLInputElement;

    // The invalid draft: no apply, the input keeps its text.
    fireEvent.change(input, { target: { value: "xyz" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(shapeAttr(doc, shape, "fill")).toBeNull();
    expect(input.value).toBe("xyz");

    // The 3-digit form applies (normalized to the `#` form, the 3 digits
    // stand — the svg fill accepts the short form); the popover closes
    // after a valid apply, so the next draft reopens it.
    fireEvent.change(input, { target: { value: "e11" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(shapeAttr(doc, shape, "fill")).toBe("#e11");

    // The 6-digit form applies; the invalid blur is ignored (the value
    // stands). The reopened section starts with an empty draft (the
    // apply closed it — the draft is the open popover's state).
    fireEvent.click(screen.getByLabelText("Shape fill color"));
    const input2 = screen.getByLabelText("Shape fill color hex value") as HTMLInputElement;
    expect(input2.value).toBe("");
    fireEvent.change(input2, { target: { value: "#a1b2c3" } });
    fireEvent.keyDown(input2, { key: "Enter" });

    fireEvent.click(screen.getByLabelText("Shape fill color"));
    const input3 = screen.getByLabelText("Shape fill color hex value");
    fireEvent.change(input3, { target: { value: "nope" } });
    fireEvent.blur(input3);
    expect(shapeAttr(doc, shape, "fill")).toBe("#a1b2c3");
  });
});

describe("the shape type picker", () => {
  function shapeVariant(doc: TestDoc, id: string): string | undefined {
    const block = doc.getBlock(id);
    if (block === null || block.type !== "shape") return undefined;
    return block.attrs?.variant;
  }

  it("stands the six variants (the current one checked) and switches the type", () => {
    const { doc, shape } = seededDoc();
    const { view } = renderCanvas(doc);
    selectBlock(view, doc, shape);
    expect(toolbar()).toBeTruthy();

    // The radix dropdown trigger toggles on pointerdown.
    fireEvent.pointerDown(screen.getByLabelText("Shape type"));
    const menu = screen.getByLabelText("Shape types");
    expect(menu).toBeTruthy();
    for (const label of ["Rectangle", "Rounded Rectangle", "Ellipse", "Diamond", "Cylinder", "Cloud"]) {
      expect(screen.getByRole("menuitemcheckbox", { name: label })).toBeTruthy();
    }
    // The current variant (rect) is the checked one.
    expect(screen.getByRole("menuitemcheckbox", { name: "Rectangle" }).getAttribute("aria-checked")).toBe("true");
    expect(screen.getByRole("menuitemcheckbox", { name: "Diamond" }).getAttribute("aria-checked")).toBe("false");

    // The new figure variants' switch:
    // one updateBlock each, one undo step.
    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "Cylinder" }));
    expect(shapeVariant(doc, shape)).toBe("cylinder");
    doc.undo();
    expect(shapeVariant(doc, shape)).toBe("rect");

    fireEvent.pointerDown(screen.getByLabelText("Shape type"));
    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "Cloud" }));
    expect(shapeVariant(doc, shape)).toBe("cloud");
    doc.undo();
    expect(shapeVariant(doc, shape)).toBe("rect");

    fireEvent.pointerDown(screen.getByLabelText("Shape type"));
    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "Diamond" }));
    expect(shapeVariant(doc, shape)).toBe("diamond");
    // One undo step: the type switch is a single transact.
    doc.undo();
    expect(shapeVariant(doc, shape)).toBe("rect");
  });

  it("the re-pick of the current variant writes nothing", () => {
    const { doc, shape } = seededDoc();
    const { view } = renderCanvas(doc);
    selectBlock(view, doc, shape);
    const before = doc.toJSON();

    fireEvent.pointerDown(screen.getByLabelText("Shape type"));
    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "Rectangle" }));
    expect(doc.toJSON()).toEqual(before);
  });
});
