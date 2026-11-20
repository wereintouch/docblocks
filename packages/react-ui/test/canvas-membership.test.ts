// The canvas auto-membership: a created or pasted figure whose centre stands
// inside a container's box joins the top-most container in the same
// transaction (one undo step) and leaves every earlier owner; the container
// and the frame never join automatically; the pasted group's own members keep
// their fragment's membership (the external containers stay off).
import { describe, expect, it } from "vitest";

import { createDoc } from "docblocks-core";

import { copyCanvasItems, pasteCanvasItems } from "../src/canvas/clipboard";
import { placeCanvasText, placeConnector, placePenStroke, placeShape } from "../src/canvas/insert";
import { autoMembership } from "../src/canvas/membership";

const CREATED_AT = "2026-11-19T00:00:00.000Z";

type TestDoc = ReturnType<typeof createDoc>;

interface Scene {
  doc: TestDoc;
  surface: string;
  group: string;
}

/** The scene: one surface + the container at the centre (240x160). */
function seedScene(docId: string, box = { x: 0, y: 0, w: 240, h: 160 }): Scene {
  const doc = createDoc({ id: docId, createdAt: CREATED_AT });
  const surface = doc.insertBlock("surface");
  const group = doc.insertBlock("group", { members: [] }, { parent: surface });
  doc.setGeometry(group, box);
  return { doc, surface, group };
}

/** The container's members (the live read). */
function membersOf(doc: TestDoc, group: string): string[] {
  const block = doc.getBlock(group);
  return block !== null && block.type === "group" ? block.attrs.members : [];
}

/** The group ids that list the block. */
function ownersOf(doc: TestDoc, id: string): string[] {
  const owners: string[] = [];
  for (const surfaceId of doc.getChildren(doc.meta.id)) {
    for (const childId of doc.getChildren(surfaceId)) {
      const child = doc.getBlock(childId);
      if (child !== null && child.type === "group" && child.attrs.members.includes(id)) owners.push(childId);
    }
  }
  return owners;
}

describe("the created figure's membership", () => {
  it("joins the container over the centre in the place's own transaction", () => {
    const { doc, group } = seedScene("membership-place-shape");
    const id = placeShape(doc, "rect", { x: 20, y: 10 }, { w: 80, h: 60 });
    expect(membersOf(doc, group)).toEqual([id]);
    // One undo step: the shape goes and the membership stands restored.
    doc.undo();
    expect(doc.getBlock(id)).toBeNull();
    expect(membersOf(doc, group)).toEqual([]);
  });

  it("joins over a canvas-text and the pen stroke", () => {
    const { doc, group } = seedScene("membership-others");
    const text = placeCanvasText(doc, { x: -20, y: 0 }, { w: 100, h: 60 });
    expect(membersOf(doc, group)).toEqual([text]);
    const stroke = placePenStroke(doc, {
      geometry: { x: 10, y: 20, w: 40, h: 30 },
      points: [
        [0, 0],
        [40, 30],
      ],
    });
    expect(membersOf(doc, group)).toEqual([text, stroke]);
  });

  it("stands off over a centre outside the container", () => {
    const { doc, group } = seedScene("membership-outside");
    const id = placeShape(doc, "rect", { x: 500, y: 0 }, { w: 80, h: 60 });
    expect(membersOf(doc, group)).toEqual([]);
    expect(ownersOf(doc, id)).toEqual([]);
  });

  it("joins the top-most container over two overlapping boxes", () => {
    const { doc, surface, group } = seedScene("membership-topmost");
    const upper = doc.insertBlock("group", { members: [] }, { parent: surface });
    doc.setGeometry(upper, { x: 0, y: 0, w: 200, h: 140 });
    const id = placeShape(doc, "rect", { x: 0, y: 0 }, { w: 60, h: 40 });
    expect(ownersOf(doc, id)).toEqual([upper]);
    expect(membersOf(doc, group)).toEqual([]);
  });

  it("leaves the earlier owner over the centre's new container", () => {
    const { doc, surface, group } = seedScene("membership-leave");
    const other = doc.insertBlock("group", { members: [] }, { parent: surface });
    doc.setGeometry(other, { x: 500, y: 0, w: 240, h: 160 });
    const id = placeShape(doc, "rect", { x: 0, y: 0 }, { w: 60, h: 40 });
    expect(ownersOf(doc, id)).toEqual([group]);
    // The figure's move into the other container stands the auto-membership's
    // leave: one owner only.
    doc.transact(() => {
      doc.setGeometry(id, { x: 500, y: 0, w: 60, h: 40 });
      autoMembership(doc, id);
    });
    expect(ownersOf(doc, id)).toEqual([other]);
  });

  it("stands the already-a-member figure a no-op (no duplicate)", () => {
    const { doc, group } = seedScene("membership-noop");
    const id = placeShape(doc, "rect", { x: 0, y: 0 }, { w: 60, h: 40 });
    expect(membersOf(doc, group)).toEqual([id]);
    const before = JSON.stringify(doc.toJSON());
    doc.transact(() => {
      autoMembership(doc, id);
    });
    expect(JSON.stringify(doc.toJSON())).toBe(before);
    expect(membersOf(doc, group)).toEqual([id]);
  });

  it("keeps the connector out of the auto-membership", () => {
    const { doc, group } = seedScene("membership-connector");
    const first = placeShape(doc, "rect", { x: -60, y: 0 }, { w: 40, h: 40 });
    const second = placeShape(doc, "rect", { x: 60, y: 0 }, { w: 40, h: 40 });
    const connector = placeConnector(doc, first, second);
    expect(membersOf(doc, group)).toEqual([first, second]);
    expect(membersOf(doc, group)).not.toContain(connector);
  });

  it("keeps the frame and the container out of the auto-membership", () => {
    const { doc, group } = seedScene("membership-never");
    const frame = doc.insertBlock("frame", undefined, { parent: doc.getChildren(doc.meta.id)[0]! });
    doc.setGeometry(frame, { x: 0, y: 0, w: 200, h: 120 });
    const nested = doc.insertBlock("group", { members: [] }, { parent: doc.getChildren(doc.meta.id)[0]! });
    doc.setGeometry(nested, { x: 0, y: 0, w: 180, h: 100 });
    doc.transact(() => {
      autoMembership(doc, frame);
      autoMembership(doc, nested);
    });
    expect(membersOf(doc, group)).toEqual([]);
  });
});

