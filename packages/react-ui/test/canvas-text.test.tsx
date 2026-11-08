// @vitest-environment jsdom
// The canvas-text's contracts: the ghost text block (the double-click's
// empty-canvas entry — the focused ghost stands nothing until the first
// input's single-transact commit; the Escape / the blur's cancel), the
// press contract (the shape's parity — the single press selects + the
// move session, the double-click the caret), the empty block's removal
// (the Escape / the caret's loss over the empty block; the non-empty
// stands), the Enter's soft break (no split — the surface's children
// stand), the selection's outline stand, and the font attrs' render (the
// family's stack, the color, the weight x the slant).
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createDoc, validateDoc } from "docblocks-core";

import { Editor } from "../src/Editor";
import { TOOL_SIZES } from "../src/canvas/viewport";
import { EditorProvider } from "../src/editor-provider";

const CREATED_AT = "2026-10-10T00:00:00.000Z";

type TestDoc = ReturnType<typeof createDoc>;

interface Rendered {
  doc: TestDoc;
  view: HTMLElement;
  surface: string;
  text: string;
  item: () => HTMLElement;
  inner: () => HTMLElement;
}

function seedCanvasText(doc: TestDoc, text?: string): { surface: string; text: string } {
  const surface = doc.insertBlock("surface");
  const id = doc.insertBlock("canvas-text", undefined, { parent: surface });
  if (text !== undefined) doc.insertText(id, 0, text);
  doc.setGeometry(id, { x: 0, y: 0, w: 100, h: 40 });
  return { surface, text: id };
}

function renderCanvas(seedText?: string): Rendered {
  const doc = createDoc({ id: "canvas-text-doc", createdAt: CREATED_AT });
  const { surface, text } = seedCanvasText(doc, seedText);
  const { container } = render(
    <EditorProvider doc={doc}>
      <Editor view="canvas" />
    </EditorProvider>
  );
  const view = container.querySelector<HTMLElement>('[data-slot="docblocks/canvas-view"]');
  if (view === null) throw new Error("the canvas view is missing");
  return {
    doc,
    view,
    surface,
    text,
    item: () => {
      const el = view.querySelector<HTMLElement>(`[data-slot="docblocks/canvas-item"][data-block-id="${text}"]`);
      if (el === null) throw new Error("the canvas-text item is missing");
      return el;
    },
    inner: () => {
      const el = view.querySelector<HTMLElement>(`[data-slot="docblocks/block-content"][data-block-id="${text}"]`);
      if (el === null) throw new Error("the canvas-text's inner is missing");
      return el;
    },
  };
}

/** The block's text (the single run's content). */
function textOf(doc: TestDoc, id: string): string {
  const block = doc.getBlock(id);
  if (block === null || block.type !== "canvas-text") return "";
  return (block.content ?? []).map((run) => run.text).join("");
}

/** Place the DOM caret at the flat offset in the inner. */
function caretAtFlat(inner: HTMLElement, offset: number): void {
  const nodes: { node: Text; start: number; end: number }[] = [];
  let pos = 0;
  for (const child of Array.from(inner.childNodes)) {
    if (child.nodeType === Node.TEXT_NODE) {
      const length = child.nodeValue?.length ?? 0;
      nodes.push({ node: child as Text, start: pos, end: pos + length });
      pos += length;
    }
  }
  const at = nodes.find((n) => offset >= n.start && offset <= n.end);
  if (at === undefined) throw new Error(`no text node covers offset ${offset}`);
  const range = document.createRange();
  range.setStart(at.node, offset - at.start);
  range.collapse(true);
  const selection = window.getSelection();
  if (selection === null) throw new Error("the selection is missing");
  selection.removeAllRanges();
  selection.addRange(range);
}

/** The surface's canvas-text children (the split's negative stand). */
function canvasTextChildren(doc: TestDoc, surface: string): string[] {
  return doc.getChildren(surface).filter((id) => doc.getBlock(id)?.type === "canvas-text");
}

beforeEach(() => window.localStorage.clear());
afterEach(() => {
  cleanup();
  window.getSelection()?.removeAllRanges();
});

