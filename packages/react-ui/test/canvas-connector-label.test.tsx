// @vitest-environment jsdom
// The connector's LABEL: the label's chip stands always (not only in the
// edit) — the opaque theme background over the 1px frame of the line's own
// color, at the line's midpoint (the world's space), pointer-transparent
// (the line's hit path keeps the click / the double-click). The chip stands
// in the canvas view only (the page view carries no surface).
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { act } from "react";

import { Editor } from "../src/Editor";
import { EditorProvider } from "../src/editor-provider";
import { renderCanvas, seededDoc } from "./canvas-connector-label.helpers";

describe("the label's chip + the inline edit", () => {
  it("the label's chip stands always (the display stand) — the opaque theme background, the 1px frame, the midpoint, pointer-transparent", () => {
    const { doc, connector } = seededDoc();
    renderCanvas(doc);
    expect(document.querySelector(`[data-connector-label="${connector}"]`)).toBeNull(); // the absent label

    act(() => {
      doc.transact(() => {
        doc.updateBlock(connector, { label: "link" });
      });
    });
    // The display chip stands (always — not only in the edit).
    const chip = document.querySelector<HTMLElement>(`[data-connector-label="${connector}"]`);
    expect(chip).not.toBeNull();
    expect(chip!.dataset.slot).toBe("docblocks/connector-label-chip");
    expect(chip!.textContent).toBe("link");
    // The opaque theme background (the adaptive token — masks the line
    // behind the label), the small corner rounding, the pointer-
    // transparent stand (the line's hit path keeps the click / the
    // double-click).
    expect(chip!.style.background).toBe("var(--background)");
    expect(chip!.style.borderRadius).toBe("var(--docblocks-radius, 6px)");
    expect(chip!.style.pointerEvents).toBe("none");
    // No wrap (the width follows the text — a long label stands one line).
    expect(chip!.style.whiteSpace).toBe("nowrap");
    // The 1px frame stands the line's default stroke (no data color
    // stands).
    expect(chip!.style.border).toContain("1px solid");
    expect(chip!.style.border).toContain("var(--docblocks-canvas-shape-stroke");
    // The frame follows the line's own color (the data's strokeColor; jsdom
    // normalizes the hex to its rgb stand).
    act(() => {
      doc.transact(() => {
        doc.updateBlock(connector, { strokeColor: "#c96a6a" });
      });
    });
    expect(document.querySelector<HTMLElement>(`[data-connector-label="${connector}"]`)!.style.border).toContain(
      "rgb(201, 106, 106)"
    );
  });

  it("the page view carries no surface (the chip stands in the canvas view only)", () => {
    const { doc, connector } = seededDoc();
    render(
      <EditorProvider doc={doc}>
        <Editor view="page" />
      </EditorProvider>
    );
    act(() => {
      doc.transact(() => {
        doc.updateBlock(connector, { label: "relates to" });
      });
    });
    // The surface is a canvas layer: the page view's sequence filters it
    // out, so the scene (the line, the chip) stands in the canvas view
    // only.
    expect(document.querySelector(`[data-connector-label="${connector}"]`)).toBeNull();
    expect(document.querySelector("[data-connector-id]")).toBeNull();
  });

  it("the canvas view's label chip (the display stand over the line's midpoint)", () => {
    const { doc, connector } = seededDoc();
    renderCanvas(doc);
    act(() => {
      doc.transact(() => {
        doc.updateBlock(connector, { label: "relates to" });
      });
    });
    const chip = document.querySelector<HTMLElement>(`[data-connector-label="${connector}"]`);
    expect(chip).not.toBeNull();
    expect(chip!.dataset.slot).toBe("docblocks/connector-label-chip");
    expect(chip!.textContent).toBe("relates to");
    expect(chip!.style.background).toBe("var(--background)");
    expect(chip!.style.pointerEvents).toBe("none");
  });
});

beforeEach(() => window.localStorage.clear());
afterEach(cleanup);
