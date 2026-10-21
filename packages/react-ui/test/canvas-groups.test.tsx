// @vitest-environment jsdom
// The canvas groups (the flat marker): the
// derived union box's pure math, the outline's render (the lenient read
// over the dangling / the member-less group), the group's press (the band
// hit's selection + the members' move session), and the hotkeys
// (Ctrl/Cmd+G's group, the Shift's dissolve) over the doc.
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { createDoc } from "docblocks-core";
import type { Block, BlockId } from "docblocks-core";

import { Editor } from "../src/Editor";
import { EditorProvider } from "../src/EditorProvider";
import { groupBoxOf, groupMemberIds } from "../src/blocks/canvas-geometry";
import { dissolveGroup, makeGroup } from "../src/canvas/insert";

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
  const group = withGroup ? doc.insertBlock("group", { members: [a, b] }, { parent: surface }) : null;
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

/** The blocks map of the doc (the pure helpers' input). */
function blocksOf(doc: TestDoc): Record<BlockId, Block> {
  const json = doc.toJSON();
  return json.blocks as Record<BlockId, Block>;
}

afterEach(() => {
  cleanup();
});

describe("the derived box's pure math", () => {
  it("stands the union of the members' effective boxes (the center-anchor form)", () => {
    const { doc, a, b, c } = seededDoc(false);
    const blocks = blocksOf(doc);
    // a: center (-100, -50) 100x60 → [-150..-50, -80..-20]
    // b: center (100, 50) 80x60 → [60..140, 20..80]
    const box = groupBoxOf([a, b], [a, b, c], blocks);
    expect(box).toEqual({ x: (-150 + 140) / 2, y: (-80 + 80) / 2, w: 290, h: 160 });
    // The member-less / the undefined members stand nothing.
    expect(groupBoxOf([], [a, b, c], blocks)).toBeNull();
    expect(groupBoxOf(undefined, [a, b, c], blocks)).toBeNull();
  });

  it("skips the dangling ref, the non-sibling ref, the connector, and the group (the weak ref posture)", () => {
    const doc = createDoc({ id: "g2", createdAt: CREATED_AT });
    const surface = doc.insertBlock("surface");
    const s1 = doc.insertBlock("shape", { variant: "rect" }, { parent: surface });
    doc.setGeometry(s1, { x: 0, y: 0, w: 40, h: 40 });
    const other = doc.insertBlock("surface");
    const foreign = doc.insertBlock("shape", { variant: "rect" }, { parent: other });
    doc.setGeometry(foreign, { x: 0, y: 0, w: 40, h: 40 });
    const connector = doc.insertBlock(
      "connector",
      { start: { blockId: s1 }, end: { blockId: s1 } },
      { parent: surface }
    );
    const group1 = doc.insertBlock("group", { members: [s1] }, { parent: surface });
    const blocks = blocksOf(doc);
    // The group's surface siblings (the foreign surface's child is NOT a
    // sibling — it is skipped by the ref resolution).
    const siblings = [s1, connector, group1];
    const effective = groupMemberIds([s1, "ghost", foreign, connector, group1], siblings, blocks);
    expect(effective).toEqual([s1]);
    expect(groupBoxOf([s1, "ghost", foreign, connector, group1], siblings, blocks)).toEqual({
      x: 0,
      y: 0,
      w: 40,
      h: 40,
    });
    // A foreign surface's member is not a sibling: skipped.
    expect(groupMemberIds([foreign], siblings, blocks)).toEqual([]);
  });
});

