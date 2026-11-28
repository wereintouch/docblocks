// @vitest-environment jsdom
// The canvas container (the reworked group):
// the group's own free geometry + the title attr, the positioned render
// (the border + the title chip), the border's press selection, the
// container move (the box + the members, one transact), and the Ctrl/Cmd+G
// hotkeys over the doc.
import { act, cleanup, fireEvent } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { Block } from "docblocks-core";

import { boxContains } from "../src/canvas/geometry";
import { makeGroup } from "../src/canvas/insert";
import { renderCanvas, seededDoc } from "./canvas-groups.helpers";
import { dragTo, pressBlock, pressPointOf } from "./canvas-press";

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

describe("the container's render (the reworked group)", () => {
  it("stands the positioned item with its own box (the border + the interior pointer pass-through)", () => {
    const r = renderCanvas(true);
    // The group stands a positioned canvas item : the wrapper at its own free box, the border inside.
    const wrapper = r.view.querySelector<HTMLElement>(
      `[data-slot="docblocks/canvas-item"][data-block-id="${r.group}"]:not([data-slot="docblocks/row"])`
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
      `[data-slot="docblocks/canvas-item"][data-block-id="${r.group}"]:not([data-slot="docblocks/row"])`
    );
    const border = wrapper!.querySelector<HTMLElement>("[data-slot='docblocks/group-border']");
    expect(wrapper?.hasAttribute("data-selected")).toBe(false);
    expect(border).not.toBeNull();
    // The press on the container's border band: the group stands
    // selected (the move session opens — the no-op release commits
    // nothing).
    pressBlock(r.view, r.doc, r.group);
    expect(wrapper!.hasAttribute("data-selected")).toBe(true);
    // The no-op press (no drag): the doc stands unchanged.
    expect(r.json().blocks[r.group]).toMatchObject({ type: "group" });
  });

  it("the container's drag moves the box and the members (one transact, one undo)", () => {
    const r = renderCanvas(true);
    const aBefore = r.json().blocks[r.a]!;
    const bBefore = r.json().blocks[r.b]!;
    const groupBefore = r.json().blocks[r.group]!;
    const cBefore = r.json().blocks[r.c];
    const p = pressPointOf(r.doc, r.group);
    fireEvent.pointerDown(r.view, { clientX: p.x, clientY: p.y, buttons: 1, pointerId: 1 });
    // The real drag: the 3px threshold crossed, the zoom's 1x scale.
    dragTo(r.view, { x: p.x + 30, y: p.y + 10 }, 1);
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
    // The multi selection: the a's click + the b's shift-click (each
    // over the block's own zone).
    pressBlock(r.view, r.doc, r.a);
    pressBlock(r.view, r.doc, r.b, { shiftKey: true });
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
    // Select the group over its border band.
    pressBlock(r.view, r.doc, r.group);
    fireEvent.keyDown(r.view, { key: "g", metaKey: true, shiftKey: true });
    expect(r.json().blocks[r.group]).toBeUndefined();
    expect(r.json().blocks[r.a]).toBeDefined();
    expect(r.json().blocks[r.b]).toBeDefined();
  });
});

describe("the makeGroup membership's normalization", () => {
  it("moves the members out of their earlier groups (one owner per figure)", () => {
    const { doc, a, b, c, group } = seededDoc(true);
    expect(group).not.toBeNull();
    // The seeded group carries a and b; regrouping b with c moves b out of
    // it and a stays where it was (one owner per figure, one transact).
    const created = makeGroup(doc, [b, c]);
    expect(created).not.toBeNull();
    const old = doc.getBlock(group!);
    expect(old, "the earlier group stands (its other member keeps it)").not.toBeNull();
    expect((old as { attrs: { members: string[] } }).attrs.members).toEqual([a]);
    const fresh = doc.getBlock(created!);
    expect(fresh).toMatchObject({ type: "group", attrs: { members: [b, c] } });
    // The transitive read: no figure stands in two groups.
    const groups = doc
      .getChildren(doc.meta.id)
      .flatMap((surfaceId) => doc.getChildren(surfaceId))
      .filter((id) => doc.getBlock(id)?.type === "group") as string[];
    for (const memberId of [a, b, c]) {
      const owners = groups.filter((groupId) =>
        (doc.getBlock(groupId) as { attrs: { members: string[] } }).attrs.members.includes(memberId)
      );
      expect(owners, `the ${memberId}'s single-owner's stand`).toHaveLength(1);
    }
    // The membership move is the same undo step as the group's creation.
    doc.undo();
    expect(doc.getBlock(created!)).toBeNull();
    expect((doc.getBlock(group!) as { attrs: { members: string[] } }).attrs.members).toEqual([a, b]);
  });

  it("leaves an emptied earlier group in place (the empty group is a legal marker)", () => {
    const { doc, a, b, c } = seededDoc(true);
    const created = makeGroup(doc, [a, b, c]);
    expect(created).not.toBeNull();
    const groups = doc
      .getChildren(doc.meta.id)
      .flatMap((surfaceId) => doc.getChildren(surfaceId))
      .flatMap((id) => {
        const block = doc.getBlock(id);
        return block?.type === "group" ? [{ id, members: block.attrs.members }] : [];
      });
    expect(
      groups.filter((group) => group.members.length === 0),
      "the emptied marker stands"
    ).toHaveLength(1);
    expect(groups.find((group) => group.id === created)?.members).toEqual([a, b, c]);
  });
});