describe("the ghost text block (the double-click's empty-canvas entry)", () => {
  it("stands the focused ghost on the empty canvas's dblclick (nothing is written)", () => {
    const r = renderCanvas("seed");
    const before = r.doc.toJSON();

    // The dblclick over the empty canvas (the view's own surface — no
    // item under the point): the ghost stands at the point with the
    // caret. jsdom's elementFromPoint stands null — the event's target
    // (the view) is the point's stand.
    fireEvent.doubleClick(r.view, { clientX: 100, clientY: 80 });

    const ghost = document.querySelector<HTMLElement>('[data-slot="docblocks/canvas-text-ghost"]');
    expect(ghost).not.toBeNull();
    const ghostInner = document.querySelector<HTMLElement>('[data-slot="docblocks/canvas-text-ghost-inner"]');
    expect(ghostInner).not.toBeNull();
    expect(ghostInner!.getAttribute("contenteditable")).toBe("true");
    // The caret stands at the ghost's start (the autofocus).
    expect(document.activeElement).toBe(ghostInner);
    // Nothing is written until the first input (the ghost is view state).
    expect(r.doc.toJSON()).toEqual(before);
    expect(validateDoc(r.doc.toJSON())).toEqual([]);
  });

  it("commits the first input in one transact (the insert + geometry + the text; the caret reseats)", async () => {
    const r = renderCanvas("seed");

    fireEvent.doubleClick(r.view, { clientX: 100, clientY: 80 });
    const ghostInner = document.querySelector<HTMLElement>('[data-slot="docblocks/canvas-text-ghost-inner"]');
    if (ghostInner === null) throw new Error("the ghost is missing");

    act(() => {
      ghostInner.textContent = "Hello canvas";
      fireEvent.input(ghostInner);
    });

    // The ghost closes and the real block stands (the surface's child).
    expect(document.querySelector('[data-slot="docblocks/canvas-text-ghost"]')).toBeNull();
    const children = canvasTextChildren(r.doc, r.surface);
    expect(children.length).toBe(2); // the seed + the committed
    const committed = children.find((id) => id !== r.text);
    if (committed === undefined) throw new Error("the committed block is missing");
    expect(textOf(r.doc, committed)).toBe("Hello canvas");
    // The geometry: the default box's center over the top-left's point
    // (TOOL_SIZES.text's 200x40 — the point's (100, 80) stand the
    // top-left, the center's (200, 100)).
    const block = r.doc.getBlock(committed);
    if (block === null || block.type !== "canvas-text") throw new Error("the committed block is malformed");
    expect(block.geometry).toEqual({
      x: 100 + TOOL_SIZES.text.w / 2,
      y: 80 + TOOL_SIZES.text.h / 2,
      w: TOOL_SIZES.text.w,
      h: TOOL_SIZES.text.h,
    });
    // The caret reseats into the real block's inner (the frame flush —
    // the focusCaretIn's after-frame stand).
    const committedInner = r.view.querySelector<HTMLElement>(
      `[data-slot="docblocks/block-content"][data-block-id="${committed}"]`
    );
    expect(committedInner).not.toBeNull();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(document.activeElement).toBe(committedInner);
    // One undo step: the whole commit is a single transact (the caret's
    // reseat is the DOM-only stand — the doc stands the block).
    r.doc.undo();
    expect(r.doc.getBlock(committed)).toBeNull();
    expect(validateDoc(r.doc.toJSON())).toEqual([]);
  });

  it("the Escape cancels the ghost (nothing is written)", () => {
    const r = renderCanvas("seed");
    const before = r.doc.toJSON();

    fireEvent.doubleClick(r.view, { clientX: 100, clientY: 80 });
    const ghostInner = document.querySelector<HTMLElement>('[data-slot="docblocks/canvas-text-ghost-inner"]');
    if (ghostInner === null) throw new Error("the ghost is missing");

    fireEvent.keyDown(ghostInner, { key: "Escape" });

    expect(document.querySelector('[data-slot="docblocks/canvas-text-ghost"]')).toBeNull();
    expect(r.doc.toJSON()).toEqual(before);
    expect(canvasTextChildren(r.doc, r.surface).length).toBe(1); // the seed stands
  });

  it("the blur without input cancels the ghost (nothing is written)", () => {
    const r = renderCanvas("seed");
    const before = r.doc.toJSON();

    fireEvent.doubleClick(r.view, { clientX: 100, clientY: 80 });
    const ghostInner = document.querySelector<HTMLElement>('[data-slot="docblocks/canvas-text-ghost-inner"]');
    if (ghostInner === null) throw new Error("the ghost is missing");

    fireEvent.blur(ghostInner);

    expect(document.querySelector('[data-slot="docblocks/canvas-text-ghost"]')).toBeNull();
    expect(r.doc.toJSON()).toEqual(before);
  });
});

