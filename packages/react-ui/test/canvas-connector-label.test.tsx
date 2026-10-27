// @vitest-environment jsdom
// The connector's LABEL: the label's chip
// stands always (not only in the edit) — the opaque theme background over
// the 1px frame of the line's own color, at the line's midpoint (the world's
// space). The line's double-click opens the inline edit (the display chip
// stands off), the double-click over the text selects the whole label, the
// blur / the Escape / the Enter commit (one updateBlock in one transact —
// one undo step), and the empty commit stands the removed state (the attr
// stands the empty string). The no-op commit (the value stands the committed
// label) writes nothing.
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createDoc, validateDoc } from "docblocks-core";
import type { BlockId } from "docblocks-core";

import { Editor } from "../src/Editor";
import { EditorProvider } from "../src/EditorProvider";

const CREATED_AT = "2026-10-10T00:00:00.000Z";

type TestDoc = ReturnType<typeof createDoc>;

function newDoc(): TestDoc {
  return createDoc({ id: "connector-label-doc", createdAt: CREATED_AT });
}

function seededDoc(): { doc: TestDoc; connector: BlockId } {
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
    return { connector };
  });
  const json = doc.toJSON();
  const surfaceId = Object.keys(json.blocks).find((id) => json.blocks[id]?.type === "surface")!;
  const ids = doc.getChildren(surfaceId);
  const connector = ids.find((id) => json.blocks[id]?.type === "connector")!;
  return { doc, connector };
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

function labelOf(doc: TestDoc, id: string): string | undefined {
  const block = doc.getBlock(id);
  if (block === null || block.type !== "connector") return undefined;
  return block.attrs.label;
}

/** The line's hit path (the wide transparent stroke the line clicks on). */
function hitPath(container: HTMLElement, id: string): SVGPathElement {
  const path = container.querySelector<SVGPathElement>(`[data-connector-hit="${id}"]`);
  if (path === null) throw new Error(`the hit path ${id} is missing`);
  return path;
}

/** The double-click over the line (the hit path's dblclick bubbles to the
 * container's handler — the press keeps no capture, so the target is the
 * line itself). */
function dblclickLine(view: HTMLElement, id: string): void {
  fireEvent.doubleClick(hitPath(view, id));
}

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

  it("the page view's inert surface keeps the label's chip (the display stand, both views)", () => {
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
    // The page view's surface stands the chip (the label is not only a
    // canvas-view stand).
    const chip = document.querySelector<HTMLElement>(`[data-connector-label="${connector}"]`);
    expect(chip).not.toBeNull();
    expect(chip!.dataset.slot).toBe("docblocks/connector-label-chip");
    expect(chip!.textContent).toBe("relates to");
    expect(chip!.style.background).toBe("var(--background)");
    expect(chip!.style.pointerEvents).toBe("none");
  });

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

    dblclickLine(view as HTMLElement, connector);
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
    dblclickLine(view as HTMLElement, connector);
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
    dblclickLine(view as HTMLElement, connector);
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
    dblclickLine(view as HTMLElement, connector);
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
    dblclickLine(view as HTMLElement, connector);
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
    dblclickLine(view as HTMLElement, connector);
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
    dblclickLine(view as HTMLElement, connector);
    const input2 = document.querySelector<HTMLInputElement>('[data-slot="docblocks/connector-label-edit"]')!;
    const beforePeer = JSON.stringify(doc.toJSON());
    fireEvent.blur(input2); // the value stands "peer" (the fresh seed)
    expect(JSON.stringify(doc.toJSON())).toBe(beforePeer);
  });

  it("the edit's keys stand no canvas gesture (the container's hotkeys keep the editing surface off)", () => {
    const { doc, connector } = seededDoc();
    const { view } = renderCanvas(doc);
    // The line's click selects it (the Delete would remove it).
    selectLine(view as HTMLElement, connector);
    const selected = (view as HTMLElement).querySelector<SVGPathElement>(`[data-connector-id="${connector}"]`);
    expect(selected?.getAttribute("data-selected")).toBe("true");
    dblclickLine(view as HTMLElement, connector);
    const input = document.querySelector<HTMLInputElement>('[data-slot="docblocks/connector-label-edit"]')!;
    // The Backspace over the edit (the character's delete stand) deletes
    // no block (the editing surface's guard stands the canvas's delete
    // off).
    fireEvent.keyDown(input, { key: "Backspace" });
    expect(doc.getBlock(connector)).not.toBeNull();
    expect(document.querySelector(`[data-connector-id="${connector}"]`)).not.toBeNull();
  });
});

/** The line's click (the hit path's pointerdown — the selection's stand). */
function selectLine(container: HTMLElement, id: string): void {
  const target = hitPath(container, id);
  fireEvent.pointerDown(target, { clientX: 10, clientY: 10, pointerId: 1 });
  fireEvent.pointerUp(target, { pointerId: 1 });
}

beforeEach(() => window.localStorage.clear());
afterEach(cleanup);
