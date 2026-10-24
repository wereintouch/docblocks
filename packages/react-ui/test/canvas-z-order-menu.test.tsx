// @vitest-environment jsdom
// The canvas z-order menu (the explicit zIndex): the three-dots
// trigger over the shape / connector toolbars, the four reorder picks,
// the disabled edge states, and the applies (one `setZOrder` per pick —
// one transact, one undo step, the dense indices follow the order).
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { createDoc, validateDoc } from "docblocks-core";

import { Editor } from "../src/Editor";
import { EditorProvider } from "../src/EditorProvider";

const CREATED_AT = "2026-10-10T00:00:00.000Z";

type TestDoc = ReturnType<typeof createDoc>;

function canvasIdGenerator(): () => string {
  let next = 0;
  return () => {
    next += 1;
    return `m${String(next).padStart(4, "0")}`;
  };
}

/** The surface (m0001) + the three rects in the z-order (m0002–m0004). */
function seededDoc(): TestDoc {
  const doc = createDoc({ id: "z-order-menu-doc", createdAt: CREATED_AT, generateId: canvasIdGenerator() });
  const surface = doc.insertBlock("surface");
  const a = doc.insertBlock("shape", { variant: "rect" }, { parent: surface });
  const b = doc.insertBlock("shape", { variant: "rect" }, { parent: surface });
  const c = doc.insertBlock("shape", { variant: "rect" }, { parent: surface });
  doc.setGeometry(a, { x: -120, y: 0, w: 80, h: 60 });
  doc.setGeometry(b, { x: 0, y: 0, w: 80, h: 60 });
  doc.setGeometry(c, { x: 120, y: 0, w: 80, h: 60 });
  return doc;
}

/** The surface + the two rects + the connector (m0004). */
function connectorDoc(): TestDoc {
  const doc = createDoc({ id: "z-order-menu-doc", createdAt: CREATED_AT, generateId: canvasIdGenerator() });
  doc.transact(() => {
    const surface = doc.insertBlock("surface");
    const a = doc.insertBlock("shape", { variant: "rect" }, { parent: surface });
    const b = doc.insertBlock("shape", { variant: "rect" }, { parent: surface });
    doc.setGeometry(a, { x: -120, y: 0, w: 80, h: 60 });
    doc.setGeometry(b, { x: 120, y: 0, w: 80, h: 60 });
    doc.insertBlock("connector", { start: { blockId: a }, end: { blockId: b } }, { parent: surface });
  });
  return doc;
}

function renderCanvas(doc: TestDoc) {
  const utils = render(
    <EditorProvider doc={doc}>
      <Editor view="canvas" />
    </EditorProvider>
  );
  const view = utils.container.querySelector('[data-slot="docblocks/canvas-view"]');
  if (view === null) throw new Error("the canvas view is missing");
  return { ...utils, view: view as HTMLElement };
}

/** Click-select the block (the pointerdown on its canvas-item / hit path). */
function selectBlock(container: HTMLElement, id: string, viaHitPath = false): void {
  const selector = viaHitPath
    ? `[data-connector-hit="${id}"]`
    : `[data-slot="docblocks/canvas-item"][data-block-id="${id}"]`;
  const target = container.querySelector<HTMLElement>(selector);
  if (target === null) throw new Error(`the ${viaHitPath ? "hit path" : "canvas item"} ${id} is missing`);
  fireEvent.pointerDown(target, { clientX: 10, clientY: 10, pointerId: 1 });
  fireEvent.pointerUp(target, { pointerId: 1 });
}

/** The z-order trigger (the three-dots button) of the open toolbar. */
const zOrderTrigger = () => document.querySelector<HTMLElement>('[data-slot="docblocks/z-order-menu"]');

/** The menu's item by its label (throws when the menu is closed). */
function zOrderItem(name: string): HTMLElement {
  const item = screen.getByRole("menuitem", { name });
  return item as HTMLElement;
}

function isDisabled(item: HTMLElement): boolean {
  return item.hasAttribute("data-disabled") || item.getAttribute("aria-disabled") === "true";
}

function zIndexOf(doc: TestDoc, id: string): number {
  const block = doc.getBlock(id) as { attrs?: { zIndex?: number } } | null;
  return block?.attrs?.zIndex ?? -1;
}

afterEach(cleanup);