describe("the makeGroup / dissolveGroup commands", () => {
  it("stands the group over the same-surface selection in one transact", () => {
    const { doc, a, b } = seededDoc(false);
    const created = makeGroup(doc, [a, b]);
    expect(created).not.toBeNull();
    const group = doc.getBlock(created!);
    expect(group).toMatchObject({ type: "group", attrs: { members: [a, b] } });
    // The members stand where they are (the marker is not a container).
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
      { parent: surface }
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

describe("the outline's render", () => {
  it("stands the dashed outline over the members' union (no phantom item wrapper)", () => {
    const r = renderCanvas(true);
    const outline = r.view.querySelector<SVGRectElement>(
      `[data-slot="docblocks/canvas-group"][data-block-id="${r.group}"] [data-slot="docblocks/canvas-group-outline"]`
    );
    expect(outline).not.toBeNull();
    // The union of a (-100,-50,100x60) and b (100,50,80x60) + the 4px
    // breath: left = -150-4, top = -80-4, width = 290+8, height = 160+8.
    expect(Number(outline!.getAttribute("x"))).toBe(-154);
    expect(Number(outline!.getAttribute("y"))).toBe(-84);
    expect(Number(outline!.getAttribute("width"))).toBe(298);
    expect(Number(outline!.getAttribute("height"))).toBe(168);
    // The group stands no positioned item (the marker carries no box).
    expect(r.view.querySelector(`[data-slot="docblocks/canvas-item"][data-block-id="${r.group}"]`)).toBeNull();
    // The hit band stands (the wide transparent stroke).
    expect(r.view.querySelector(`[data-group-hit="${r.group}"]`)).not.toBeNull();
  });

  it("the lenient read: the dangling member stands the reduced union; the member-less group stands nothing", () => {
    const r = renderCanvas(true);
    // Remove a member (the race's / the dissolve's shape): the union
    // stands over the survivor only (the act wraps the store-driven
    // re-render — the raw doc op stands no act of its own).
    act(() => {
      r.doc.removeBlock(r.b);
    });
    const outline = r.view.querySelector<SVGRectElement>("[data-slot='docblocks/canvas-group-outline']");
    expect(outline).not.toBeNull();
    // a alone: [-150..-50, -80..-20] + the breath.
    expect(Number(outline!.getAttribute("x"))).toBe(-154);
    expect(Number(outline!.getAttribute("width"))).toBe(108);

    const doc = createDoc({ id: "g-empty", createdAt: CREATED_AT });
    const surface = doc.insertBlock("surface");
    const s1 = doc.insertBlock("shape", { variant: "rect" }, { parent: surface });
    doc.setGeometry(s1, { x: 0, y: 0, w: 40, h: 40 });
    doc.insertBlock("group", { members: ["ghost"] }, { parent: surface });
    const { container } = render(
      <EditorProvider doc={doc}>
        <Editor view="canvas" />
      </EditorProvider>
    );
    expect(container.querySelector("[data-slot='docblocks/canvas-group-outline']")).toBeNull();
  });

  it("the selected group stands the selection's emphasis (the band's press)", () => {
    const r = renderCanvas(true);
    const outline = r.view.querySelector<SVGRectElement>("[data-slot='docblocks/canvas-group-outline']");
    expect(outline?.hasAttribute("data-selected")).toBe(false);
    const hit = r.view.querySelector<SVGElement>(`[data-group-hit="${r.group}"]`);
    expect(hit).not.toBeNull();
    // The band's press: the group stands selected (the members' move
    // session opens — the no-op release commits nothing).
    fireEvent.pointerDown(hit!, { clientX: 50, clientY: 50, buttons: 1, pointerId: 1 });
    expect(outline!.hasAttribute("data-selected")).toBe(true);
    fireEvent.pointerUp(hit!, { pointerId: 1 });
    // The no-op press (no drag): the doc stands unchanged.
    expect(r.json().blocks[r.group]).toMatchObject({ type: "group" });
  });
});

describe("the hotkeys", () => {
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
    // The group stands selected (the outline's emphasis).
    const anyOutline = r.view.querySelector<SVGRectElement>("[data-slot='docblocks/canvas-group-outline']");
    expect(anyOutline?.hasAttribute("data-selected")).toBe(true);
    // One undo step dissolves the group (the members' geometry stands).
    const aBefore = r.json().blocks[r.a]!;
    r.doc.undo();
    const after = Object.values(r.json().blocks).find((block) => (block as Block).type === "group");
    expect(after).toBeUndefined();
    expect(r.json().blocks[r.a]).toEqual(aBefore);
  });

  it("Ctrl/Cmd+Shift+G dissolves the selected group (the members stand)", () => {
    const r = renderCanvas(true);
    // Select the group over its band.
    const hit = r.view.querySelector<SVGElement>(`[data-group-hit="${r.group}"]`)!;
    fireEvent.pointerDown(hit, { clientX: 50, clientY: 50, buttons: 1, pointerId: 1 });
    fireEvent.pointerUp(hit, { pointerId: 1 });
    fireEvent.keyDown(r.view, { key: "g", metaKey: true, shiftKey: true });
    expect(r.json().blocks[r.group]).toBeUndefined();
    expect(r.json().blocks[r.a]).toBeDefined();
    expect(r.json().blocks[r.b]).toBeDefined();
  });

  it("the band's drag moves the members (one transact, the group stands untouched)", () => {
    const r = renderCanvas(true);
    const hit = r.view.querySelector<SVGElement>(`[data-group-hit="${r.group}"]`)!;
    const aBefore = r.json().blocks[r.a]!;
    const bBefore = r.json().blocks[r.b]!;
    const cBefore = r.json().blocks[r.c];
    fireEvent.pointerDown(hit, { clientX: 50, clientY: 50, buttons: 1, pointerId: 1 });
    // The real drag: the 3px threshold crossed, the zoom's 1x scale.
    fireEvent.pointerMove(r.view, { clientX: 80, clientY: 60, buttons: 1, pointerId: 1 });
    fireEvent.pointerUp(r.view, { pointerId: 1 });
    // a and b stand the +30/+10 delta; c (outside the group) stands.
    const aAfter = r.json().blocks[r.a]!;
    const bAfter = r.json().blocks[r.b]!;
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
    // The group stands untouched (no geometry of its own).
    expect(r.json().blocks[r.group]).toMatchObject({ type: "group" });
    expect(r.json().blocks[r.group]).not.toHaveProperty("geometry");
    // One undo step reverts the whole group move.
    r.doc.undo();
    expect(r.json().blocks[r.a]).toEqual(aBefore);
    expect(r.json().blocks[r.b]).toEqual(bBefore);
  });
});
