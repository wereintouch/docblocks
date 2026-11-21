// @vitest-environment jsdom
// The canvas-text's editing session: the empty block's removal (the
// Escape / the caret's loss; the non-empty's stand), the Enter's soft
// break (no split), and the keys' editing surface's guard (the letters
// stand no hotkey over the text).
import { act, cleanup, fireEvent } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { validateDoc } from "docblocks-core";

import { pressBlock } from "./canvas-press";
import { canvasTextChildren, caretAtFlat, renderCanvas, textOf } from "./canvas-text.helpers";

beforeEach(() => window.localStorage.clear());
afterEach(() => {
  cleanup();
  window.getSelection()?.removeAllRanges();
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
    pressBlock(r.view, r.doc, r.text);
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