describe("the press contract (the shape's parity — the single press selects + moves, the dblclick's caret)", () => {
  it("the first press selects the block (the outline stands; the doc stands)", () => {
    const r = renderCanvas("seed");
    const before = r.doc.toJSON();

    fireEvent.pointerDown(r.inner(), { clientX: 10, clientY: 10, button: 0, buttons: 1, pointerId: 1 });
    fireEvent.pointerUp(r.view, { clientX: 10, clientY: 10, pointerId: 1 });

    expect(r.item().hasAttribute("data-selected")).toBe(true);
    expect(r.doc.toJSON()).toEqual(before);
  });

  it("the first press's drag moves the block (one transact, one undo)", () => {
    const r = renderCanvas("seed");
    const before = r.doc.toJSON();
    const geometryBefore = before.blocks[r.text]?.geometry;

    fireEvent.pointerDown(r.inner(), { clientX: 10, clientY: 10, button: 0, buttons: 1, pointerId: 1 });
    fireEvent.pointerMove(r.view, { clientX: 60, clientY: 40, buttons: 1, pointerId: 1 });
    fireEvent.pointerUp(r.view, { clientX: 60, clientY: 40, pointerId: 1 });

    // The geometry lands at the screen delta (zoom 1, pan 0): the +50/+30.
    expect(r.doc.getBlock(r.text)?.geometry).toEqual({
      x: (geometryBefore?.x ?? 0) + 50,
      y: (geometryBefore?.y ?? 0) + 30,
      w: 100,
      h: 40,
    });
    r.doc.undo();
    expect(r.doc.getBlock(r.text)?.geometry).toEqual(geometryBefore);
    expect(validateDoc(r.doc.toJSON())).toEqual([]);
  });

  it("the second press (the block already selected) starts the move session (the drag's parity)", () => {
    const r = renderCanvas("seed");
    const geometryBefore = r.doc.getBlock(r.text)?.geometry;

    // The first press selects the block.
    fireEvent.pointerDown(r.inner(), { clientX: 10, clientY: 10, button: 0, buttons: 1, pointerId: 1 });
    fireEvent.pointerUp(r.view, { clientX: 10, clientY: 10, pointerId: 1 });
    expect(r.item().hasAttribute("data-selected")).toBe(true);

    // The second press: the same press's stand (the block's selection +
    // the move session — the shape's parity, the drag moves it).
    fireEvent.pointerDown(r.inner(), { clientX: 10, clientY: 10, button: 0, buttons: 1, pointerId: 2 });
    fireEvent.pointerMove(r.view, { clientX: 70, clientY: 50, buttons: 1, pointerId: 2 });
    fireEvent.pointerUp(r.view, { clientX: 70, clientY: 50, pointerId: 2 });

    expect(r.doc.getBlock(r.text)?.geometry).toEqual({
      x: (geometryBefore?.x ?? 0) + 60,
      y: (geometryBefore?.y ?? 0) + 40,
      w: geometryBefore?.w,
      h: geometryBefore?.h,
    });
  });

  it("the shift press toggles the block's selection (the item's parity)", () => {
    const r = renderCanvas("seed");

    // The shift press selects the block.
    fireEvent.pointerDown(r.inner(), { clientX: 10, clientY: 10, button: 0, buttons: 1, pointerId: 1, shiftKey: true });
    fireEvent.pointerUp(r.view, { clientX: 10, clientY: 10, pointerId: 1 });
    expect(r.item().hasAttribute("data-selected")).toBe(true);

    // The shift press over the selected block deselects it.
    fireEvent.pointerDown(r.inner(), { clientX: 10, clientY: 10, button: 0, buttons: 1, pointerId: 2, shiftKey: true });
    fireEvent.pointerUp(r.view, { clientX: 10, clientY: 10, pointerId: 2 });
    expect(r.item().hasAttribute("data-selected")).toBe(false);
  });
});

