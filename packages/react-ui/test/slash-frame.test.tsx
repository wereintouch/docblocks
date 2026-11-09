// @vitest-environment jsdom
// The slash's Frame command (the pattern's parity over the Database): the
// command stands in the menu over no gate (the frames are the doc's own
// canvas data — the bridge's gate stands none), the pick stands the frame
// picker over the open menu (the search + the document's canvas frames'
// list), the pick's commit (the phrase's strip + the page-frame block's
// weak reference after the caret block, the trailing paragraph at the
// sequence's end, one transact), and the stands (the no-frames' empty,
// the no-match's stand, the Escape's cancel — no write).
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { createDoc } from "docblocks-core";
import type { BlockId } from "docblocks-core";

import { Editor } from "../src/Editor";
import { EditorProvider } from "../src/editor-provider";

const CREATED_AT = "2026-11-06T00:00:00.000Z";

type TestDoc = ReturnType<typeof createDoc>;

interface Scene {
  doc: TestDoc;
  para: BlockId;
  surface: string;
  frameA: string;
  frameB: string;
}

/** The slash's scene: the page's paragraph (the slash's trigger) + the
 *  canvas's frames (the picker's list: the titled's stand + the default's). */
function renderSlashScene(withCanvas: boolean): Scene {
  const doc = createDoc({ id: "slash-frame-doc", createdAt: CREATED_AT });
  let surface = "";
  let frameA = "";
  let frameB = "";
  if (withCanvas) {
    surface = doc.insertBlock("surface");
    frameA = doc.insertBlock("frame", { title: "Alpha" }, { parent: surface });
    doc.setGeometry(frameA, { x: 0, y: 0, w: 300, h: 200 });
    frameB = doc.insertBlock("frame", undefined, { parent: surface });
    doc.setGeometry(frameB, { x: 400, y: 0, w: 300, h: 200 });
  }
  const para = doc.insertBlock("paragraph");
  render(
    <EditorProvider doc={doc}>
      <Editor />
    </EditorProvider>
  );
  return { doc, para, surface, frameA, frameB };
}

/**
 * Seat a collapsed caret at the paragraph's start and press "/"; true =
 * the key's default was prevented (the editor commits the character — the
 * menu's open's stand).
 */
function pressSlash(para: BlockId): boolean {
  const wrapper = document.querySelector<HTMLElement>(`[data-block-id="${para}"]`);
  expect(wrapper, "the trigger should be rendered").not.toBeNull();
  const inner = wrapper!.querySelector<HTMLElement>('[data-slot="docblocks/block-content"]');
  expect(inner, "the trigger should carry the inner editable").not.toBeNull();
  const range = document.createRange();
  range.setStart(inner!, 0);
  range.collapse(true);
  const selection = window.getSelection()!;
  selection.removeAllRanges();
  selection.addRange(range);
  let prevented = false;
  act(() => {
    prevented = !wrapper!.dispatchEvent(new KeyboardEvent("keydown", { key: "/", bubbles: true, cancelable: true }));
  });
  return prevented;
}

/** The slash menu's `Frame` item (the command's stand over the open menu). */
function frameMenuItem(): HTMLElement {
  const items = Array.from(document.querySelectorAll<HTMLElement>('[data-slot="docblocks/slash-item"]'));
  const frame = items.find((el) => el.textContent?.trim() === "Frame");
  expect(frame, "the Frame's command should stand in the menu's list").toBeDefined();
  return frame!;
}

afterEach(() => {
  cleanup();
  window.getSelection()?.removeAllRanges();
});

describe("the command's stand (no gate — the frames are the doc's own data)", () => {
  it("stands the Frame's command in the menu's list over the open menu (no bridge required)", () => {
    const { para } = renderSlashScene(false); // no canvas, no bridge — the gate stands none
    expect(pressSlash(para)).toBe(true);
    expect(docSlashOpen()).not.toBeNull();
    expect(frameMenuItem()).toBeDefined();
  });
});

