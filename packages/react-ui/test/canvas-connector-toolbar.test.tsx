// @vitest-environment jsdom
// The connector's type toolbar (the single `connector` selection): the
// render conditions (the single connector stands it; the multi selection,
// the non-connector blocks, and the active tool hide it) and the applies
// (one updateBlock per pick, one undo step; the doc stays valid).
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createDoc, validateDoc } from "docblocks-core";
import type { BlockId } from "docblocks-core";

import { Editor } from "../src/Editor";
import { EditorProvider } from "../src/EditorProvider";

const CREATED_AT = "2026-10-10T00:00:00.000Z";

type TestDoc = ReturnType<typeof createDoc>;

function newDoc(): TestDoc {
  return createDoc({ id: "connector-type-doc", createdAt: CREATED_AT });
}

function seededDoc(): { doc: TestDoc; connector: BlockId; shape: BlockId } {
  const doc = newDoc();
  doc.transact(() => {
    const surface = doc.insertBlock("surface");
    const a = doc.insertBlock("shape", { variant: "rect" }, { parent: surface });
    doc.setGeometry(a, { x: -200, y: 0, w: 100, h: 60 });
    const b = doc.insertBlock("shape", { variant: "rect" }, { parent: surface });
    doc.setGeometry(b, { x: 200, y: 0, w: 100, h: 60 });
    const connector = doc.insertBlock(
      "connector",
      { start: { blockId: a }, end: { blockId: b } },
      {
        parent: surface,
      }
    );
    return { connector, shape: a };
  });
  // The transact's return: read the ids back (the deterministic order).
  const json = doc.toJSON();
  const surfaceId = Object.keys(json.blocks).find((id) => json.blocks[id]?.type === "surface")!;
  const ids = doc.getChildren(surfaceId);
  const shape = ids.find((id) => json.blocks[id]?.type === "shape")!;
  const connector = ids.find((id) => json.blocks[id]?.type === "connector")!;
  return { doc, connector, shape };
}

function renderCanvas(doc: TestDoc) {
  const utils = render(
    <EditorProvider doc={doc}>
      <Editor view="canvas" />
    </EditorProvider>
  );
  const view = utils.container.querySelector('[data-slot="docblocks/canvas-view"]');
  if (view === null) throw new Error("the canvas view is missing");
  return { ...utils, view };
}

const toolbar = () => screen.queryByRole("toolbar", { name: "Connector options" });

/** Click-select the block (the pointerdown on its canvas-item / hit-path). */
function selectBlock(container: HTMLElement, id: string, viaHitPath = false): void {
  const selector = viaHitPath
    ? `[data-connector-hit="${id}"]`
    : `[data-slot="docblocks/canvas-item"][data-block-id="${id}"]`;
  const target = container.querySelector<HTMLElement>(selector);
  if (target === null) throw new Error(`the ${viaHitPath ? "hit path" : "canvas item"} ${id} is missing`);
  fireEvent.pointerDown(target, { clientX: 10, clientY: 10, pointerId: 1 });
  fireEvent.pointerUp(target, { pointerId: 1 });
}

function variantOf(doc: TestDoc, id: string): string | undefined {
  const block = doc.getBlock(id);
  if (block === null || block.type !== "connector") return undefined;
  return block.attrs?.variant;
}