describe("the empty block's removal (the Escape / the caret's loss; the non-empty's stand)", () => {
  it("the Escape over the empty block removes it (no orphan)", async () => {
    const r = renderCanvas();
    // The edit session's open (the double-click's entry — the inner's
    // editable's stand over the inert's rest): the key stands on the
    // inner (the focused element — the block's own wrapper's handler
    // owns it, the canvas's keys stand off over the inner). jsdom's
    // elementFromPoint stands null — the event's target (the inner) is
    // the point's stand.
    fireEvent.doubleClick(r.inner(), { clientX: 10, clientY: 10 });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    r.inner().focus();

    let suppressed = true;
    act(() => {
      suppressed = r
        .inner()
        .dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    });
    // dispatchEvent stands false over the suppressed default
    // (the canvas's keys stand off over the inner).
    expect(suppressed).toBe(false);

    expect(r.doc.getBlock(r.text)).toBeNull();
    expect(canvasTextChildren(r.doc, r.surface).length).toBe(0);
    expect(validateDoc(r.doc.toJSON())).toEqual([]);
    // The removal stands a single undo step.
    r.doc.undo();
    expect(r.doc.getBlock(r.text)).not.toBeNull();
  });

  it("the caret's loss over the empty block removes it (no orphan; the non-empty stands)", () => {
    const r = renderCanvas();
    // The empty block's inner holds the caret; a press on the canvas
    // container blurs it (the press's focus move).
    r.inner().focus();
    fireEvent.blur(r.inner());

    expect(r.doc.getBlock(r.text)).toBeNull();
    expect(canvasTextChildren(r.doc, r.surface).length).toBe(0);
    expect(validateDoc(r.doc.toJSON())).toEqual([]);
    r.doc.undo();
    expect(r.doc.getBlock(r.text)).not.toBeNull();
  });

  it("the caret's loss over the non-empty block stands (the block keeps its box)", () => {
    const r = renderCanvas("seed");
    const before = r.doc.toJSON();
    r.inner().focus();
    fireEvent.blur(r.inner());

    expect(r.doc.toJSON()).toEqual(before);
    expect(textOf(r.doc, r.text)).toBe("seed");
  });

  it("the Escape over the non-empty block stands (the block stands)", () => {
    const r = renderCanvas("seed");
    r.inner().focus();
    caretAtFlat(r.inner(), 1);

    act(() => {
      r.inner().dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    });

    // The block stands (the non-empty's Escape is not the removal).
    expect(r.doc.getBlock(r.text)).not.toBeNull();
    expect(textOf(r.doc, r.text)).toBe("seed");
    expect(validateDoc(r.doc.toJSON())).toEqual([]);
  });

  it("the blocks-selection's Escape over the non-empty block clears the selection (the stand)", () => {
    const r = renderCanvas("seed");
    // The first press selects the block (the blocks selection).
    fireEvent.pointerDown(r.item(), { clientX: 10, clientY: 10, button: 0, buttons: 1, pointerId: 1 });
    fireEvent.pointerUp(r.view, { clientX: 10, clientY: 10, pointerId: 1 });
    expect(r.item().hasAttribute("data-selected")).toBe(true);

    act(() => {
      r.inner().dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    });

    // The selection clears, the block stands (the page-text's stand — the
    // the empty removal is the empty stand only).
    expect(r.doc.getBlock(r.text)).not.toBeNull();
    expect(r.item().hasAttribute("data-selected")).toBe(false);
  });
});

