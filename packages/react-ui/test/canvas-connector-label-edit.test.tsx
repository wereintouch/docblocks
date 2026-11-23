// @vitest-environment jsdom
// The connector's LABEL: the line's double-click's inline edit — the
// display chip stands off, the double-click over the text selects the whole
// label, the blur / the Escape / the Enter commit (one updateBlock in one
// transact — one undo step), the empty commit's removed stand (the attr
// stands the empty string), the no-op commit's no-write (the doc's own
// read), and the edit's keys' canvas gesture's guard.
import { act, cleanup, fireEvent } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { validateDoc } from "docblocks-core";

import { dblclickLine, labelOf, renderCanvas, seededDoc } from "./canvas-connector-label.helpers";
import type { TestDoc } from "./canvas-connector-label.helpers";
import { pressBlock } from "./canvas-press";

beforeEach(() => window.localStorage.clear());
afterEach(cleanup);

describe("the label's chip + the inline edit", () => {
  it("the line's double-click opens the edit at the midpoint (the display chip stands off)", () => {
    const { doc, connector } = seededDoc();
    const { view } = renderCanvas(doc);
    expect(document.querySelector('[data-slot="docblocks/connector-label-edit"]')).toBeNull();
    expect(document.querySelector(`[data-connector-label="${connector}"]`)).toBeNull(); // the absent label

    act(() => {
      doc.transact(() => {
        doc.updateBlock(connector, { label: "link" });
      });
    });
    expect(document.querySelector(`[data-connector-label="${connector}"]`)).not.toBeNull();

    dblclickLine(view as HTMLElement, doc, connector);
    const input = document.querySelector<HTMLInputElement>('[data-slot="docblocks/connector-label-edit"]');
    expect(input).not.toBeNull();
    expect(input!.value).toBe("link"); // the committed label's seed
    // The display chip stands off while the edit stands the draft.
    expect(document.querySelector(`[data-connector-label="${connector}"]`)).toBeNull();
    // The edit's chip stand: the shared chip (the opaque theme background,
    // the 1px frame, the small rounding).
    expect(input!.style.background).toBe("var(--background)");
    expect(input!.style.border).toContain("1px solid");
    expect(input!.style.borderRadius).toBe("var(--docblocks-radius, 6px)");
    // The edit closes (the Escape's blur commit — the no-op: the value
    // stands the committed label, nothing is written).
    const before = JSON.stringify(doc.toJSON());
    fireEvent.keyDown(input!, { key: "Escape" });
    expect(document.querySelector('[data-slot="docblocks/connector-label-edit"]')).toBeNull();
    expect(JSON.stringify(doc.toJSON())).toBe(before);
    // The label's chip re-stands (the edit's close).
    expect(document.querySelector(`[data-connector-label="${connector}"]`)).not.toBeNull();
  });

  it("the double-click over the text selects the whole label", () => {
    const { doc, connector } = seededDoc();
    const { view } = renderCanvas(doc);
    act(() => {
      doc.transact(() => {
        doc.updateBlock(connector, { label: "the line" });
      });
    });
    dblclickLine(view as HTMLElement, doc, connector);
    const input = document.querySelector<HTMLInputElement>('[data-slot="docblocks/connector-label-edit"]')!;
    fireEvent.doubleClick(input);
    // The select-all stands (the Backspace / the Delete clear the
    // selection natively — the contract).
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe(input.value.length);
  });

  it("the typed commit stands the attr (the Enter / the blur; the one undo step; the doc stays valid)", () => {
    const { doc, connector } = seededDoc();
    const { view } = renderCanvas(doc);
    dblclickLine(view as HTMLElement, doc, connector);
    const input = document.querySelector<HTMLInputElement>('[data-slot="docblocks/connector-label-edit"]')!;

    // The typed commit (the Enter): one updateBlock (one undo step).
    fireEvent.change(input, { target: { value: "link" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(labelOf(doc, connector)).toBe("link");
    expect(validateDoc(doc.toJSON())).toEqual([]);
    expect(document.querySelector('[data-slot="docblocks/connector-label-edit"]')).toBeNull();
    const label = document.querySelector<HTMLElement>(`[data-connector-label="${connector}"]`);
    expect(label?.textContent).toBe("link");
    doc.undo();
    expect(labelOf(doc, connector)).toBeUndefined();

    // The blur's commit (the outside click's stand).
    dblclickLine(view as HTMLElement, doc, connector);
    const input2 = document.querySelector<HTMLInputElement>('[data-slot="docblocks/connector-label-edit"]')!;
    fireEvent.change(input2, { target: { value: "over the wire" } });
    fireEvent.blur(input2);
    expect(labelOf(doc, connector)).toBe("over the wire");
    expect(document.querySelector('[data-slot="docblocks/connector-label-edit"]')).toBeNull();
  });

  it("the empty commit stands the removed state (the attr stands the empty string)", () => {
    const { doc, connector } = seededDoc();
    const { view } = renderCanvas(doc);
    act(() => {
      doc.transact(() => {
        doc.updateBlock(connector, { label: "old" });
      });
    });
    dblclickLine(view as HTMLElement, doc, connector);
    const input = document.querySelector<HTMLInputElement>('[data-slot="docblocks/connector-label-edit"]')!;
    // The select-all + the clear (the Backspace over the selection
    // stands the empty value — the synthetic input stand).
    fireEvent.doubleClick(input);
    fireEvent.change(input, { target: { value: "" } });
    fireEvent.blur(input);
    expect(labelOf(doc, connector)).toBe("");
    expect(document.querySelector(`[data-connector-label="${connector}"]`)).toBeNull(); // the text stands nothing
    // The undo restores the label.
    doc.undo();
    expect(labelOf(doc, connector)).toBe("old");
  });

  it("the no-op commit stands nothing (the value stands the committed label — the doc's own read)", () => {
    const { doc, connector } = seededDoc();
    const { view } = renderCanvas(doc);
    act(() => {
      doc.transact(() => {
        doc.updateBlock(connector, { label: "link" });
      });
    });
    dblclickLine(view as HTMLElement, doc, connector);
    const input = document.querySelector<HTMLInputElement>('[data-slot="docblocks/connector-label-edit"]')!;
    const before = JSON.stringify(doc.toJSON());
    // The focus + the blur without the typed change writes nothing.
    fireEvent.blur(input);
    expect(JSON.stringify(doc.toJSON())).toBe(before);
    // The peer's concurrent edit stands over the draft (the commit reads
    // the doc's own value, not the mount's seed).
    act(() => {
      doc.transact(() => {
        doc.updateBlock(connector, { label: "peer" });
      });
    });
    dblclickLine(view as HTMLElement, doc, connector);
    const input2 = document.querySelector<HTMLInputElement>('[data-slot="docblocks/connector-label-edit"]')!;
    const beforePeer = JSON.stringify(doc.toJSON());
    fireEvent.blur(input2); // the value stands "peer" (the fresh seed)
    expect(JSON.stringify(doc.toJSON())).toBe(beforePeer);
  });

  it("the edit's keys stand no canvas gesture (the container's hotkeys keep the editing surface off)", () => {
    const { doc, connector } = seededDoc();
    const { view } = renderCanvas(doc);
    // The line's click selects it (the Delete would remove it).
    selectLine(view as HTMLElement, doc, connector);
    const selected = (view as HTMLElement).querySelector<SVGPathElement>(`[data-connector-id="${connector}"]`);
    expect(selected?.getAttribute("data-selected")).toBe("true");
    dblclickLine(view as HTMLElement, doc, connector);
    const input = document.querySelector<HTMLInputElement>('[data-slot="docblocks/connector-label-edit"]')!;
    // The Backspace over the edit (the character's delete stand) deletes
    // no block (the editing surface's guard stands the canvas's delete
    // off).
    fireEvent.keyDown(input, { key: "Backspace" });
    expect(doc.getBlock(connector)).not.toBeNull();
    expect(document.querySelector(`[data-connector-id="${connector}"]`)).not.toBeNull();
  });
});

/** The line's press over its own zone (the resolver's answer over the
 * geometry: the line's stroke band along its route). */
function selectLine(view: HTMLElement, doc: TestDoc, id: string): void {
  pressBlock(view, doc, id);
}
