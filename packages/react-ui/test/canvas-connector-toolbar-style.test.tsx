// @vitest-environment jsdom
// The connector's toolbar's style's applies: the width's step, the
// arrowhead's figures (the end / the start's no-op's default's stand),
// the stroke's style, and the palette's color (one updateBlock per pick,
// one undo's step; the no-op's stand writes nothing).
import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { validateDoc } from "docblocks-core";
import type { BlockId } from "docblocks-core";

import { renderCanvas, seededDoc, selectBlock, toolbar } from "./canvas-connector-toolbar.helpers";
import type { TestDoc } from "./canvas-connector-toolbar.helpers";

describe("the style applies", () => {
  /** The connector's style attrs (the doc's own read). */
  function styleOf(
    doc: TestDoc,
    id: BlockId
  ): {
    strokeWidth?: number;
    strokeColor?: string;
    strokeStyle?: "solid" | "dash" | "dot";
    arrowHead?: "none" | "arrow" | "circle";
    arrowStart?: "none" | "arrow" | "circle";
  } {
    const block = doc.getBlock(id);
    if (block === null || block.type !== "connector") return {};
    return block.attrs;
  }

  it("the width's step applies the strokeWidth (one undo step; the no-op stand writes nothing)", () => {
    const { doc, connector } = seededDoc();
    const { view } = renderCanvas(doc);
    selectBlock(view as HTMLElement, doc, connector);
    const slider = document.querySelector('[data-slot="docblocks/figure-border-selector"]');
    if (slider === null) throw new Error("the width selector is missing");

    // The absent stand is the 1 px default (index 0): the no-op step
    // back writes nothing.
    const before = JSON.stringify(doc.toJSON());
    fireEvent.keyDown(slider, { key: "Home" });
    expect(JSON.stringify(doc.toJSON())).toBe(before);

    // The End stand: the 4 px width (one updateBlock, one undo step).
    fireEvent.keyDown(slider, { key: "End" });
    expect(styleOf(doc, connector).strokeWidth).toBe(4);
    expect(validateDoc(doc.toJSON())).toEqual([]);
    doc.undo();
    expect(styleOf(doc, connector).strokeWidth).toBeUndefined();
  });

  it("the end arrowhead's pick applies the figure (the arrow's default pick is the no-op stand)", () => {
    const { doc, connector } = seededDoc();
    const { view } = renderCanvas(doc);
    selectBlock(view as HTMLElement, doc, connector);

    // The default (absent) stands the arrow: the arrow pick writes
    // nothing.
    const before = JSON.stringify(doc.toJSON());
    fireEvent.pointerDown(screen.getByLabelText("End arrowhead"));
    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "Arrow" }));
    expect(JSON.stringify(doc.toJSON())).toBe(before);
    expect(styleOf(doc, connector).arrowHead).toBeUndefined();

    // The circle pick: one updateBlock (one undo step).
    fireEvent.pointerDown(screen.getByLabelText("End arrowhead"));
    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "Circle" }));
    expect(styleOf(doc, connector).arrowHead).toBe("circle");
    expect(validateDoc(doc.toJSON())).toEqual([]);
    doc.undo();
    expect(styleOf(doc, connector).arrowHead).toBeUndefined();

    // The none pick.
    fireEvent.pointerDown(screen.getByLabelText("End arrowhead"));
    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "None" }));
    expect(styleOf(doc, connector).arrowHead).toBe("none");
  });

  it("the start arrowhead's pick applies its own figure (the none default is the no-op stand)", () => {
    const { doc, connector } = seededDoc();
    const { view } = renderCanvas(doc);
    selectBlock(view as HTMLElement, doc, connector);

    // The absent stand (no start marker) stands the none: the none pick
    // writes nothing (independent of the end's figure).
    const before = JSON.stringify(doc.toJSON());
    fireEvent.pointerDown(screen.getByLabelText("Start arrowhead"));
    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "None" }));
    expect(JSON.stringify(doc.toJSON())).toBe(before);
    expect(styleOf(doc, connector).arrowStart).toBeUndefined();

    // The arrow pick: one updateBlock (one undo step). The start stands
    // its own figure — the end's arrow default does not leak over.
    fireEvent.pointerDown(screen.getByLabelText("Start arrowhead"));
    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "Arrow" }));
    expect(styleOf(doc, connector).arrowStart).toBe("arrow");
    expect(validateDoc(doc.toJSON())).toEqual([]);
    doc.undo();
    expect(styleOf(doc, connector).arrowStart).toBeUndefined();

    // The circle pick.
    fireEvent.pointerDown(screen.getByLabelText("Start arrowhead"));
    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "Circle" }));
    expect(styleOf(doc, connector).arrowStart).toBe("circle");
  });

  it("the two arrowhead menus stand the start before the end", () => {
    const { doc, connector } = seededDoc();
    const { view } = renderCanvas(doc);
    selectBlock(view as HTMLElement, doc, connector);
    const start = document.querySelector('[data-slot="docblocks/connector-toolbar-arrow-start"]');
    const end = document.querySelector('[data-slot="docblocks/connector-toolbar-arrow-end"]');
    if (start === null || end === null) throw new Error("the arrowhead menus are missing");
    // The start menu precedes the end menu in the toolbar's DOM order.
    expect(start.compareDocumentPosition(end) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("the stroke style's pick applies the strokeStyle (the solid default; the no-op stand writes nothing)", () => {
    const { doc, connector } = seededDoc();
    const { view } = renderCanvas(doc);
    selectBlock(view as HTMLElement, doc, connector);

    // The two style options stand (the solid / the dashed).
    expect(document.querySelector('[data-slot="docblocks/connector-toolbar-solid"]')).not.toBeNull();
    expect(document.querySelector('[data-slot="docblocks/connector-toolbar-dash"]')).not.toBeNull();

    // The absent stand is the solid default: the solid pick is the no-op
    // stand (it writes nothing).
    const before = JSON.stringify(doc.toJSON());
    fireEvent.click(screen.getByLabelText("Solid line"));
    expect(JSON.stringify(doc.toJSON())).toBe(before);
    expect(styleOf(doc, connector).strokeStyle).toBeUndefined();

    // The dashed pick: one updateBlock (one undo step).
    fireEvent.click(screen.getByLabelText("Dashed line"));
    expect(styleOf(doc, connector).strokeStyle).toBe("dash");
    expect(validateDoc(doc.toJSON())).toEqual([]);
    // The current (dashed) option stands pressed, the solid does not.
    expect(document.querySelector('[data-slot="docblocks/connector-toolbar-dash"]')?.getAttribute("aria-pressed")).toBe(
      "true"
    );
    expect(
      document.querySelector('[data-slot="docblocks/connector-toolbar-solid"]')?.getAttribute("aria-pressed")
    ).toBe("false");

    // A re-pick of the current (dashed) style is the no-op stand (it writes
    // nothing).
    const beforeDash = JSON.stringify(doc.toJSON());
    fireEvent.click(screen.getByLabelText("Dashed line"));
    expect(JSON.stringify(doc.toJSON())).toBe(beforeDash);
    expect(styleOf(doc, connector).strokeStyle).toBe("dash");

    // The solid pick: the switch back (one updateBlock, one undo step).
    fireEvent.click(screen.getByLabelText("Solid line"));
    expect(styleOf(doc, connector).strokeStyle).toBe("solid");
    doc.undo();
    expect(styleOf(doc, connector).strokeStyle).toBe("dash");
  });

  it("the palette's pick applies the strokeColor (the data color; the none stand is the theme token)", () => {
    const { doc, connector } = seededDoc();
    const { view } = renderCanvas(doc);
    selectBlock(view as HTMLElement, doc, connector);

    // The hex commit: one updateBlock in one transact.
    fireEvent.click(screen.getByLabelText("Line color"));
    const input = screen.getByLabelText("Line color hex value");
    fireEvent.change(input, { target: { value: "#ff0000" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(styleOf(doc, connector).strokeColor).toBe("#ff0000");
    expect(validateDoc(doc.toJSON())).toEqual([]);
    doc.undo();
    expect(styleOf(doc, connector).strokeColor).toBeUndefined();

    // The no-color entry: the explicit default stand (the theme token
    // renders — the absent / "none" values are the same stand).
    fireEvent.click(screen.getByLabelText("Line color"));
    fireEvent.click(screen.getByLabelText("No color"));
    expect(styleOf(doc, connector).strokeColor).toBe("none");
  });

  it("stands no label input (the label's edit is the line's double-click)", () => {
    const { doc, connector } = seededDoc();
    const { view } = renderCanvas(doc);
    selectBlock(view as HTMLElement, doc, connector);
    expect(toolbar()).toBeTruthy();
    // The toolbar's label control stands gone (the inline edit stands
    // over the line instead — the canvas-connector-label's pins).
    expect(document.querySelector('[data-slot="docblocks/connector-toolbar-label"]')).toBeNull();
    expect(screen.queryByLabelText("Line label")).toBeNull();
  });
});