describe("the Enter's soft break (no split)", () => {
  it("Enter inserts a soft break at the caret (the surface's children stand)", async () => {
    const r = renderCanvas("ab");
    const before = canvasTextChildren(r.doc, r.surface);

    // The edit session's open (the double-click's entry — the inner's
    // editable's stand over the inert's rest): the caret's seat over the
    // settled render, then the caret's re-seat at offset 1.
    fireEvent.doubleClick(r.inner(), { clientX: 10, clientY: 10 });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    caretAtFlat(r.inner(), 1);
    act(() => {
      r.inner().dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    });

    // The soft break stands in the single block (a\nb); no split (the
    // surface's children stand — a new block in the surface is a BUG).
    expect(textOf(r.doc, r.text)).toBe("a\nb");
    expect(canvasTextChildren(r.doc, r.surface)).toEqual(before);
    expect(validateDoc(r.doc.toJSON())).toEqual([]);
  });
});

describe("the keys' editing surface's guard (the letters stand no hotkey over the text)", () => {
  it("the m over the edit stands the character (the mode switch stands off; the focus and the doc stand)", async () => {
    const r = renderCanvas("seed");
    // The edit session's open (the double-click's entry — the inner's
    // editable's stand): the key stands on the inner (the focused element
    // — the letter's default must stand over the canvas's keys).
    fireEvent.doubleClick(r.inner(), { clientX: 10, clientY: 10 });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    r.inner().focus();
    expect(r.inner().getAttribute("contenteditable")).toBe("true");

    let stopped = false;
    act(() => {
      stopped = r.inner().dispatchEvent(new KeyboardEvent("keydown", { key: "m", bubbles: true, cancelable: true }));
    });

    // The canvas's keys stand off over the edit surface: the letter's
    // default stands (not suppressed — the character lands over the text),
    // the focus stays on the inner (no blur), the doc stands.
    expect(stopped).toBe(true);
    expect(document.activeElement).toBe(r.inner());
    expect(textOf(r.doc, r.text)).toBe("seed");
  });

  it("the M over the container's own focus stands the select mode (the dock's hand's stand)", () => {
    const r = renderCanvas("seed");
    // The hand's toggle (the pan mode's stand — the M's switch-back's
    // target).
    const hand = r.view.querySelector<HTMLElement>('[aria-label="Switch to the pan mode"]');
    expect(hand).not.toBeNull();
    fireEvent.click(hand!);
    expect(r.view.querySelector<HTMLElement>('[aria-label="Switch to the select mode"]')).not.toBeNull();

    // The container's own focus (the hotkey's context — the view's own
    // control, not the edit surface) + the M: the mode re-stands the
    // select.
    r.view.focus();
    act(() => {
      r.view.dispatchEvent(new KeyboardEvent("keydown", { key: "m", bubbles: true, cancelable: true }));
    });
    expect(r.view.querySelector<HTMLElement>('[aria-label="Switch to the pan mode"]')).not.toBeNull();
  });
});

describe("the box's text centering (the selection's frame's parity)", () => {
  it("the canvas-text stands the box's vertical center (the wrapper's flex stand)", () => {
    const r = renderCanvas("seed");
    const wrapper = r.item().querySelector<HTMLElement>('[data-slot="docblocks/block"]');
    expect(wrapper).not.toBeNull();
    // The wrapper fills the item's box and centers the inner vertically
    // (the shape-text's parity — the selection's frame is the box).
    expect(wrapper!.className).toContain("justify-center");
    expect(wrapper!.className).toContain("flex-col");
    expect(wrapper!.className).toContain("h-full");
  });

  it("the ghost's inner stands the same vertical center (the caret's parity over the commit)", async () => {
    const r = renderCanvas("seed");
    fireEvent.doubleClick(r.view, { clientX: 100, clientY: 80 });
    const ghost = document.querySelector<HTMLElement>("[data-slot='docblocks/canvas-text-ghost-inner']");
    expect(ghost).not.toBeNull();
    expect(ghost!.className).toContain("items-center");
  });
});