describe("the picker's stands (the search + the list + the empties)", () => {
  function openPicker(withCanvas = true): Scene {
    const scene = renderSlashScene(withCanvas);
    expect(pressSlash(scene.para)).toBe(true);
    fireEvent.click(frameMenuItem());
    expect(
      document.querySelector('[data-slot="docblocks/slash-frame-picker"]'),
      "the picker should stand"
    ).not.toBeNull();
    return scene;
  }

  it("stands the search's stand (the auto-focus's contract, the label's + the placeholder's)", () => {
    openPicker();
    const search = document.querySelector<HTMLInputElement>('[data-slot="docblocks/slash-frame-search"]')!;
    expect(search.getAttribute("aria-label")).toBe("Search frames");
    expect(search.placeholder).toBe("Search frames...");
  });

  it("stands the frames' list over the document's order (the title's stand + the default's name)", () => {
    const { frameA, frameB } = openPicker();
    const options = Array.from(document.querySelectorAll<HTMLElement>('[data-slot="docblocks/slash-frame-option"]'));
    expect(options.map((option) => option.getAttribute("data-frame-id"))).toEqual([frameA, frameB]);
    expect(options.map((option) => option.textContent?.trim())).toEqual(["Alpha", "Frame"]);
  });

  it("filters the list case-insensitively by the name", () => {
    const { frameA } = openPicker();
    const search = document.querySelector<HTMLInputElement>('[data-slot="docblocks/slash-frame-search"]')!;
    fireEvent.change(search, { target: { value: "ALP" } });
    const options = Array.from(document.querySelectorAll<HTMLElement>('[data-slot="docblocks/slash-frame-option"]'));
    expect(options).toHaveLength(1);
    expect(options[0]!.getAttribute("data-frame-id")).toBe(frameA);
    // The no-match's stand (the query stands over the frames' names).
    fireEvent.change(search, { target: { value: "zz" } });
    expect(document.querySelector('[data-slot="docblocks/slash-frame-empty"]')!.textContent).toBe("No frames match");
  });

  it("stands the no-frames' empty (the doc has no canvas frame)", () => {
    openPicker(false);
    expect(document.querySelector('[data-slot="docblocks/slash-frame-empty"]')!.textContent).toBe(
      "No frames on the canvas yet"
    );
  });

  it("the Escape over the search cancels (no write — the command list stands on the phrase)", () => {
    const { doc, para } = openPicker();
    const search = document.querySelector<HTMLInputElement>('[data-slot="docblocks/slash-frame-search"]')!;
    fireEvent.keyDown(search, { key: "Escape" });
    // The cancel: the picker stands off, the menu stands (the phrase's
    // intact), nothing was written.
    expect(document.querySelector('[data-slot="docblocks/slash-frame-picker"]')).toBeNull();
    expect(document.querySelector('[data-slot="docblocks/slash-menu"]')).not.toBeNull();
    expect(doc.getText(para)).toBe("/");
  });
});

describe("the pick's commit (one transact — the weak reference + the phrase's strip)", () => {
  it("inserts the frame's block after the caret block (the phrase's strip; the caret block stands)", () => {
    const { doc, para, surface, frameA } = renderSlashScene(true);
    // A follower's paragraph (the caret block does not take the sequence's
    // end — the trailing's stand stands none).
    const next = doc.insertBlock("paragraph");
    doc.insertText(next, 0, "next");
    expect(pressSlash(para)).toBe(true);
    fireEvent.click(frameMenuItem());
    const option = document.querySelector<HTMLElement>(
      `[data-slot="docblocks/slash-frame-option"][data-frame-id="${frameA}"]`
    )!;
    fireEvent.click(option);
    // The commit's stand: the phrase's strip + the frame's block after the
    // caret block (the frameId's weak reference) — the menu closed, the
    // follower stands (no trailing's paragraph: the sequence's end is a
    // text block). The raw sequence stands the surface (the canvas layer's
    // stand — the page view's filter is the render's, not the doc's).
    expect(doc.getText(para)).toBe("");
    const sequence = doc.getChildren(doc.meta.id);
    expect(sequence).toHaveLength(4);
    expect(sequence[0]).toBe(surface);
    expect(sequence[1]).toBe(para);
    expect(sequence[3]).toBe(next);
    const frameBlock = doc.getBlock(sequence[2]!);
    expect(frameBlock?.type).toBe("frame");
    expect(frameBlock?.type === "frame" && frameBlock.attrs?.frameId).toBe(frameA);
    expect(document.querySelector('[data-slot="docblocks/slash-menu"]')).toBeNull();
  });

  it("stands the trailing paragraph at the sequence's end (the caret's re-seat's stand)", () => {
    const { doc, para, frameA } = renderSlashScene(true);
    expect(pressSlash(para)).toBe(true);
    fireEvent.click(frameMenuItem());
    const option = document.querySelector<HTMLElement>(
      `[data-slot="docblocks/slash-frame-option"][data-frame-id="${frameA}"]`
    )!;
    fireEvent.click(option);
    // The caret block took the sequence's end: the frame lands after it,
    // the trailing's empty paragraph stands after the frame (the caret's
    // home — the non-text's frame stands no caret).
    expect(doc.getText(para)).toBe("");
    const sequence = doc.getChildren(doc.meta.id);
    expect(sequence).toHaveLength(4);
    expect(sequence[1]).toBe(para);
    expect(doc.getBlock(sequence[2]!)?.type).toBe("frame");
    expect(doc.getBlock(sequence[3]!)?.type).toBe("paragraph");
    // The trailing's paragraph's empty (the caret's home's stand).
    expect(doc.getText(sequence[3]!)).toBe("");
  });
});

/** The open slash menu's stand (the missing's null). */
function docSlashOpen(): HTMLElement | null {
  return document.querySelector('[data-slot="docblocks/slash-menu"]');
}
