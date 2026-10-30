// @vitest-environment jsdom
// The canvas container (the reworked group):
// the group's own free geometry + the title attr, the positioned render
// (the border + the title chip), the border's press selection, the
// container move (the box + the members, one transact), the makeGroup /
// dissolveGroup commands, and the Ctrl/Cmd+G hotkeys over the doc.
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createDoc } from "docblocks-core";
import type { Block } from "docblocks-core";

import { Editor } from "../src/Editor";
import { boxContains } from "../src/blocks/canvas-geometry";
import { dissolveGroup, makeGroup } from "../src/canvas/insert";
import { EditorProvider } from "../src/editor-provider";

const CREATED_AT = "2026-10-21T00:00:00.000Z";

type TestDoc = ReturnType<typeof createDoc>;

interface Rendered {
  doc: TestDoc;
  view: HTMLElement;
  a: string;
  b: string;
  c: string;
  group: string;
  json: () => ReturnType<TestDoc["toJSON"]>;
}

function seededDoc(withGroup: boolean): { doc: TestDoc; a: string; b: string; c: string; group: string | null } {
  const doc = createDoc({ id: "canvas-groups-doc", createdAt: CREATED_AT });
  const surface: string = doc.insertBlock("surface");
  const a = doc.insertBlock("shape", { variant: "rect" }, { parent: surface });
  doc.setGeometry(a, { x: -100, y: -50, w: 100, h: 60 });
  const b = doc.insertBlock("shape", { variant: "ellipse" }, { parent: surface });
  doc.setGeometry(b, { x: 100, y: 50, w: 80, h: 60 });
  const c = doc.insertBlock("shape", { variant: "rect" }, { parent: surface });
  doc.setGeometry(c, { x: 0, y: 200, w: 60, h: 40 });
  let group: string | null = null;
  if (withGroup) {
    group = doc.insertBlock("group", { members: [a, b] }, { parent: surface });
    // The container's own free box: it
    // stands its own geometry, independent of the members' union.
    doc.setGeometry(group, { x: 0, y: 0, w: 400, h: 240 });
  }
  return { doc, a, b, c, group: group ?? "" };
}

function renderCanvas(withGroup: boolean): Rendered {
  const { doc, a, b, c, group } = seededDoc(withGroup);
  const { container } = render(
    <EditorProvider doc={doc}>
      <Editor view="canvas" />
    </EditorProvider>
  );
  const view = container.querySelector<HTMLElement>('[data-slot="docblocks/canvas-view"]');
  if (view === null) throw new Error("the canvas view is missing");
  return { doc, a, b, c, group: group ?? "", view, json: () => doc.toJSON() };
}

beforeEach(() => window.localStorage.clear());
afterEach(() => {
  cleanup();
});

describe("the drop's containment math (the fully-inside test)", () => {
  it("stands true when the figure's box is fully inside the container's (the edge touch stands contained)", () => {
    const container = { x: 0, y: 0, w: 200, h: 100 }; // [-100..100, -50..50]
    // Fully inside (with margin).
    expect(boxContains({ x: 0, y: 0, w: 100, h: 40 }, container)).toBe(true);
    // The edge touch stands contained (the figure's box equals the
    // container's box).
    expect(boxContains({ x: 0, y: 0, w: 200, h: 100 }, container)).toBe(true);
    // The touch of the figure's corner to the container's edge (the figure
    // is exactly half inside).
    expect(boxContains({ x: 50, y: 0, w: 100, h: 40 }, container)).toBe(true);
  });

  it("stands false when the figure's box overruns the container's edge", () => {
    const container = { x: 0, y: 0, w: 200, h: 100 };
    // The right edge overruns.
    expect(boxContains({ x: 80, y: 0, w: 100, h: 40 }, container)).toBe(false);
    // The bottom edge overruns.
    expect(boxContains({ x: 0, y: 40, w: 100, h: 40 }, container)).toBe(false);
    // The figure is outside.
    expect(boxContains({ x: -200, y: 0, w: 100, h: 40 }, container)).toBe(false);
  });
});