describe("the container's membership (the shape's parity)", () => {
  /** The scene: a group (the container) + a canvas-text outside its box. */
  function renderMembership(): {
    doc: TestDoc;
    view: HTMLElement;
    text: string;
    group: string;
    inner: () => HTMLElement;
  } {
    const doc = createDoc({ id: "membership-doc", createdAt: CREATED_AT });
    const surface = doc.insertBlock("surface");
    const group = doc.insertBlock("group", { members: [] }, { parent: surface });
    doc.setGeometry(group, { x: 150, y: 100, w: 300, h: 200 }); // [0..300, 0..200]
    const text = doc.insertBlock("canvas-text", undefined, { parent: surface });
    doc.insertText(text, 0, "member");
    doc.setGeometry(text, { x: -50, y: 50, w: 100, h: 40 }); // [-100..0, 30..70] — outside
    const { container } = render(
      <EditorProvider doc={doc}>
        <Editor view="canvas" />
      </EditorProvider>
    );
    const view = container.querySelector<HTMLElement>('[data-slot="docblocks/canvas-view"]');
    if (view === null) throw new Error("the canvas view is missing");
    return {
      doc,
      view,
      text,
      group,
      inner: () => {
        const el = view.querySelector<HTMLElement>(`[data-slot="docblocks/block-content"][data-block-id="${text}"]`);
        if (el === null) throw new Error("the canvas-text's inner is missing");
        return el;
      },
    };
  }

  it("the drag-in's release joins the container (the indicator stands; one transact)", () => {
    const r = renderMembership();

    // The press (the two-click's first press's select + session) + the
    // drag over the container's box.
    fireEvent.pointerDown(r.inner(), { clientX: 10, clientY: 10, button: 0, buttons: 1, pointerId: 1 });
    fireEvent.pointerMove(r.view, { clientX: 230, clientY: 70, buttons: 1, pointerId: 1 });

    // The drop indicator stands the join (the "in" stand over the
    // canvas-text's live box — the shape's parity).
    const indicator = document.querySelector<HTMLElement>(
      '[data-slot="docblocks/canvas-drop-indicator"][data-drop="in"]'
    );
    expect(indicator).not.toBeNull();

    fireEvent.pointerUp(r.view, { clientX: 230, clientY: 70, pointerId: 1 });

    // The release's commit: the geometry's delta + the membership's join
    // (the group's members gain the canvas-text).
    const textAfter = r.doc.getBlock(r.text);
    if (textAfter === null || textAfter.type !== "canvas-text") throw new Error("the canvas-text is missing");
    expect(textAfter.geometry).toEqual({ x: 170, y: 110, w: 100, h: 40 });
    const groupAfter = r.doc.getBlock(r.group);
    if (groupAfter === null || groupAfter.type !== "group") throw new Error("the group is missing");
    expect(groupAfter.attrs.members).toEqual([r.text]);
    // The indicator drops (the session's end).
    expect(document.querySelector('[data-slot="docblocks/canvas-drop-indicator"]')).toBeNull();
    // One undo step: the move + the membership's one transact.
    r.doc.undo();
    expect(r.doc.getBlock(r.text)?.geometry).toEqual({ x: -50, y: 50, w: 100, h: 40 });
    const groupBefore = r.doc.getBlock(r.group);
    if (groupBefore === null || groupBefore.type !== "group") throw new Error("the group is missing");
    expect(groupBefore.attrs.members).toEqual([]);
    expect(validateDoc(r.doc.toJSON())).toEqual([]);
  });

  it("the drag-out's release leaves the container (the member stands removed)", () => {
    const r = renderMembership();
    // Seed the membership (the text starts inside the container's box).
    r.doc.updateBlock(r.group, { members: [r.text] });
    r.doc.setGeometry(r.text, { x: 170, y: 110, w: 100, h: 40 });

    // The drag out (the box's delta over the container's edge).
    fireEvent.pointerDown(r.inner(), { clientX: 10, clientY: 10, button: 0, buttons: 1, pointerId: 1 });
    fireEvent.pointerMove(r.view, { clientX: -150, clientY: 10, buttons: 1, pointerId: 1 });
    const indicator = document.querySelector<HTMLElement>(
      '[data-slot="docblocks/canvas-drop-indicator"][data-drop="out"]'
    );
    expect(indicator).not.toBeNull();
    fireEvent.pointerUp(r.view, { clientX: -150, clientY: 10, pointerId: 1 });

    // The release's commit: the geometry's delta + the membership's leave
    // (the box's left edge over the container's left edge — the not-
    // contained's stand).
    const textAfter = r.doc.getBlock(r.text);
    if (textAfter === null || textAfter.type !== "canvas-text") throw new Error("the canvas-text is missing");
    expect(textAfter.geometry).toEqual({ x: 10, y: 110, w: 100, h: 40 }); // the -160/+0 delta
    const groupAfter = r.doc.getBlock(r.group);
    if (groupAfter === null || groupAfter.type !== "group") throw new Error("the group is missing");
    expect(groupAfter.attrs.members).toEqual([]);
    expect(validateDoc(r.doc.toJSON())).toEqual([]);
  });
});