describe("the shape toolbar's z-order menu", () => {
  it("stands the three-dots trigger for the single shape selection", () => {
    const doc = seededDoc();
    const { view } = renderCanvas(doc);
    expect(zOrderTrigger()).toBeNull();

    selectBlock(view, "m0002");
    const trigger = zOrderTrigger();
    expect(trigger).not.toBeNull();
    expect(trigger?.getAttribute("aria-label")).toBe("Arrange shape");
  });

  it("the bottommost stands the backward / back picks disabled", () => {
    const doc = seededDoc();
    const { view } = renderCanvas(doc);

    // The bottommost (m0002, zIndex 1): the backward / back picks are
    // disabled, the forward / front picks stand.
    selectBlock(view, "m0002");
    fireEvent.pointerDown(zOrderTrigger()!);
    expect(isDisabled(zOrderItem("Send backward"))).toBe(true);
    expect(isDisabled(zOrderItem("Send to back"))).toBe(true);
    expect(isDisabled(zOrderItem("Bring forward"))).toBe(false);
    expect(isDisabled(zOrderItem("Bring to front"))).toBe(false);
  });

  it("the topmost stands the forward / front picks disabled", () => {
    const doc = seededDoc();
    const { view } = renderCanvas(doc);

    // The topmost (m0004, zIndex 3): the forward / front picks are
    // disabled, the backward / back picks stand.
    selectBlock(view, "m0004");
    fireEvent.pointerDown(zOrderTrigger()!);
    expect(isDisabled(zOrderItem("Bring forward"))).toBe(true);
    expect(isDisabled(zOrderItem("Bring to front"))).toBe(true);
    expect(isDisabled(zOrderItem("Send backward"))).toBe(false);
    expect(isDisabled(zOrderItem("Send to back"))).toBe(false);
  });

  it("the 'bring forward' pick stands the adjacent swap (one undo step)", () => {
    const doc = seededDoc();
    const { view } = renderCanvas(doc);
    expect(doc.getChildren("m0001")).toEqual(["m0002", "m0003", "m0004"]);

    selectBlock(view, "m0003");
    fireEvent.pointerDown(zOrderTrigger()!);
    fireEvent.click(zOrderItem("Bring forward"));

    // The adjacent swap: m0003 over m0004 (the dense indices follow).
    expect(doc.getChildren("m0001")).toEqual(["m0002", "m0004", "m0003"]);
    expect(zIndexOf(doc, "m0003")).toBe(3);
    expect(zIndexOf(doc, "m0004")).toBe(2);
    expect(validateDoc(doc.toJSON())).toEqual([]);
    doc.undo();
    expect(doc.getChildren("m0001")).toEqual(["m0002", "m0003", "m0004"]);
    expect(zIndexOf(doc, "m0003")).toBe(2);
  });

  it("the 'send to back' pick stands the target at the bottom (the dense recalculation)", () => {
    const doc = seededDoc();
    const { view } = renderCanvas(doc);

    selectBlock(view, "m0004");
    fireEvent.pointerDown(zOrderTrigger()!);
    fireEvent.click(zOrderItem("Send to back"));

    expect(doc.getChildren("m0001")).toEqual(["m0004", "m0002", "m0003"]);
    expect(zIndexOf(doc, "m0004")).toBe(1);
    expect(zIndexOf(doc, "m0002")).toBe(2);
    expect(zIndexOf(doc, "m0003")).toBe(3);
    expect(validateDoc(doc.toJSON())).toEqual([]);
  });
});

describe("the connector toolbar's z-order menu", () => {
  it("stands the menu for the single connector selection", () => {
    const doc = connectorDoc();
    const { view } = renderCanvas(doc);
    expect(zOrderTrigger()).toBeNull();

    selectBlock(view, "m0004", true);
    const trigger = zOrderTrigger();
    expect(trigger).not.toBeNull();
    expect(trigger?.getAttribute("aria-label")).toBe("Arrange line");
  });

  it("the 'send to back' pick stands the line under the figures (the paint order)", () => {
    const doc = connectorDoc();
    const { view } = renderCanvas(doc);
    // The new connector stands on top (max + 1): the DOM order's tail.
    expect(doc.getChildren("m0001")).toEqual(["m0002", "m0003", "m0004"]);
    const itemsBefore = Array.from(view.querySelectorAll<HTMLElement>("[data-slot='docblocks/canvas-item']")).map(
      (el) => el.dataset.blockId
    );
    expect(itemsBefore).toEqual(["m0002", "m0003", "m0004"]);

    selectBlock(view, "m0004", true);
    fireEvent.pointerDown(zOrderTrigger()!);
    fireEvent.click(zOrderItem("Send to back"));

    // The line stands under both figures: the DOM order's head (the paint
    // order — the line's svg is the wrapper's content, so the reorder
    // moves the real line, not a placeholder).
    expect(doc.getChildren("m0001")).toEqual(["m0004", "m0002", "m0003"]);
    const itemsAfter = Array.from(view.querySelectorAll<HTMLElement>("[data-slot='docblocks/canvas-item']")).map(
      (el) => el.dataset.blockId
    );
    expect(itemsAfter).toEqual(["m0004", "m0002", "m0003"]);
    const wrapper = view.querySelector<HTMLElement>('[data-slot="docblocks/canvas-item"][data-block-id="m0004"]');
    expect(wrapper?.querySelector('[data-connector-id="m0004"]')).not.toBeNull();
    expect(zIndexOf(doc, "m0004")).toBe(1);
    doc.undo();
    expect(doc.getChildren("m0001")).toEqual(["m0002", "m0003", "m0004"]);
  });
});