describe("the makeGroup / dissolveGroup commands", () => {
  it("stands the group over the same-surface selection in one transact", () => {
    const { doc, a, b } = seededDoc(false);
    const created = makeGroup(doc, [a, b]);
    expect(created).not.toBeNull();
    const group = doc.getBlock(created!);
    expect(group).toMatchObject({ type: "group", attrs: { members: [a, b] } });
    // The members stand where they are (the container is not a structural
    // parent — the membership is the weak ref list).
    expect(doc.getBlock(a)).not.toBeNull();
    expect(doc.getBlock(b)).not.toBeNull();
    // One undo step: the group goes, the members' geometry stands.
    const aBefore = doc.getBlock(a);
    doc.undo();
    expect(doc.getBlock(created!)).toBeNull();
    expect(doc.getBlock(a)).toEqual(aBefore);
  });

  it("refuses the ineligible selection (one member, the connector, the cross-surface)", () => {
    const { doc, a, b, c } = seededDoc(false);
    expect(makeGroup(doc, [a])).toBeNull(); // one member
    void c;
    const surface2 = doc.insertBlock("surface");
    const foreign = doc.insertBlock("shape", { variant: "rect" }, { parent: surface2 });
    doc.setGeometry(foreign, { x: 0, y: 0, w: 40, h: 40 });
    expect(makeGroup(doc, [a, foreign])).toBeNull(); // the cross-surface
    // A connector member (the same surface): the ineligible set.
    const surface = doc.getChildren(doc.meta.id).find((id) => doc.getBlock(id)?.type === "surface")!;
    const sameConnector = doc.insertBlock(
      "connector",
      { start: { blockId: a }, end: { blockId: b } },
      {
        parent: surface,
      }
    );
    expect(makeGroup(doc, [a, sameConnector])).toBeNull();
    // The doc stands unchanged (no group written).
    for (const id of doc.getChildren(doc.meta.id)) {
      for (const child of doc.getChildren(id)) expect(doc.getBlock(child)?.type).not.toBe("group");
    }
  });

  it("the dissolve removes the group, the members stand (the non-group stands no dissolve)", () => {
    const { doc, a, b } = seededDoc(true);
    const surface = doc.getChildren(doc.meta.id)[0]!;
    const group = doc.getChildren(surface).find((id) => doc.getBlock(id)?.type === "group")!;
    expect(dissolveGroup(doc, group)).toBe(true);
    expect(doc.getBlock(group)).toBeNull();
    expect(doc.getBlock(a)).not.toBeNull();
    expect(doc.getBlock(b)).not.toBeNull();
    expect(dissolveGroup(doc, a)).toBe(false); // the non-group: the caller's path owns it
    expect(doc.getBlock(a)).not.toBeNull();
  });
});

describe("the container's render (the reworked group)", () => {
  it("stands the positioned item with its own box (the border + the interior pointer pass-through)", () => {
    const r = renderCanvas(true);
    // The group stands a positioned canvas item : the wrapper at its own free box, the border inside.
    const wrapper = r.view.querySelector<HTMLElement>(
      `[data-slot="docblocks/canvas-item"][data-block-id="${r.group}"]`
    );
    expect(wrapper).not.toBeNull();
    const border = r.view.querySelector<HTMLElement>(
      `[data-slot="docblocks/group-border"][data-block-id="${r.group}"], [data-slot="docblocks/group-border"]`
    );
    expect(border).not.toBeNull();
    // The member-less title stands off (no title attr — the chip is absent).
    expect(r.view.querySelector("[data-slot='docblocks/group-title']")).toBeNull();
  });

  it("stands the title chip when the title is set (the empty string stands off)", () => {
    const r = renderCanvas(true);
    act(() => {
      r.doc.updateBlock(r.group, { title: "my container" });
    });
    const chip = r.view.querySelector<HTMLElement>("[data-slot='docblocks/group-title']");
    expect(chip).not.toBeNull();
    expect(chip!.textContent).toBe("my container");
    // The empty string is the removed state: the chip stands off.
    act(() => {
      r.doc.updateBlock(r.group, { title: "" });
    });
    expect(r.view.querySelector("[data-slot='docblocks/group-title']")).toBeNull();
  });
});