describe("the render conditions", () => {
  it("stands the toolbar for a single connector selection", () => {
    const { doc, connector } = seededDoc();
    const { view } = renderCanvas(doc);
    expect(toolbar()).toBeNull();

    selectBlock(view as HTMLElement, connector, true);
    expect(toolbar()).toBeTruthy();
    expect(document.querySelector('[data-slot="docblocks/connector-toolbar-straight"]')).not.toBeNull();
    expect(document.querySelector('[data-slot="docblocks/connector-toolbar-orthogonal"]')).not.toBeNull();
    expect(document.querySelector('[data-slot="docblocks/connector-toolbar-curved"]')).not.toBeNull();
    // The absent variant: no pressed variant option (the default stands
    // straight). The solid style option stands pressed (the absent style's
    // default).
    for (const v of ["straight", "orthogonal", "curved"]) {
      expect(
        document.querySelector(`[data-slot="docblocks/connector-toolbar-${v}"]`)?.getAttribute("aria-pressed")
      ).toBe("false");
    }
    expect(
      document.querySelector('[data-slot="docblocks/connector-toolbar-solid"]')?.getAttribute("aria-pressed")
    ).toBe("true");
  });

  it("hides the toolbar for a shape selection (the shape toolbar stands instead)", () => {
    const { doc, shape } = seededDoc();
    const { view } = renderCanvas(doc);
    selectBlock(view as HTMLElement, shape);
    expect(toolbar()).toBeNull();
    expect(screen.queryByRole("toolbar", { name: "Shape options" })).toBeTruthy();
  });

  it("hides the toolbar for the multi selection", () => {
    const { doc, connector, shape } = seededDoc();
    const { view } = renderCanvas(doc);
    selectBlock(view as HTMLElement, connector, true);
    expect(toolbar()).toBeTruthy();

    // The shape's press moves the selection over (the connectors are
    // click-only selectable — a connector joins no group in v1): the
    // toolbar follows the selection and hides.
    selectBlock(view as HTMLElement, shape);
    const shapeSel = (view as HTMLElement).querySelector<HTMLElement>(
      `[data-slot="docblocks/canvas-item"][data-block-id="${shape}"]`
    );
    expect(shapeSel?.hasAttribute("data-selected")).toBe(true);
    expect(toolbar()).toBeNull();
  });
});

describe("the applies", () => {
  it("the orthogonal pick applies the variant (one undo step, the doc stays valid)", () => {
    const { doc, connector } = seededDoc();
    const { view } = renderCanvas(doc);
    selectBlock(view as HTMLElement, connector, true);

    fireEvent.click(screen.getByLabelText("Orthogonal line"));
    expect(variantOf(doc, connector)).toBe("orthogonal");
    expect(validateDoc(doc.toJSON())).toEqual([]);

    // One undo step: the variant patch reverts (one transact).
    doc.undo();
    expect(variantOf(doc, connector)).toBeUndefined();
  });

  it("the curved pick applies and the current option stands pressed", () => {
    const { doc, connector } = seededDoc();
    const { view } = renderCanvas(doc);
    selectBlock(view as HTMLElement, connector, true);

    fireEvent.click(screen.getByLabelText("Curved line"));
    expect(variantOf(doc, connector)).toBe("curved");
    const curved = document.querySelector('[data-slot="docblocks/connector-toolbar-curved"]');
    expect(curved?.getAttribute("aria-pressed")).toBe("true");
    const straight = document.querySelector('[data-slot="docblocks/connector-toolbar-straight"]');
    expect(straight?.getAttribute("aria-pressed")).toBe("false");
  });
});

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
    selectBlock(view as HTMLElement, connector, true);
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
    selectBlock(view as HTMLElement, connector, true);

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
    selectBlock(view as HTMLElement, connector, true);

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
    selectBlock(view as HTMLElement, connector, true);
    const start = document.querySelector('[data-slot="docblocks/connector-toolbar-arrow-start"]');
    const end = document.querySelector('[data-slot="docblocks/connector-toolbar-arrow-end"]');
    if (start === null || end === null) throw new Error("the arrowhead menus are missing");
    // The start menu precedes the end menu in the toolbar's DOM order.
    expect(start.compareDocumentPosition(end) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("the stroke style's pick applies the strokeStyle (the solid default; the no-op stand writes nothing)", () => {
    const { doc, connector } = seededDoc();
    const { view } = renderCanvas(doc);
    selectBlock(view as HTMLElement, connector, true);

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
    selectBlock(view as HTMLElement, connector, true);

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
    selectBlock(view as HTMLElement, connector, true);
    expect(toolbar()).toBeTruthy();
    // The toolbar's label control stands gone (the inline edit stands
    // over the line instead — the canvas-connector-label's pins).
    expect(document.querySelector('[data-slot="docblocks/connector-toolbar-label"]')).toBeNull();
    expect(screen.queryByLabelText("Line label")).toBeNull();
  });
});

beforeEach(() => window.localStorage.clear());
afterEach(cleanup);