describe("the selection's outline stand", () => {
  it("the selected canvas-text stands the shared selection outline (the shape's parity)", () => {
    const r = renderCanvas("seed");
    expect(r.item().hasAttribute("data-selected")).toBe(false);
    expect(r.item().className).not.toContain("outline-(--docblocks-canvas-selection-border-color)");

    fireEvent.pointerDown(r.inner(), { clientX: 10, clientY: 10, button: 0, buttons: 1, pointerId: 1 });
    fireEvent.pointerUp(r.view, { clientX: 10, clientY: 10, pointerId: 1 });

    expect(r.item().hasAttribute("data-selected")).toBe(true);
    expect(r.item().className).toContain("outline-(--docblocks-canvas-selection-border-color)");
  });
});

describe("the font attrs' render (the shape text's parity)", () => {
  function renderFontAttrs(attrs: Record<string, unknown>): HTMLElement {
    const doc = createDoc({ id: "font-doc", createdAt: CREATED_AT });
    const surface = doc.insertBlock("surface");
    const id = doc.insertBlock("canvas-text", attrs, { parent: surface });
    doc.insertText(id, 0, "x");
    doc.setGeometry(id, { x: 0, y: 0, w: 100, h: 40 });
    const { container } = render(
      <EditorProvider doc={doc}>
        <Editor view="canvas" />
      </EditorProvider>
    );
    const item = container.querySelector<HTMLElement>(`[data-slot="docblocks/canvas-item"][data-block-id="${id}"]`);
    if (item === null) throw new Error("the canvas-text item is missing");
    return item;
  }

  it("stands the family's stack, the color, and the weight x the slant", () => {
    const item = renderFontAttrs({
      fontSize: 24,
      fontFamily: "Lora",
      textColor: "#e11d48",
      textStyle: "semibold-italic",
      textAlign: "right",
    });
    expect(item.style.fontSize).toBe("24px");
    // The CSSOM's serialization quotes the family's names (jsdom's
    // stand — the browser's computed stand is the same stack).
    expect(item.style.fontFamily).toBe('"Lora", Georgia, "Times New Roman", serif');
    expect(item.style.color).toBe("rgb(225, 29, 72)"); // #e11d48's CSSOM stand
    expect(item.style.fontWeight).toBe("600");
    expect(item.style.fontStyle).toBe("italic");
    expect(item.style.textAlign).toBe("right");
  });

  it("the unrecognized family stands the raw name (the consumer's font by name)", () => {
    const item = renderFontAttrs({ fontFamily: "My Custom Font" });
    expect(item.style.fontFamily).toBe('"My Custom Font"');
  });

  it("the light stand the 300 weight; the absent stand the regular 400", () => {
    const light = renderFontAttrs({ textStyle: "light" });
    expect(light.style.fontWeight).toBe("300");
    expect(light.style.fontStyle).toBe("");
    const regular = renderFontAttrs({});
    expect(regular.style.fontWeight).toBe("400");
    expect(regular.style.fontStyle).toBe("");
  });
});