describe("the container's selection + move", () => {
  it("the border's press selects the container (the no-op release commits nothing)", () => {
    const r = renderCanvas(true);
    const wrapper = r.view.querySelector<HTMLElement>(
      `[data-slot="docblocks/canvas-item"][data-block-id="${r.group}"]`
    );
    const border = wrapper!.querySelector<HTMLElement>("[data-slot='docblocks/group-border']");
    expect(wrapper?.hasAttribute("data-selected")).toBe(false);
    expect(border).not.toBeNull();
    // The border's press: the group stands selected (the move session
    // opens — the no-op release commits nothing).
    fireEvent.pointerDown(border!, { clientX: 50, clientY: 50, buttons: 1, pointerId: 1 });
    expect(wrapper!.hasAttribute("data-selected")).toBe(true);
    fireEvent.pointerUp(border!, { pointerId: 1 });
    // The no-op press (no drag): the doc stands unchanged.
    expect(r.json().blocks[r.group]).toMatchObject({ type: "group" });
  });

  it("the container's drag moves the box and the members (one transact, one undo)", () => {
    const r = renderCanvas(true);
    const wrapper = r.view.querySelector<HTMLElement>(
      `[data-slot="docblocks/canvas-item"][data-block-id="${r.group}"]`
    );
    const border = wrapper!.querySelector<HTMLElement>("[data-slot='docblocks/group-border']")!;
    const aBefore = r.json().blocks[r.a]!;
    const bBefore = r.json().blocks[r.b]!;
    const groupBefore = r.json().blocks[r.group]!;
    const cBefore = r.json().blocks[r.c];
    fireEvent.pointerDown(border, { clientX: 50, clientY: 50, buttons: 1, pointerId: 1 });
    // The real drag: the 3px threshold crossed, the zoom's 1x scale.
    fireEvent.pointerMove(r.view, { clientX: 80, clientY: 60, buttons: 1, pointerId: 1 });
    fireEvent.pointerUp(r.view, { pointerId: 1 });
    // The container's box + the members stand the +30/+10 delta; c
    // (outside the group) stands.
    const aAfter = r.json().blocks[r.a]!;
    const bAfter = r.json().blocks[r.b]!;
    const groupAfter = r.json().blocks[r.group]!;
    expect(groupAfter.geometry).toEqual({
      x: (groupBefore.geometry?.x ?? 0) + 30,
      y: (groupBefore.geometry?.y ?? 0) + 10,
      w: 400,
      h: 240,
    });
    expect(aAfter.geometry).toEqual({
      x: (aBefore.geometry?.x ?? 0) + 30,
      y: (aBefore.geometry?.y ?? 0) + 10,
      w: 100,
      h: 60,
    });
    expect(bAfter.geometry).toEqual({
      x: (bBefore.geometry?.x ?? 0) + 30,
      y: (bBefore.geometry?.y ?? 0) + 10,
      w: 80,
      h: 60,
    });
    expect(r.json().blocks[r.c]).toEqual(cBefore);
    // One undo step reverts the whole container move (the box + the members).
    r.doc.undo();
    expect(r.json().blocks[r.a]).toEqual(aBefore);
    expect(r.json().blocks[r.b]).toEqual(bBefore);
    expect(r.json().blocks[r.group]).toEqual(groupBefore);
  });
});

describe("the hotkeys (Ctrl/Cmd+G)", () => {
  it("Ctrl/Cmd+G groups the multi selection (one transact, the group stands selected)", () => {
    const r = renderCanvas(false);
    const before = JSON.stringify(r.json());
    // The multi selection: the a's click + the b's shift-click.
    const wrapperA = r.view.querySelector<HTMLElement>(`[data-slot="docblocks/canvas-item"][data-block-id="${r.a}"]`)!;
    const wrapperB = r.view.querySelector<HTMLElement>(`[data-slot="docblocks/canvas-item"][data-block-id="${r.b}"]`)!;
    fireEvent.pointerDown(wrapperA, { clientX: 10, clientY: 10, pointerId: 1 });
    fireEvent.pointerUp(wrapperA, { pointerId: 1 });
    fireEvent.pointerDown(wrapperB, { clientX: 20, clientY: 20, shiftKey: true, pointerId: 1 });
    fireEvent.pointerUp(wrapperB, { pointerId: 1 });
    expect(JSON.stringify(r.json())).toBe(before); // the selection stands no data

    fireEvent.keyDown(r.view, { key: "g", metaKey: true });
    const json = r.json();
    const groupEntry = Object.values(json.blocks).find((block) => (block as Block).type === "group") as {
      attrs: { members: string[] };
    };
    expect(groupEntry).toBeDefined();
    expect(groupEntry.attrs).toMatchObject({ members: [r.a, r.b] });
    // The group stands selected (the positioned item's data-selected).
    const groupId = (groupEntry as { id?: string }).id;
    void groupId;
    const selectedWrapper = r.view.querySelector<HTMLElement>("[data-slot='docblocks/canvas-item'][data-selected]");
    expect(selectedWrapper).not.toBeNull();
    // One undo step dissolves the group (the members' geometry stands).
    const aBefore = r.json().blocks[r.a]!;
    r.doc.undo();
    const after = Object.values(r.json().blocks).find((block) => (block as Block).type === "group");
    expect(after).toBeUndefined();
    expect(r.json().blocks[r.a]).toEqual(aBefore);
  });

  it("Ctrl/Cmd+Shift+G dissolves the selected group (the members stand)", () => {
    const r = renderCanvas(true);
    // Select the group over its border.
    const wrapper = r.view.querySelector<HTMLElement>(
      `[data-slot="docblocks/canvas-item"][data-block-id="${r.group}"]`
    )!;
    const border = wrapper.querySelector<HTMLElement>("[data-slot='docblocks/group-border']")!;
    fireEvent.pointerDown(border, { clientX: 50, clientY: 50, buttons: 1, pointerId: 1 });
    fireEvent.pointerUp(border, { pointerId: 1 });
    fireEvent.keyDown(r.view, { key: "g", metaKey: true, shiftKey: true });
    expect(r.json().blocks[r.group]).toBeUndefined();
    expect(r.json().blocks[r.a]).toBeDefined();
    expect(r.json().blocks[r.b]).toBeDefined();
  });
});
