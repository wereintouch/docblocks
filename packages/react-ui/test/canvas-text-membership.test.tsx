// @vitest-environment jsdom
// The canvas-text's container's membership (the shape's parity — the
// drag-in / the drag-out's release's stand).
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createDoc, validateDoc } from "docblocks-core";

import { Editor } from "../src/Editor";
import { EditorProvider } from "../src/editor-provider";
import { dragTo, pressPointOf } from "./canvas-press";
import { CREATED_AT } from "./canvas-text.helpers";
import type { TestDoc } from "./canvas-text.helpers";

beforeEach(() => window.localStorage.clear());
afterEach(() => {
  cleanup();
  window.getSelection()?.removeAllRanges();
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
    const p = pressPointOf(r.doc, r.text);
    fireEvent.pointerDown(r.view, { button: 0, clientX: p.x, clientY: p.y, pointerId: 1 });
    dragTo(r.view, { x: p.x + 220, y: p.y + 60 }, 1);

    // The drop indicator stands the join (the "in" stand over the
    // canvas-text's live box — the shape's parity).
    const indicator = document.querySelector<HTMLElement>(
      '[data-slot="docblocks/canvas-drop-indicator"][data-drop="in"]'
    );
    expect(indicator).not.toBeNull();

    fireEvent.pointerUp(r.view, { pointerId: 1 });

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
    const p = pressPointOf(r.doc, r.text);
    fireEvent.pointerDown(r.view, { button: 0, clientX: p.x, clientY: p.y, pointerId: 1 });
    dragTo(r.view, { x: p.x - 160, y: p.y }, 1);
    const indicator = document.querySelector<HTMLElement>(
      '[data-slot="docblocks/canvas-drop-indicator"][data-drop="out"]'
    );
    expect(indicator).not.toBeNull();
    fireEvent.pointerUp(r.view, { pointerId: 1 });

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
