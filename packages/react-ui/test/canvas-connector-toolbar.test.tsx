// @vitest-environment jsdom
// The connector's type's toolbar (the single `connector`'s selection):
// the render's conditions (the single's connector's stand; the multi's
// selection / the shape's selection's hide), the variant's applies (one
// updateBlock per pick, one undo's step), and the concurrent's deletion's
// guard (the peer's removal over the open's toolbar).
import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { validateDoc } from "docblocks-core";

import { ConnectorToolbar } from "../src/canvas";
import { EditorProvider } from "../src/editor-provider";
import { renderCanvas, seededDoc, selectBlock, toolbar, variantOf } from "./canvas-connector-toolbar.helpers";

describe("the render conditions", () => {
  it("stands the toolbar for a single connector selection", () => {
    const { doc, connector } = seededDoc();
    const { view } = renderCanvas(doc);
    expect(toolbar()).toBeNull();

    selectBlock(view as HTMLElement, doc, connector);
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
    selectBlock(view as HTMLElement, doc, shape);
    expect(toolbar()).toBeNull();
    expect(screen.queryByRole("toolbar", { name: "Shape options" })).toBeTruthy();
  });

  it("hides the toolbar for the multi selection", () => {
    const { doc, connector, shape } = seededDoc();
    const { view } = renderCanvas(doc);
    selectBlock(view as HTMLElement, doc, connector);
    expect(toolbar()).toBeTruthy();

    // The shape's press moves the selection over (the connectors are
    // click-only selectable — a connector joins no group in v1): the
    // toolbar follows the selection and hides.
    selectBlock(view as HTMLElement, doc, shape);
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
    selectBlock(view as HTMLElement, doc, connector);

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
    selectBlock(view as HTMLElement, doc, connector);

    fireEvent.click(screen.getByLabelText("Curved line"));
    expect(variantOf(doc, connector)).toBe("curved");
    const curved = document.querySelector('[data-slot="docblocks/connector-toolbar-curved"]');
    expect(curved?.getAttribute("aria-pressed")).toBe("true");
    const straight = document.querySelector('[data-slot="docblocks/connector-toolbar-straight"]');
    expect(straight?.getAttribute("aria-pressed")).toBe("false");
  });
});

describe("the concurrent deletion's guard (the peer's removal over the open toolbar)", () => {
  it("the apply over the detached block stands the no-op (no typed error into the event handler)", async () => {
    const { doc, connector } = seededDoc();
    const caught: string[] = [];
    const onUncaught = (error: Error) => caught.push(error.message);
    process.on("uncaughtException", onUncaught);
    // The toolbar renders standalone (presentational: the canvas view's
    // selection state owns its mount — here the stale stand stands, the
    // peer's deletion does not unmount it).
    render(
      <EditorProvider doc={doc}>
        <ConnectorToolbar
          id={connector}
          variant={undefined}
          strokeColor={undefined}
          strokeWidth={undefined}
          strokeStyle={undefined}
          arrowHead={undefined}
          arrowStart={undefined}
          zStand={null}
          style={{}}
        />
      </EditorProvider>
    );
    // The peer's deletion lands while the toolbar is open.
    act(() => {
      doc.removeBlock(connector);
    });
    try {
      fireEvent.click(screen.getByLabelText("Orthogonal line"));
      await new Promise((resolve) => setTimeout(resolve, 20));
      // The guard stands the no-op: the command's typed rejection (the
      // UnknownBlockError over the detached block) never runs — no error
      // over the event dispatch (the unguarded command's throw would
      // reach the process's uncaught exception handler).
      expect(caught.filter((message) => message.includes("Unknown block"))).toEqual([]);
      expect(doc.getBlock(connector)).toBeNull();
      expect(validateDoc(doc.toJSON())).toEqual([]);
    } finally {
      process.off("uncaughtException", onUncaught);
    }
  });
});