describe("the pasted copy's membership", () => {
  it("joins the target container while the original keeps its own", () => {
    const { doc, surface, group } = seedScene("membership-paste");
    const other = doc.insertBlock("group", { members: [] }, { parent: surface });
    doc.setGeometry(other, { x: 800, y: 0, w: 240, h: 160 });
    const original = placeShape(doc, "rect", { x: 0, y: 0 }, { w: 60, h: 40 });
    expect(ownersOf(doc, original)).toEqual([group]);
    const clipboard = copyCanvasItems(doc, [original])!;
    const pasted = pasteCanvasItems(doc, clipboard, surface, { x: 800, y: 0 })!;
    expect(pasted).toHaveLength(1);
    const copy = pasted[0]!;
    // The copy joins the other container; the original stands untouched.
    expect(ownersOf(doc, copy)).toEqual([other]);
    expect(ownersOf(doc, original)).toEqual([group]);
    // One undo step: the copy goes and the membership stands restored.
    doc.undo();
    expect(doc.getBlock(copy)).toBeNull();
    expect(membersOf(doc, other)).toEqual([]);
    expect(ownersOf(doc, original)).toEqual([group]);
  });

  it("keeps the pasted group's own member inside the fragment", () => {
    const { doc, surface } = seedScene("membership-paste-group");
    const member = doc.insertBlock("shape", { variant: "rect", fill: "#fff" }, { parent: surface });
    doc.setGeometry(member, { x: 800, y: 0, w: 60, h: 40 });
    const pastedGroup = doc.insertBlock("group", { members: [] }, { parent: surface });
    doc.setGeometry(pastedGroup, { x: 800, y: 0, w: 200, h: 120 });
    doc.transact(() => {
      doc.updateBlock(pastedGroup, { members: [member] });
    });
    const clipboard = copyCanvasItems(doc, [pastedGroup]);
    if (clipboard === null) throw new Error("the group's copy is missing");
    const pasted = pasteCanvasItems(doc, clipboard, surface, { x: 0, y: 0 })!;
    // The pasted group stands in the container's area: the group itself is
    // never auto-joined, and its member keeps the fragment's membership.
    const newGroup = pasted[0]!;
    expect(ownersOf(doc, newGroup)).toEqual([]);
    const pastedGroupBlock = doc.getBlock(newGroup);
    const pastedMembers =
      pastedGroupBlock !== null && pastedGroupBlock.type === "group" ? pastedGroupBlock.attrs.members : [];
    expect(pastedMembers).toHaveLength(1);
    expect(ownersOf(doc, pastedMembers[0]!)).toEqual([newGroup]);
  });

  it("stands the pasted copy of a non-member figure as no member", () => {
    const { doc, surface } = seedScene("membership-paste-outside");
    const shape = placeShape(doc, "rect", { x: 800, y: 0 }, { w: 60, h: 40 });
    const clipboard = copyCanvasItems(doc, [shape])!;
    // The copy lands outside every container.
    const pasted = pasteCanvasItems(doc, clipboard, surface, { x: 1400, y: 0 })!;
    expect(pasted).toHaveLength(1);
    expect(ownersOf(doc, pasted[0]!)).toEqual([]);
  });
});
